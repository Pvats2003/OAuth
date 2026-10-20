import { z } from "zod";

// One schema for seed guides and live guides. Derived from data/guides/*.json.

export const Evidence = z.enum(["tested", "sourced", "community", "uncertain"]);
export const Owner = z.enum(["agent", "you", "provider"]);
export const Tier = z.enum(["self_serve", "self_serve_with_review", "review_required", "partner_gated"]);
export const Impact = z.enum(["high", "medium", "low"]);
export const RequiredFor = z.enum(["dev", "production", "both"]);
export const SourceType = z.enum(["official", "third_party", "community"]);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const sourceIds = z.array(z.string());

const Timeline = z.object({
  estimate: z.string().min(1),
  basis: z.string().min(1),
  evidence: Evidence,
});

export const GuideSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes only"),
  name: z.string().min(1),
  website: z.string().url(),
  category: z.string().min(1),
  last_checked: isoDate,
  generated: z.boolean().optional(),
  verdict: z.object({
    tier: Tier,
    difficulty: z.number().int().min(1).max(5),
    summary: z.string().min(1),
    time_to_first_connection: Timeline,
    time_to_production: Timeline,
    top_blockers: z.array(z.string()),
  }),
  key_decision: z.object({
    question: z.string(),
    recommendation: z.string(),
    why: z.string(),
    source_ids: sourceIds,
  }),
  prerequisites: z.array(
    z.object({
      item: z.string(),
      required_for: RequiredFor,
      owner: Owner,
      evidence: Evidence,
      source_ids: sourceIds,
    }),
  ),
  phases: z.array(
    z.object({
      name: z.string(),
      steps: z.array(
        z.object({
          title: z.string(),
          detail: z.string(),
          owner: Owner,
          est_time: z.string(),
          evidence: Evidence,
          source_ids: sourceIds,
        }),
      ),
    }),
  ),
  nuances: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
      impact: Impact,
      evidence: Evidence,
      source_ids: sourceIds,
    }),
  ),
  blockers: z.array(
    z.object({
      symptom: z.string(),
      cause: z.string(),
      fix: z.string(),
      escalation: z.string(),
      evidence: Evidence,
      source_ids: sourceIds,
    }),
  ),
  agent_handoff: z.object({
    agent_can: z.array(z.string()),
    you_must: z.array(z.string()),
  }),
  evidence_log: z.object({
    tested: z.array(z.string()),
    corrected: z.array(z.string()),
    unverified: z.array(z.string()),
  }),
  sources: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string(),
      url: z.string().url(),
      type: SourceType,
      accessed: isoDate,
    }),
  ),
});

export type Guide = z.infer<typeof GuideSchema>;
export type EvidenceLabel = z.infer<typeof Evidence>;
export type OwnerLabel = z.infer<typeof Owner>;
export type TierLabel = z.infer<typeof Tier>;

export type GuideSummary = Pick<Guide, "slug" | "name" | "category" | "generated"> & {
  tier: TierLabel;
  difficulty: number;
  first: string;
  production: string;
};

export function summarize(g: Guide): GuideSummary {
  return {
    slug: g.slug,
    name: g.name,
    category: g.category,
    generated: g.generated,
    tier: g.verdict.tier,
    difficulty: g.verdict.difficulty,
    first: g.verdict.time_to_first_connection.estimate,
    production: g.verdict.time_to_production.estimate,
  };
}

export function slugify(input: string): string {
  let s = input.trim().toLowerCase();
  // "https://www.notion.so/foo" -> "notion"
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (s.includes(".")) s = s.split(".").slice(0, -1).join("-") || s;
  return s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
