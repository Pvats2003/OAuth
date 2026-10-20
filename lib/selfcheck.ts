import type { EvidenceLabel, Guide } from "./schema";

export type Downgrade = { where: string; text: string; from: EvidenceLabel; reason: string };
/** Text of a page the agent actually read, so durations can be checked against it. */
export type PageText = { url: string; text: string };

/**
 * Cheap checks after the model returns a valid guide:
 * - an item whose source_ids are empty or point to missing sources -> "uncertain"
 * - a "sourced" item that cites no official source -> "community"
 * - "tested" is reserved for humans -> "uncertain", and evidence_log.tested is emptied
 * - a "sourced" time estimate whose own text says the timeline isn't published -> "uncertain"
 *   (a number the docs don't give is an estimate; "Not published" on its own stays sourced)
 * - a verdict timeline stays "sourced" only if a read official page states that duration (needs page text)
 * - a marketplace/directory/listing claim must cite a page about the listing, else "uncertain"
 * - tier self_serve with a listing review described in a step or nuance -> self_serve_with_review
 * - source ids written into text ("[g1]", "(sources: n2, n3)") are removed; citations live in source_ids
 * - fewer than two "agent" steps: steps are added from agent_handoff.agent_can (labelled "uncertain")
 */
const LISTING = /\b(marketplace|app directory|integration directory|app store|app gallery|listings?)\b/i;
const LISTING_PAGE = /marketplace|directory|listing|\blist\b|list-|publish|distribut|review|app-?store|gallery|submi(t|ssion)/i;
const REVIEWED = /review|approv/i;

const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does any of these page texts state this duration? ("2–3 days" needs "2 … day" or "3 … day" on a page.) */
function durationStated(estimate: string, texts: string[]): boolean {
  const e = estimate.toLowerCase();
  const nums = e.match(/\d+(?:\.\d+)?/g);
  if (!nums) {
    // No number, e.g. "Same day": the phrase itself must appear on a page.
    const phrase = e.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
    return phrase.length > 3 && texts.some((t) => t.toLowerCase().replace(/\s+/g, " ").includes(phrase));
  }
  const unit = e.match(/\b(minute|min|hour|hr|day|week|month|year)s?\b/)?.[1];
  if (!unit) return false;
  const u = unit === "min" ? "minute" : unit === "hr" ? "hour" : unit;
  return texts.some((t) => nums.some((n) => new RegExp(`(^|[^\\d.])${escape(n)}\\b[^.\\n]{0,30}?\\b${u}`, "i").test(t)));
}

/** Removes source ids that the model wrote into text fields; returns how many it removed. */
function stripSourceIds(g: Guide): number {
  const ids = g.sources.map((x) => x.id).filter(Boolean).sort((a, b) => b.length - a.length).map(escape);
  if (!ids.length) return 0;
  const id = `(?:${ids.join("|")})`;
  const re = new RegExp(`\\s*[\\[(](?:sources?:?\\s*)?${id}(?:\\s*[,;]\\s*${id})*[\\])]`, "g");
  let removed = 0;
  const clean = (x: string) => x.replace(re, () => (removed++, "")).replace(/\s+([.,;:])/g, "$1");
  const v = g.verdict;
  v.summary = clean(v.summary);
  v.top_blockers = v.top_blockers.map(clean);
  for (const t of [v.time_to_first_connection, v.time_to_production]) {
    t.estimate = clean(t.estimate);
    t.basis = clean(t.basis);
  }
  g.key_decision.question = clean(g.key_decision.question);
  g.key_decision.recommendation = clean(g.key_decision.recommendation);
  g.key_decision.why = clean(g.key_decision.why);
  g.prerequisites.forEach((x) => (x.item = clean(x.item)));
  g.phases.forEach((ph) => ph.steps.forEach((x) => ((x.title = clean(x.title)), (x.detail = clean(x.detail)), (x.est_time = clean(x.est_time)))));
  g.nuances.forEach((x) => ((x.title = clean(x.title)), (x.detail = clean(x.detail))));
  g.blockers.forEach((x) => {
    x.symptom = clean(x.symptom);
    x.cause = clean(x.cause);
    x.fix = clean(x.fix);
    x.escalation = clean(x.escalation);
  });
  g.agent_handoff.agent_can = g.agent_handoff.agent_can.map(clean);
  g.agent_handoff.you_must = g.agent_handoff.you_must.map(clean);
  g.evidence_log.corrected = g.evidence_log.corrected.map(clean);
  g.evidence_log.unverified = g.evidence_log.unverified.map(clean);
  return removed;
}

export const agentStepCount = (g: Guide) => g.phases.reduce((n, ph) => n + ph.steps.filter((x) => x.owner === "agent").length, 0);

const NOT_PUBLISHED = /not (officially )?published|unpublished|no (official |published )?(timeline|sla)|timeline (is )?not (published|stated)/i;
const isUnpublishedEstimate = (estimate: string, text: string) => /\d/.test(estimate) && NOT_PUBLISHED.test(`${estimate} ${text}`);

export function selfCheck(
  guide: Guide,
  opts: { pages?: PageText[] } = {},
): { guide: Guide; downgrades: Downgrade[]; fixes: string[] } {
  const g: Guide = structuredClone(guide);
  const byId = new Map(g.sources.map((s) => [s.id, s]));
  const downgrades: Downgrade[] = [];
  const fixes: string[] = [];

  const stripped = stripSourceIds(g);
  if (stripped) fixes.push(`removed ${stripped} source id(s) written into text`);

  function check(item: { evidence: EvidenceLabel; source_ids: string[] }, where: string, text: string) {
    const from = item.evidence;
    const ids = item.source_ids;
    const missing = ids.filter((id) => !byId.has(id));
    if (from === "tested") {
      item.evidence = "uncertain";
      downgrades.push({ where, text, from, reason: "'tested' is only added by humans" });
    } else if (from !== "uncertain" && (ids.length === 0 || missing.length > 0)) {
      item.evidence = "uncertain";
      downgrades.push({
        where,
        text,
        from,
        reason: ids.length === 0 ? "no sources cited" : `cites missing source ${missing.join(", ")}`,
      });
    } else if (from === "sourced" && !ids.some((id) => byId.get(id)?.type === "official")) {
      item.evidence = "community";
      downgrades.push({ where, text, from, reason: "no official source cited" });
    }
    item.source_ids = ids.filter((id) => byId.has(id));
  }

  g.prerequisites.forEach((p) => check(p, "Prerequisite", p.item));
  g.phases.forEach((ph) => ph.steps.forEach((s) => check(s, `Step (${ph.name})`, s.title)));
  g.nuances.forEach((n) => check(n, "Nuance", n.title));
  g.blockers.forEach((b) => check(b, "Blocker", b.symptom));
  g.key_decision.source_ids = g.key_decision.source_ids.filter((id) => byId.has(id));

  // Listing claims must cite a page about the listing itself.
  const listingCheck = (item: { evidence: EvidenceLabel; source_ids: string[] }, where: string, label: string, text: string) => {
    if (item.evidence === "uncertain" || item.evidence === "tested" || !LISTING.test(text)) return;
    const cited = item.source_ids.map((id) => byId.get(id)).filter((x) => x !== undefined);
    if (cited.some((src) => LISTING_PAGE.test(`${src.title} ${src.url}`))) return;
    downgrades.push({ where, text: label, from: item.evidence, reason: "listing claim not cited to a page about the listing" });
    item.evidence = "uncertain";
  };
  g.prerequisites.forEach((p) => listingCheck(p, "Prerequisite", p.item, p.item));
  g.phases.forEach((ph) => ph.steps.forEach((x) => listingCheck(x, `Step (${ph.name})`, x.title, `${x.title} ${x.detail}`)));
  g.nuances.forEach((n) => listingCheck(n, "Nuance", n.title, `${n.title} ${n.detail}`));
  g.blockers.forEach((b) => listingCheck(b, "Blocker", b.symptom, `${b.symptom} ${b.cause} ${b.fix}`));

  // Text of the official pages that were actually read.
  const officialUrls = new Set(g.sources.filter((x) => x.type === "official").map((x) => norm(x.url)));
  // Without page text (e.g. checking a hand-written seed) the duration can't be checked, so the rule is skipped.
  // The app always passes the pages it read, so generated guides are always checked.
  const officialTexts = opts.pages ? opts.pages.filter((p) => officialUrls.has(norm(p.url))).map((p) => p.text) : null;

  for (const [label, t] of [
    ["Time to first connection", g.verdict.time_to_first_connection],
    ["Time to production", g.verdict.time_to_production],
  ] as const) {
    if (t.evidence === "tested") t.evidence = "uncertain";
    if (t.evidence === "sourced" && isUnpublishedEstimate(t.estimate, t.basis)) {
      t.evidence = "uncertain";
      downgrades.push({ where: "Verdict", text: `${label}: ${t.estimate}`, from: "sourced", reason: "estimate for an unpublished timeline" });
    } else if (t.evidence === "sourced" && officialTexts && !durationStated(t.estimate, officialTexts)) {
      t.evidence = "uncertain";
      downgrades.push({ where: "Verdict", text: `${label}: ${t.estimate}`, from: "sourced", reason: "no official page read states this duration" });
    }
  }
  g.phases.forEach((ph) =>
    ph.steps.forEach((st) => {
      if (st.evidence === "sourced" && isUnpublishedEstimate(st.est_time, st.detail)) {
        st.evidence = "uncertain";
        downgrades.push({ where: `Step (${ph.name})`, text: st.title, from: "sourced", reason: "estimate for an unpublished timeline" });
      }
    }),
  );
  // An optional listing review still makes it self_serve_with_review.
  if (g.verdict.tier === "self_serve") {
    const hit =
      g.phases.flatMap((ph) => ph.steps).find((x) => LISTING.test(`${x.title} ${x.detail}`) && REVIEWED.test(`${x.title} ${x.detail} ${x.est_time}`)) ??
      g.nuances.find((x) => LISTING.test(`${x.title} ${x.detail}`) && REVIEWED.test(`${x.title} ${x.detail}`));
    if (hit) {
      g.verdict.tier = "self_serve_with_review";
      fixes.push(`tier raised to self_serve_with_review: "${hit.title}" describes a listing review`);
    }
  }

  // At least two steps an agent can do; fill from the hand-off list if the model left them out.
  const needed = 2 - agentStepCount(g);
  if (needed > 0 && g.phases.length) {
    const titles = new Set(g.phases.flatMap((ph) => ph.steps.map((x) => x.title.toLowerCase())));
    const extra = g.agent_handoff.agent_can.filter((a) => !titles.has(a.toLowerCase())).slice(0, needed);
    const first = g.phases[0];
    first.steps.unshift(
      ...extra.map((a) => ({
        title: a,
        detail: "An AI agent can do this from this guide; check its output before you use it.",
        owner: "agent" as const,
        est_time: "Minutes",
        evidence: "uncertain" as const,
        source_ids: [],
      })),
    );
    if (extra.length) fixes.push(`added ${extra.length} agent step(s) from the hand-off list`);
  }

  if (g.evidence_log.tested.length) {
    g.evidence_log.unverified.push(...g.evidence_log.tested.map((t) => `Claimed as tested by the agent (not a human test): ${t}`));
    g.evidence_log.tested = [];
  }
  return { guide: g, downgrades, fixes };
}

/** Every claim in a guide labelled "uncertain", for reporting. */
export function uncertainClaims(g: Guide): string[] {
  const out: string[] = [];
  const v = g.verdict;
  if (v.time_to_first_connection.evidence === "uncertain") out.push(`Time to first connection: ${v.time_to_first_connection.estimate}`);
  if (v.time_to_production.evidence === "uncertain") out.push(`Time to production: ${v.time_to_production.estimate}`);
  g.prerequisites.forEach((p) => p.evidence === "uncertain" && out.push(`Prerequisite: ${p.item}`));
  g.phases.forEach((ph) => ph.steps.forEach((s) => s.evidence === "uncertain" && out.push(`Step: ${s.title}`)));
  g.nuances.forEach((n) => n.evidence === "uncertain" && out.push(`Nuance: ${n.title}`));
  g.blockers.forEach((b) => b.evidence === "uncertain" && out.push(`Blocker: ${b.symptom}`));
  return out;
}
