import { GuideSchema, slugify, type Guide } from "./schema";
import { agentStepCount, selfCheck, uncertainClaims, type PageText } from "./selfcheck";
import type { AgentEvent, Stage } from "./stages";

// Steps shared by every research provider: progress labels, schema validation
// with one repair round, and the self-check.

const REVIEW_WORDS = /review|verif|approv|security|assessment|marketplace|directory|listing|partner|scope|permission|limit|production|publish/i;
export const CONSOLE_URL = /console|dashboard|developer\.|developers\.|\/apps\b|app-?management|create-an-app|register|my-?apps|marketplace\.(.*)\/(develop|build)/i;

/**
 * Pages about the provider calling other services (e.g. Notion "Workers" that fetch tokens for other
 * APIs), not about apps asking the provider's users for access. They rank last.
 */
export const isOutboundPage = (url: string, title = "") =>
  /\/workers?(\/|$|\?|#)|\/automations?(\/|$)/i.test(url) || /\bworkers?\b/i.test(title);

export function stageForSearch(query: string, searches: number): Stage {
  return searches === 0 && !REVIEW_WORDS.test(query) ? "resolve" : "search";
}

/** Thrown for failures of an outside service (LLM, page reader). The page shows a short message. */
export class ProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderError";
  }
}

/** Index just past the "}" that closes the object starting at `start`, or -1. Braces inside strings don't count. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++; // skip the escaped character
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * The first complete JSON object in a model reply. Anything before or after it (prose, notes,
 * ``` fences, a second object) is ignored. If a "{" in leading prose isn't real JSON, the next one is tried.
 */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/^\s*```[a-zA-Z]*\s*$/gm, "");
  let lastError: unknown = new Error("The model did not return JSON.");
  for (let start = cleaned.indexOf("{"); start !== -1; start = cleaned.indexOf("{", start + 1)) {
    const end = balancedEnd(cleaned, start);
    if (end === -1) {
      lastError = new Error("The model's JSON was cut off before it ended.");
      break; // no later "{" can close either
    }
    try {
      return JSON.parse(cleaned.slice(start, end));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function formatIssues(err: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return err.issues
    .slice(0, 40)
    .map((i) => `- ${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("\n");
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

/** Shown when a run can't produce a valid guide; the details go to the server log. */
export const GUIDE_FAILED = "The agent couldn't finish this guide. Try Regenerate.";

export function repairPrompt(error: string, rawText: string): string {
  return `This guide JSON failed validation.\n\nErrors:\n${error}\n\nJSON:\n${rawText}\n\nReturn only the corrected JSON object. Keep all content; change only what's needed to pass validation.`;
}

/**
 * Validate the model's JSON (asking `repair` once to fix errors), then self-check it.
 * `prepare` lets a provider adjust the parsed guide before the self-check.
 */
export async function* finishGuide(opts: {
  rawText: string;
  input: string;
  today: string;
  /** Asks the model to fix the JSON. A generator, so it can report progress (e.g. rate-limit waits). */
  repair: (prompt: string) => AsyncGenerator<AgentEvent, string>;
  prepare?: (guide: Guide) => Guide;
  /** Text of the pages the agent read; the self-check uses it to verify stated durations. */
  pages?: PageText[];
}): AsyncGenerator<AgentEvent> {
  yield { type: "stage", stage: "check", detail: "Validating against the schema" };
  let parsed = tryParse(opts.rawText);
  // Content rules the schema can't express; they share the one repair round.
  const contentIssues = (g: Guide) =>
    agentStepCount(g) < 2
      ? `- phases: at least two steps must have owner "agent" (choosing scopes, drafting form values, justifications or policy text); found ${agentStepCount(g)}`
      : "";

  const problems = parsed.ok ? contentIssues(parsed.guide) : parsed.error;
  if (problems) {
    // Field paths and messages only, never guide text.
    console.error(`guide validation failed for "${opts.input}" (asking the model to repair):\n${problems}`);
    yield { type: "stage", stage: "check", detail: "Fixing schema errors" };
    const repaired = tryParse(yield* opts.repair(repairPrompt(problems, opts.rawText)));
    if (repaired.ok) {
      parsed = repaired;
    } else if (!parsed.ok) {
      console.error(`guide validation failed again after repair for "${opts.input}":\n${repaired.error}`);
      yield { type: "error", message: GUIDE_FAILED };
      return;
    } else {
      // The draft was valid and only missed a content rule; keep it rather than a broken repair.
      console.error(`repair for "${opts.input}" returned invalid JSON; keeping the valid draft:\n${repaired.error}`);
    }
  }

  if (!parsed.ok) return; // unreachable: every invalid path above has returned
  const prepared = opts.prepare ? opts.prepare(parsed.guide) : parsed.guide;
  const { guide, downgrades, fixes } = selfCheck(
    {
      ...prepared,
      slug: slugify(prepared.slug) || slugify(opts.input),
      last_checked: opts.today,
      generated: true,
    },
    { pages: opts.pages ?? [] }, // generated guides: always check durations, even if no page text came back
  );
  if (fixes.length) console.log(`self-check fixes for "${opts.input}": ${fixes.join("; ")}`);
  yield { type: "stage", stage: "check", detail: `${downgrades.length} claim(s) downgraded` };
  yield { type: "done", guide, uncertain: uncertainClaims(guide), downgraded: downgrades.length };
}
