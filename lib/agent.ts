import Anthropic from "@anthropic-ai/sdk";
import { agentSystemPrompt, agentUserPrompt } from "./agentPrompt";
import { CONSOLE_URL, finishGuide, stageForSearch } from "./finalize";
import type { AgentEvent } from "./stages";

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

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Text of the pages web_fetch returned, so the self-check can verify durations against them. */
function fetchedPages(blocks: (Anthropic.Beta.BetaContentBlock | Anthropic.Beta.BetaContentBlockParam)[]) {
  const pages: { url: string; text: string }[] = [];
  for (const b of blocks) {
    if (b.type !== "web_fetch_tool_result" || b.content.type !== "web_fetch_result") continue;
    const src = b.content.content.source;
    if (src.type === "text") pages.push({ url: b.content.url, text: src.data });
  }
  return pages;
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

  yield* finishGuide({
    pages: fetchedPages([...assistantSoFar, ...final.content]),
    rawText: textOf(final.content),
    input,
    today,
    repair: async function* (prompt) {
      const fix = await client.beta.messages
        .stream({
          model: MODEL,
          max_tokens: 64000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low" },
          system,
          messages: [{ role: "user", content: prompt }],
        })
        .finalMessage();
      return textOf(fix.content);
    },
  });
}
