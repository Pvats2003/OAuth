import Anthropic from "@anthropic-ai/sdk";
import { agentSystemPrompt, agentUserPrompt } from "./agentPrompt";
import { GuideSchema, slugify, type Guide } from "./schema";
import { selfCheck, uncertainClaims } from "./selfcheck";
import type { AgentEvent, Stage } from "./stages";

export type { AgentEvent } from "./stages";

// Sonnet 5.5 by default (faster, half the price of Opus). Set RESEARCH_MODEL=claude-opus-5-5 for deeper research.
const MODEL = process.env.RESEARCH_MODEL || "claude-sonnet-5-5";
const EFFORT = (process.env.AGENT_EFFORT || "medium") as "low" | "medium" | "high" | "xhigh" | "max";
const MAX_CONTINUATIONS = 5;

// About 15 searches + fetches in total.
const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 6 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 9, max_content_tokens: 20000 },
];

const REVIEW_WORDS = /review|verif|approv|security|assessment|marketplace|directory|listing|partner|scope|permission|limit|production|publish/i;
const CONSOLE_URL = /console|dashboard|developer\.|developers\.|\/apps\b|app-?management|create-an-app|register|my-?apps|marketplace\.(.*)\/(develop|build)/i;

function stageForSearch(query: string, searches: number): Stage {
  return searches === 0 && !REVIEW_WORDS.test(query) ? "resolve" : "search";
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The model did not return JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function formatIssues(err: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return err.issues
    .slice(0, 40)
    .map((i) => `- ${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

export async function* runAgent(input: string): AsyncGenerator<AgentEvent> {
  const client = new Anthropic();
  const today = new Date().toISOString().slice(0, 10);
  const system = agentSystemPrompt(today);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: agentUserPrompt(input) }];

  yield { type: "stage", stage: "resolve", detail: input };

  let searches = 0;
  let final: Anthropic.Beta.BetaMessage | null = null;
  const queue: AgentEvent[] = [];
  const assistantSoFar: Anthropic.Beta.BetaContentBlockParam[] = [];

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      system,
      tools: TOOLS,
      messages,
    });

    // Turn completed content blocks into progress events.
    stream.on("contentBlock", (block) => {
      if (block.type === "server_tool_use" && block.name === "web_search") {
        const query = String((block.input as { query?: string }).query ?? "");
        queue.push({ type: "stage", stage: stageForSearch(query, searches), detail: query });
        queue.push({ type: "search", query });
        searches++;
      } else if (block.type === "server_tool_use" && block.name === "web_fetch") {
        const url = String((block.input as { url?: string }).url ?? "");
        queue.push({ type: "stage", stage: CONSOLE_URL.test(url) ? "console" : "docs", detail: url });
      } else if (block.type === "web_fetch_tool_result") {
        const c = block.content;
        if (c.type === "web_fetch_result") queue.push({ type: "page", url: c.url, ok: true });
        else queue.push({ type: "page", url: "(fetch failed: " + c.error_code + ")", ok: false });
      }
    });
    let writing = false;
    stream.on("streamEvent", (event) => {
      if (!writing && event.type === "content_block_start" && event.content_block.type === "text") {
        writing = true;
        queue.push({ type: "stage", stage: "write" });
      }
    });

    // Drain queued events while the stream runs.
    const done = stream.finalMessage();
    let settled = false;
    done.then(
      () => (settled = true),
      () => (settled = true),
    );
    while (!settled) {
      await new Promise((r) => setTimeout(r, 250));
      while (queue.length) yield queue.shift()!;
    }
    const message = await done; // rethrows API errors
    while (queue.length) yield queue.shift()!;

    if (message.stop_reason === "pause_turn") {
      // Server tool loop paused; send the turn so far back and the server resumes it.
      assistantSoFar.push(...(message.content as Anthropic.Beta.BetaContentBlockParam[]));
      messages.splice(1, messages.length - 1, { role: "assistant", content: assistantSoFar });
      continue;
    }
    if (message.stop_reason === "refusal") {
      yield { type: "error", message: "The model declined this request. Try a different app name." };
      return;
    }
    final = message;
    break;
  }

  if (!final) {
    yield { type: "error", message: "Research ran out of steps before finishing. Try again." };
    return;
  }

  yield { type: "stage", stage: "check", detail: "Validating against the schema" };
  const rawText = textOf(final.content);
  let parsed = tryParse(rawText);

  if (!parsed.ok) {
    // One repair round: send the errors back.
    yield { type: "stage", stage: "check", detail: "Fixing schema errors" };
    const fix = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system,
        messages: [
          {
            role: "user",
            content: `This guide JSON failed validation.\n\nErrors:\n${parsed.error}\n\nJSON:\n${rawText}\n\nReturn only the corrected JSON object. Keep all content; change only what's needed to pass validation.`,
          },
        ],
      })
      .finalMessage();
    parsed = tryParse(textOf(fix.content));
    if (!parsed.ok) {
      yield { type: "error", message: `The guide didn't match the schema after one fix attempt:\n${parsed.error}` };
      return;
    }
  }

  const { guide, downgrades } = selfCheck({
    ...parsed.guide,
    slug: slugify(parsed.guide.slug) || slugify(input),
    last_checked: today,
    generated: true,
  });
  yield { type: "stage", stage: "check", detail: `${downgrades.length} claim(s) downgraded` };
  yield { type: "done", guide, uncertain: uncertainClaims(guide), downgraded: downgrades.length };
}

function tryParse(text: string): { ok: true; guide: Guide } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = extractJson(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid JSON" };
  }
  const result = GuideSchema.safeParse(json);
  return result.success ? { ok: true, guide: result.data } : { ok: false, error: formatIssues(result.error) };
}
