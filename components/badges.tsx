import type { EvidenceLabel, OwnerLabel, TierLabel } from "@/lib/schema";

export const TIERS: Record<TierLabel, { label: string; className: string; blurb: string }> = {
  self_serve: {
    label: "Self-serve",
    className: "bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800",
    blurb: "No provider review. Register and ship.",
  },
  self_serve_with_review: {
    label: "Self-serve with review",
    className: "bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-800",
    blurb: "Works for anyone without review; review only for an optional listing or marketplace.",
  },
  review_required: {
    label: "Review required",
    className: "bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800",
    blurb: "The provider must approve your app before general users can connect.",
  },
  partner_gated: {
    label: "Partner-gated",
    className: "bg-red-100 text-red-800 ring-red-300 dark:bg-red-950 dark:text-red-300 dark:ring-red-800",
    blurb: "Key access needs a partner program or agreement, often with no published timeline.",
  },
};

export function TierBadge({ tier, large }: { tier: TierLabel; large?: boolean }) {
  const t = TIERS[tier];
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ring-1 ring-inset ${t.className} ${
        large ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"
      }`}
    >
      {t.label}
    </span>
  );
}

export function DifficultyDots({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Difficulty ${value} of 5`} title={`Difficulty ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${i <= value ? "bg-zinc-800 dark:bg-zinc-200" : "bg-zinc-300 dark:bg-zinc-700"}`}
        />
      ))}
    </span>
  );
}

export const EVIDENCE: Record<EvidenceLabel, { label: string; className: string; blurb: string }> = {
  tested: {
    label: "Tested",
    className: "bg-emerald-700 text-white border-emerald-700 border-solid",
    blurb: "A person did this in a real setup attempt.",
  },
  sourced: {
    label: "Official",
    className: "bg-zinc-700 text-white border-zinc-700 border-solid dark:bg-zinc-300 dark:text-zinc-900 dark:border-zinc-300",
    blurb: "Stated in the provider's official docs.",
  },
  community: {
    label: "Community",
    className: "text-zinc-600 border-zinc-400 border-solid dark:text-zinc-400 dark:border-zinc-500",
    blurb: "From third-party articles or forums.",
  },
  uncertain: {
    label: "Uncertain",
    className: "text-zinc-500 border-zinc-400 border-dashed dark:text-zinc-400 dark:border-zinc-500",
    blurb: "Inferred, conflicting, or not confirmed.",
  },
};

export function EvidenceBadge({ evidence }: { evidence: EvidenceLabel }) {
  const e = EVIDENCE[evidence];
  return (
    <span
      title={e.blurb}
      className={`print-plain inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${e.className}`}
    >
      {e.label}
    </span>
  );
}

export const OWNERS: Record<OwnerLabel, { icon: string; label: string; blurb: string }> = {
  agent: { icon: "🤖", label: "Agent", blurb: "An AI agent can do this for you: research, drafting, classification." },
  you: { icon: "👤", label: "You", blurb: "Needs you: sign-in, forms, legal terms, documents, payment, videos." },
  provider: { icon: "⏳", label: "Provider", blurb: "The provider reviews or you wait." },
};

export function OwnerBadge({ owner }: { owner: OwnerLabel }) {
  const o = OWNERS[owner];
  return (
    <span
      title={o.blurb}
      className="print-plain inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
    >
      <span aria-hidden>{o.icon}</span>
      {o.label}
    </span>
  );
}

export function GeneratedBadge() {
  return (
    <span
      title="Researched live by the agent; not hand-checked."
      className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 ring-1 ring-inset ring-violet-300 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-800"
    >
      Generated live
    </span>
  );
}

/** [1] [2] links to entries in the Sources list. */
export function Footnotes({ ids, index }: { ids: string[]; index: Record<string, number> }) {
  const known = ids.filter((id) => index[id]);
  if (!known.length) return null;
  return (
    <span className="ml-1 whitespace-nowrap align-super text-[10px]">
      {known.map((id) => (
        <a key={id} href={`#src-${id}`} className="ml-0.5 text-sky-700 hover:underline dark:text-sky-400">
          [{index[id]}]
        </a>
      ))}
    </span>
  );
}
