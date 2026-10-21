import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import OpenAI from "openai";
import { extractJson, finishGuide, GUIDE_FAILED } from "../lib/finalize";
import { failedGeneration } from "../lib/groqAgent";
import type { AgentEvent } from "../lib/stages";

const seed = readFileSync(new URL("../data/guides/gmail.json", import.meta.url), "utf8");

async function run(rawText: string, repairReply = ""): Promise<{ events: AgentEvent[]; repairs: number }> {
  let repairs = 0;
  const events: AgentEvent[] = [];
  const origError = console.error;
  const origLog = console.log;
  console.error = () => {}; // the pipeline logs failures; keep test output clean
  console.log = () => {};
  try {
    for await (const e of finishGuide({
      rawText,
      input: "Gmail",
      today: "2026-10-21",
      repair: async function* () {
        repairs++;
        return repairReply;
      },
    }))
      events.push(e);
  } finally {
    console.error = origError;
    console.log = origLog;
  }
  return { events, repairs };
}

test("JSON followed by trailing text (with braces) parses", () => {
  const reply = `{"a": 1, "b": {"c": [1, 2]}}\n\nNote: I left {placeholders} for you to fill in. }`;
  assert.deepEqual(extractJson(reply), { a: 1, b: { c: [1, 2] } });
});

test("leading prose and ``` fences are ignored", () => {
  const reply = 'Here is the guide:\n```json\n{"ok": true}\n```\nLet me know if you need changes.';
  assert.deepEqual(extractJson(reply), { ok: true });
});

test("braces and escaped quotes inside strings don't end the object", () => {
  const reply = '{"detail": "use {client_id} and a \\"quoted\\" } brace", "n": 2} trailing';
  assert.deepEqual(extractJson(reply), { detail: 'use {client_id} and a "quoted" } brace', n: 2 });
});

test("a stray { in leading prose is skipped; the first real object wins", () => {
  const reply = 'Set the {scope} first. {"first": 1} {"second": 2}';
  assert.deepEqual(extractJson(reply), { first: 1 });
});

test("a reply cut off mid-JSON is an error", () => {
  assert.throws(() => extractJson('{"a": {"b": 1}'), /cut off/);
});

test("pipeline: a valid guide with trailing text is accepted without a repair", async () => {
  const { events, repairs } = await run(`${seed}\n\nI hope this helps! {"extra": true}`);
  assert.equal(repairs, 0);
  assert.ok(events.some((e) => e.type === "done"));
});

test("pipeline: a valid draft is kept when the repair round returns garbage", async () => {
  const draft = JSON.parse(seed);
  for (const ph of draft.phases) for (const st of ph.steps) st.owner = "you"; // break a content rule only
  const { events, repairs } = await run(JSON.stringify(draft) + " trailing note", "not json at all");
  assert.equal(repairs, 1);
  assert.ok(events.some((e) => e.type === "done"), "valid draft should survive a broken repair");
});

test("pipeline: when nothing valid comes back, the page gets a plain message", async () => {
  const { events } = await run('{"slug": "gmail"} and some notes', '{"still": "wrong"}');
  const err = events.find((e) => e.type === "error");
  assert.ok(err && err.type === "error");
  assert.equal(err.message, GUIDE_FAILED);
});

test("Groq json_validate_failed: the rejected reply is recovered for parsing", () => {
  const reply = `${seed}\nThanks!`;
  const body = { error: { message: "Failed to validate JSON", type: "invalid_request_error", code: "json_validate_failed", failed_generation: reply } };
  const err = OpenAI.APIError.generate(400, body, "Failed to validate JSON", new Headers());
  const text = failedGeneration(err);
  assert.equal(text, reply);
  assert.equal((extractJson(text!) as { slug: string }).slug, "gmail");
  assert.equal(failedGeneration(OpenAI.APIError.generate(401, { error: { message: "bad key" } }, "bad key", new Headers())), null);
});
