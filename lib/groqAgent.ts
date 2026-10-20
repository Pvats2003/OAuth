import OpenAI from "openai";
import { tavily } from "@tavily/core";
import { compactSystemPrompt } from "./agentPrompt";
import { CONSOLE_URL, finishGuide, ProviderError } from "./finalize";
import { RateLimitError, withRateLimitRetry, type WaitBudget } from "./retry";
import { slugify, type Guide } from "./schema";
import type { AgentEvent } from "./stages";

// Groq path. The model does no browsing of its own:
// 1. Tavily search runs up to 6 fixed queries about the approval path.
// 2. Tavily extract reads up to 8 of the best pages, keeping only the passages relevant to OAuth review.
// 3. Groq (OpenAI-compatible API) writes the guide from those passages; it may only cite those pages.
// The shared finishGuide() then validates (one repair round) and self-checks, as for the other providers.

const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const REASONING = (process.env.GROQ_REASONING_EFFORT || "low") as "low" | "medium" | "high";
const MAX_SEARCHES = 6;
const MAX_PAGES = 8;
// Groq's free tier allows 8,000 tokens a minute, and one request counts in full. Keep the
// prompt small (compact system prompt + about 2,250 tokens of page passages, ~3,800 in all) and
// leave room for a 4,000-token answer.
const PAGE_CHARS_TOTAL = Number(process.env.GROQ_PAGE_CHARS || 9000);
const MAX_COMPLETION_TOKENS = Number(process.env.GROQ_MAX_TOKENS || 4000);

type SearchHit = { url: string; title: string; score: number };
type Page = { url: string; title: string; content: string };

export type GroqDeps = {
  search: (query: string) => Promise<SearchHit[]>;
  extract: (urls: string[], query: string) => Promise<{ ok: Page[]; failed: { url: string; error: string }[] }>;
  chat: (req: { system: string; prompt: string }) => Promise<string>;
};

/** Pulls the useful parts out of a Groq API error: limit type, sizes and how long to wait. */
export function parseGroqError(err: unknown): {
  status: number | null;
  message: string;
  type: string | null;
  limit: number | null;
  requested: number | null;
  retryDelayMs: number | null;
  headers: Record<string, string>;
} {
  // Match by shape, not instanceof: the error can come from a different copy of the SDK.
  const apiErr =
    err instanceof OpenAI.APIError || (err instanceof Error && typeof (err as { status?: unknown }).status === "number")
      ? (err as InstanceType<typeof OpenAI.APIError>)
      : null;
  type Body = { message?: string; type?: string; code?: string };
  const raw = (apiErr?.error ?? null) as (Body & { error?: Body }) | null;
  const body = raw?.error ?? raw; // the SDK may keep the inner error object or the whole response body
  const message = body?.message ?? (err instanceof Error ? err.message : String(err));
  const headers: Record<string, string> = {};
  (apiErr?.headers as Headers | undefined)?.forEach((v: string, k: string) => {
    if (k === "retry-after" || k.startsWith("x-ratelimit")) headers[k] = v;
  });
  // "Limit 8000, Used 6200, Requested 2400. Please try again in 4.5s" / "in 1m2.5s"
  const sizes = message.match(/Limit (\d+),.*?Requested (\d+)/);
  const wait = message.match(/try again in (?:(\d+)m)?([\d.]+)s/);
  const fromBody = wait ? (Number(wait[1] ?? 0) * 60 + Number(wait[2])) * 1000 : NaN;
  const fromHeader = Number(headers["retry-after"]) * 1000;
  const retryDelayMs = Number.isFinite(fromBody) ? Math.ceil(fromBody) : Number.isFinite(fromHeader) ? fromHeader : null;
  return {
    status: apiErr?.status ?? null,
    message,
    type: body?.type ?? null,
    limit: sizes ? Number(sizes[1]) : null,
    requested: sizes ? Number(sizes[2]) : null,
    retryDelayMs,
    headers,
  };
}

/** Logs a Groq API error in full and turns it into the error the agent acts on. */
export function groqFailure(err: unknown): ProviderError {
  const info = parseGroqError(err);
  // Full detail for the server log: limit type, sizes, retry delay and rate-limit headers.
  console.error(
    `Groq API error ${info.status ?? "?"} (model ${MODEL}): ${info.message}\n` +
      `  type=${info.type} limit=${info.limit} requested=${info.requested} ` +
      `retryDelay=${info.retryDelayMs === null ? "none" : `${info.retryDelayMs / 1000}s`}\n` +
      `  headers=${JSON.stringify(info.headers)}`,
  );
  if (info.status === 429) {
    // One request larger than the per-minute limit will never fit; waiting can't help.
    const tooBig = info.limit !== null && info.requested !== null && info.requested > info.limit;
    return new RateLimitError(`Groq rate limit (${info.type ?? "unknown"})`, info.retryDelayMs, !tooBig, { cause: err });
  }
  return new ProviderError(`Groq API error ${info.status ?? ""}`.trim(), { cause: err });
}

function realDeps(): GroqDeps {
  const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
    maxRetries: 0, // retries are ours, so the page can show the wait
    timeout: 120_000,
  });
  const tv = tavily({ apiKey: process.env.TAVILY_API_KEY });
  return {
    async search(query) {
      try {
        const res = await tv.search(query, { searchDepth: "basic", maxResults: 5 });
        return res.results.map((r) => ({ url: r.url, title: r.title, score: r.score }));
      } catch (err) {
        throw new ProviderError("Tavily search failed", { cause: err });
      }
    },
    async extract(urls, query) {
      try {
        const res = await tv.extract(urls, { extractDepth: "basic", format: "markdown", query, chunksPerSource: 3 });
        return {
          ok: res.results.map((r) => ({ url: r.url, title: r.title ?? r.url, content: r.rawContent })),
          failed: res.failedResults,
        };
      } catch (err) {
        throw new ProviderError("Tavily extract failed", { cause: err });
      }
    },
    async chat({ system, prompt }) {
      try {
        const res = await groq.chat.completions.create({
          model: MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          reasoning_effort: REASONING,
          max_completion_tokens: MAX_COMPLETION_TOKENS,
        });
        return res.choices[0]?.message?.content ?? "";
      } catch (err) {
        throw groqFailure(err);
      }
    },
  };
}

function searchQueries(app: string): string[] {
  return [
    `${app} OAuth app registration developer documentation`,
    `${app} OAuth app review verification process`,
    `${app} app marketplace directory listing requirements`,
    `${app} API OAuth scopes permissions`,
    `${app} partner program API access approval`,
    `${app} OAuth test mode development limits users`,
  ].slice(0, MAX_SEARCHES);
}

const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

// Pages about the OAuth path itself rank above other pages from the same site.
const OAUTH_TOPIC = /oauth|authori[sz]|\bauth\b|\bscopes?\b|app[\s_-]?review|publish/i;
// Help-center and gallery pages about templates are never about OAuth approval.
const TEMPLATE_PAGE = (url: string, title: string) =>
  /template/i.test(`${url} ${title}`) && /help|support|gallery|\/templates?(\/|$)/i.test(url);

/**
 * Best pages first: the provider's own pages about OAuth, then its other pages, then third-party
 * pages about OAuth, then the rest; Tavily's relevance score breaks ties. Template pages are dropped.
 */
export function pickPages(app: string, hits: SearchHit[], max = MAX_PAGES): string[] {
  const token = slugify(app).split("-")[0];
  const own = (url: string) => {
    try {
      return token.length > 2 && new URL(url).hostname.includes(token) ? 1 : 0;
    } catch {
      return 0;
    }
  };
  const rank = (h: SearchHit) => own(h.url) * 2 + (OAUTH_TOPIC.test(`${h.url} ${h.title}`) ? 1 : 0);
  const seen = new Set<string>();
  return [...hits]
    .filter((h) => !TEMPLATE_PAGE(h.url, h.title))
    .sort((a, b) => rank(b) - rank(a) || b.score - a.score)
    .filter((h) => !seen.has(norm(h.url)) && seen.add(norm(h.url)))
    .slice(0, max)
    .map((h) => h.url);
}

export async function* runGroqAgent(input: string, deps: GroqDeps = realDeps()): AsyncGenerator<AgentEvent> {
  const today = new Date().toISOString().slice(0, 10);
  const budget: WaitBudget = { waitedMs: 0 };

  // 1. Search (Tavily, in parallel)
  const queries = searchQueries(input);
  yield { type: "stage", stage: "resolve", detail: queries[0] };
  yield { type: "stage", stage: "search", detail: `${queries.length} searches` };
  const results = await Promise.all(queries.map((q) => deps.search(q)));
  for (const q of queries) yield { type: "search", query: q };
  const urls = pickPages(input, results.flat());
  if (urls.length === 0) {
    yield { type: "error", message: "The search found no pages to read. Try a more specific app name or its website." };
    return;
  }

  // 2. Read (Tavily extract, relevant passages only)
  yield {
    type: "stage",
    stage: urls.some((u) => CONSOLE_URL.test(u)) ? "console" : "docs",
    detail: `Reading ${urls.length} pages`,
  };
  const read = await deps.extract(urls, `${input} OAuth app registration, review, verification, scopes and limits`);
  for (const p of read.ok) yield { type: "page", url: p.url, ok: true };
  for (const f of read.failed) yield { type: "page", url: `${f.url} (${f.error})`, ok: false };
  if (read.ok.length === 0) {
    yield { type: "error", message: "None of the pages could be read. Try again shortly." };
    return;
  }

  // 3. Write (Groq)
  yield { type: "stage", stage: "write" };
  const perPage = Math.floor(PAGE_CHARS_TOTAL / read.ok.length);
  const pagesText = read.ok
    .map((p, i) => `=== Page ${i + 1}: ${p.title}\nURL: ${p.url}\n${p.content.slice(0, perPage)}`)
    .join("\n\n");
  const system = compactSystemPrompt(today);
  const prompt = `Write the guide for: ${input}\n\nPages:\n\n${pagesText}\n\nReturn only the guide JSON.`;
  const draft = yield* withRateLimitRetry(() => deps.chat({ system, prompt }), budget);

  const readUrls = new Set(read.ok.map((p) => norm(p.url)));
  yield* finishGuide({
    rawText: draft,
    input,
    today,
    repair: async function* (fix) {
      // A one-line system prompt: the repair message already carries the whole draft, and Groq's
      // per-minute token limit counts the full request.
      const repairSystem = "You fix JSON so it passes validation. Reply with only the corrected JSON object.";
      return yield* withRateLimitRetry(() => deps.chat({ system: repairSystem, prompt: fix }), budget);
    },
    // Only pages that were actually read count as sources; claims citing anything else
    // then fail the self-check and drop to "uncertain".
    prepare: (guide: Guide) => ({ ...guide, sources: guide.sources.filter((s) => readUrls.has(norm(s.url))) }),
  });
}
