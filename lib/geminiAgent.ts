import { ApiError, GoogleGenAI } from "@google/genai";
import { tavily } from "@tavily/core";
import { agentSystemPrompt, agentUserPrompt } from "./agentPrompt";
import { CONSOLE_URL, finishGuide, isOutboundPage, ProviderError, stageForSearch } from "./finalize";
import { RateLimitError, withRateLimitRetry, type WaitBudget } from "./retry";
import type { Guide } from "./schema";
import type { AgentEvent } from "./stages";

// Gemini path, in three steps:
// 1. Gemini researches with Google Search grounding and lists the pages worth reading.
// 2. Tavily reads those pages in full (a search snippet is not a source).
// 3. Gemini writes the guide from the pages it was given; it may only cite those.
// The shared finishGuide() then validates and self-checks, exactly as for Anthropic.

// A Flash model with free-tier quota (measured on 3.7/3.6/3.5-flash; the newer 3.8 wasn't listed).
// Google no longer publishes the free-tier table; if 429s continue, the server log names the quota.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.7-flash";
const MAX_PAGES = 9; // with Gemini's searches, about 15 lookups per guide
const PAGE_CHARS = 15000;

// Search results per app, kept for 30 minutes per server instance, so retrying a guide
// (e.g. after a rate limit in the writing step) doesn't spend another grounded call.
const RESEARCH_TTL_MS = 30 * 60 * 1000;
const researchCache = new Map<string, { at: number; value: GenerateResult }>();

type GenerateResult = { text: string; queries: string[]; pages: { uri: string; title: string }[] };

type QuotaViolation = { metric?: string; id?: string; limit?: string; dimensions?: Record<string, string> };

/** A Gemini 429. Carries what the API said about which quota ran out and when to retry. */
export class GeminiRateLimitError extends RateLimitError {
  constructor(
    retryDelayMs: number | null,
    readonly quotas: QuotaViolation[],
    options?: { cause?: unknown },
  ) {
    super(`Gemini rate limit (${quotas.map((q) => q.id).join(", ") || "unknown quota"})`, retryDelayMs, true, options);
    this.name = "GeminiRateLimitError";
  }
}

/** Pulls the status, quota violations and retry delay out of a Gemini API error body. */
export function parseGeminiError(err: unknown): {
  status: number | null;
  message: string;
  quotas: QuotaViolation[];
  retryDelayMs: number | null;
  body: unknown;
} {
  const text = err instanceof Error ? err.message : String(err);
  let body: unknown = null;
  try {
    body = JSON.parse(text.slice(text.indexOf("{")));
  } catch {
    // not JSON; keep the message only
  }
  type Detail = {
    "@type"?: string;
    retryDelay?: string;
    violations?: { quotaMetric?: string; quotaId?: string; quotaValue?: string; quotaDimensions?: Record<string, string> }[];
  };
  const error = (body as { error?: { code?: number; message?: string; details?: Detail[] } } | null)?.error;
  const details = error?.details ?? [];
  const quotas = details
    .filter((d) => d["@type"]?.endsWith("QuotaFailure"))
    .flatMap((d) => d.violations ?? [])
    .map((v) => ({ metric: v.quotaMetric, id: v.quotaId, limit: v.quotaValue, dimensions: v.quotaDimensions }));
  const delay = details.find((d) => d["@type"]?.endsWith("RetryInfo"))?.retryDelay; // e.g. "37s" or "1.5s"
  const seconds = delay ? parseFloat(delay) : NaN;
  return {
    status: err instanceof ApiError ? err.status : (error?.code ?? null),
    message: error?.message ?? text,
    quotas,
    retryDelayMs: Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : null,
    body: body ?? text,
  };
}

export type GeminiDeps = {
  /** Returns the model's text and, for grounded calls, the search queries and result pages. */
  generate: (req: {
    system: string;
    prompt: string;
    search: boolean;
    json: boolean;
  }) => Promise<GenerateResult>;
  /** Reads full pages. */
  extract: (urls: string[]) => Promise<{ ok: { url: string; title: string; content: string }[]; failed: { url: string; error: string }[] }>;
  /** Turns a Google grounding redirect link into the real page URL. */
  resolve: (uri: string) => Promise<string | null>;
};

function realDeps(): GeminiDeps {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const reader = tavily({ apiKey: process.env.TAVILY_API_KEY });
  return {
    async generate({ system, prompt, search, json }) {
      try {
        const res = await ai.models.generateContent({
          model: MODEL,
          contents: prompt,
          config: {
            systemInstruction: system,
            ...(search ? { tools: [{ googleSearch: {} }] } : {}),
            ...(json ? { responseMimeType: "application/json" } : {}),
          },
        });
        const meta = res.candidates?.[0]?.groundingMetadata;
        return {
          text: res.text ?? "",
          queries: meta?.webSearchQueries ?? [],
          pages: (meta?.groundingChunks ?? [])
            .map((c) => ({ uri: c.web?.uri ?? "", title: c.web?.title ?? "" }))
            .filter((p) => p.uri),
        };
      } catch (err) {
        const info = parseGeminiError(err);
        // Full detail for the server log: which quota, its limit, and the suggested retry delay.
        console.error(
          `Gemini API error ${info.status ?? "?"} (model ${MODEL}): ${info.message}\n` +
            info.quotas.map((q) => `  quota ${q.id} (${q.metric}) limit=${q.limit} ${JSON.stringify(q.dimensions ?? {})}\n`).join("") +
            `  retryDelay=${info.retryDelayMs === null ? "none" : `${info.retryDelayMs / 1000}s`}\n` +
            `  body=${JSON.stringify(info.body)}`,
        );
        if (info.status === 429) throw new GeminiRateLimitError(info.retryDelayMs, info.quotas, { cause: err });
        throw new ProviderError(`Gemini API error ${info.status ?? ""}`.trim(), { cause: err });
      }
    },
    async extract(urls) {
      try {
        const res = await reader.extract(urls, { extractDepth: "basic", format: "markdown" });
        return {
          ok: res.results.map((r) => ({ url: r.url, title: r.title ?? r.url, content: r.rawContent })),
          failed: res.failedResults,
        };
      } catch (err) {
        throw new ProviderError("Tavily extract failed", { cause: err });
      }
    },
    async resolve(uri) {
      try {
        const res = await fetch(uri, { redirect: "manual", signal: AbortSignal.timeout(5000) });
        return res.headers.get("location");
      } catch {
        return null;
      }
    },
  };
}

const RESEARCH_SYSTEM = `You research one provider's OAuth app registration and approval path for a developer building an AI agent. The difficulty lives in the approval path, not the OAuth flow itself. Prefer the provider's official developer docs. Always separate time to a first working connection (developer and test users) from time to production (any user).`;

const RESEARCH_TASK = `Use Google Search to research this. Do all your searching in this one reply: run several queries at once rather than one at a time. Look specifically for: app registration, app review or verification, security assessments, marketplace or directory listing, partner programs, scope or permission tiers, user caps, and limits in test or development mode.

Reply in two parts:
NOTES: short bullet points of what you found, each with the page it came from.
URLS: up to 12 page URLs worth reading in full, one per line, the provider's official developer docs first. Give the exact page URLs, not search links.`;

const WRITER_NOTE = `

Research for this guide is already done. The full text of the pages you may cite is in the user message, each with its URL.
- Every entry in "sources" must use one of those URLs exactly. Don't cite anything else.
- Label claims from the provider's official pages "sourced", from other pages "community", and anything not in the pages "uncertain".`;

/** Calls Gemini, waiting out rate limits (shared logic in retry.ts). */
function generateWithRetry(deps: GeminiDeps, req: Parameters<GeminiDeps["generate"]>[0], budget: WaitBudget) {
  return withRateLimitRetry(() => deps.generate(req), budget);
}

const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

export async function* runGeminiAgent(input: string, deps: GeminiDeps = realDeps()): AsyncGenerator<AgentEvent> {
  const today = new Date().toISOString().slice(0, 10);
  const system = agentSystemPrompt(today);
  const budget: WaitBudget = { waitedMs: 0 };

  // 1. Search: one grounded call; Gemini runs all its queries inside it.
  yield { type: "stage", stage: "resolve", detail: input };
  yield { type: "stage", stage: "search", detail: "Google Search via Gemini" };
  const cacheKey = `${MODEL}:${input.trim().toLowerCase()}`;
  const cached = researchCache.get(cacheKey);
  let research: GenerateResult;
  if (cached && Date.now() - cached.at < RESEARCH_TTL_MS) {
    research = cached.value;
  } else {
    research = yield* generateWithRetry(
      deps,
      { system: RESEARCH_SYSTEM, prompt: `${agentUserPrompt(input)}\n\n${RESEARCH_TASK}`, search: true, json: false },
      budget,
    );
    researchCache.set(cacheKey, { at: Date.now(), value: research });
  }
  for (const [i, query] of research.queries.entries()) {
    if (i === 0) yield { type: "stage", stage: stageForSearch(query, 0), detail: query };
    yield { type: "search", query };
  }

  // Pages to read: the URLs the model listed first, then the search results it was grounded on.
  const listed = research.text.match(/https?:\/\/[^\s)\]>"'`]+/g) ?? [];
  const grounded = await Promise.all(research.pages.map((p) => deps.resolve(p.uri)));
  const seen = new Set<string>();
  const urls: string[] = [];
  // Pages about the provider calling other services (e.g. /workers/) go last.
  const candidates = [...listed, ...grounded].filter((u): u is string => Boolean(u));
  candidates.sort((a, b) => Number(isOutboundPage(a)) - Number(isOutboundPage(b)));
  for (const raw of candidates) {
    if (!raw) continue;
    const url = raw.replace(/[.,;:]+$/, "");
    if (/vertexaisearch\.cloud\.google\.com|google\.com\/search/.test(url) || seen.has(norm(url))) continue;
    seen.add(norm(url));
    urls.push(url);
    if (urls.length === MAX_PAGES) break;
  }
  if (urls.length === 0) {
    yield { type: "error", message: "The search found no pages to read. Try a more specific app name or its website." };
    return;
  }

  // 2. Read
  yield {
    type: "stage",
    stage: urls.some((u) => CONSOLE_URL.test(u)) ? "console" : "docs",
    detail: `Reading ${urls.length} pages`,
  };
  const read = await deps.extract(urls);
  for (const p of read.ok) yield { type: "page", url: p.url, ok: true };
  for (const f of read.failed) yield { type: "page", url: `${f.url} (${f.error})`, ok: false };
  if (read.ok.length === 0) {
    yield { type: "error", message: "None of the pages could be read. Try again shortly." };
    return;
  }

  // 3. Write
  yield { type: "stage", stage: "write" };
  const pagesText = read.ok
    .map((p, i) => `=== Page ${i + 1}: ${p.title}\nURL: ${p.url}\n\n${p.content.slice(0, PAGE_CHARS)}`)
    .join("\n\n");
  const writerSystem = system + WRITER_NOTE;
  const draft = yield* generateWithRetry(
    deps,
    {
      system: writerSystem,
      prompt: `${agentUserPrompt(input)}\n\nResearch notes:\n${research.text}\n\nPages:\n\n${pagesText}\n\nReturn only the guide JSON.`,
      search: false,
      json: true,
    },
    budget,
  );

  const readUrls = new Set(read.ok.map((p) => norm(p.url)));
  yield* finishGuide({
    rawText: draft.text,
    input,
    today,
    repair: async function* (prompt) {
      return (yield* generateWithRetry(deps, { system: writerSystem, prompt, search: false, json: true }, budget)).text;
    },
    // Only pages that were actually read count as sources; claims citing anything
    // else then fail the self-check and drop to "uncertain".
    prepare: (guide: Guide) => ({ ...guide, sources: guide.sources.filter((s) => readUrls.has(norm(s.url))) }),
    pages: read.ok.map((p) => ({ url: p.url, text: p.content })),
  });
}
