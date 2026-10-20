import type { EvidenceLabel, Guide } from "./schema";

export type Downgrade = { where: string; text: string; from: EvidenceLabel; reason: string };

/**
 * Cheap checks after the model returns a valid guide:
 * - an item whose source_ids are empty or point to missing sources -> "uncertain"
 * - a "sourced" item that cites no official source -> "community"
 * - "tested" is reserved for humans -> "uncertain", and evidence_log.tested is emptied
 * - a "sourced" time estimate whose own text says the timeline isn't published -> "uncertain"
 *   (a number the docs don't give is an estimate; "Not published" on its own stays sourced)
 */
const NOT_PUBLISHED = /not (officially )?published|unpublished|no (official |published )?(timeline|sla)|timeline (is )?not (published|stated)/i;
const isUnpublishedEstimate = (estimate: string, text: string) => /\d/.test(estimate) && NOT_PUBLISHED.test(`${estimate} ${text}`);

export function selfCheck(guide: Guide): { guide: Guide; downgrades: Downgrade[] } {
  const g: Guide = structuredClone(guide);
  const byId = new Map(g.sources.map((s) => [s.id, s]));
  const downgrades: Downgrade[] = [];

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

  for (const [label, t] of [
    ["Time to first connection", g.verdict.time_to_first_connection],
    ["Time to production", g.verdict.time_to_production],
  ] as const) {
    if (t.evidence === "tested") t.evidence = "uncertain";
    if (t.evidence === "sourced" && isUnpublishedEstimate(t.estimate, t.basis)) {
      t.evidence = "uncertain";
      downgrades.push({ where: "Verdict", text: `${label}: ${t.estimate}`, from: "sourced", reason: "estimate for an unpublished timeline" });
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
  if (g.evidence_log.tested.length) {
    g.evidence_log.unverified.push(...g.evidence_log.tested.map((t) => `Claimed as tested by the agent (not a human test): ${t}`));
    g.evidence_log.tested = [];
  }
  return { guide: g, downgrades };
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
