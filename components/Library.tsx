"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { GuideSummary, TierLabel } from "@/lib/schema";
import { DifficultyDots, GeneratedBadge, TierBadge, TIERS } from "./badges";

export default function Library({ guides }: { guides: GuideSummary[] }) {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<TierLabel | "all">("all");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return guides.filter(
      (g) =>
        (tier === "all" || g.tier === tier) &&
        (!q || g.name.toLowerCase().includes(q) || g.category.toLowerCase().includes(q) || g.slug.includes(q)),
    );
  }, [guides, query, tier]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search apps or categories…"
          aria-label="Search guides"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500 sm:max-w-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by tier">
          <FilterButton active={tier === "all"} onClick={() => setTier("all")}>
            All tiers
          </FilterButton>
          {(Object.keys(TIERS) as TierLabel[]).map((t) => (
            <FilterButton key={t} active={tier === t} onClick={() => setTier(t)}>
              {TIERS[t].label}
            </FilterButton>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No guide matches.{" "}
          <Link href={`/generate${query ? `?app=${encodeURIComponent(query)}` : ""}`} className="text-sky-700 underline dark:text-sky-400">
            Generate one{query ? ` for “${query}”` : ""}
          </Link>
          .
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((g) => (
            <li key={g.slug}>
              <Link
                href={`/guides/${g.slug}`}
                className="flex h-full flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-400 hover:shadow dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">{g.name}</h2>
                    <p className="text-xs text-zinc-500">{g.category}</p>
                  </div>
                  <DifficultyDots value={g.difficulty} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <TierBadge tier={g.tier} />
                  {g.generated && <GeneratedBadge />}
                </div>
                <dl className="mt-auto grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-zinc-500">First connection</dt>
                    <dd className="font-medium">{g.first}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">To production</dt>
                    <dd className="font-medium">{g.production}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${
        active
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          : "border-zinc-300 text-zinc-700 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}
