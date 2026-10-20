import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DifficultyDots,
  EVIDENCE,
  EvidenceBadge,
  Footnotes,
  GeneratedBadge,
  OWNERS,
  OwnerBadge,
  TIERS,
  TierBadge,
} from "@/components/badges";
import GuideActions from "@/components/GuideActions";
import { getGuide } from "@/lib/guides";
import type { EvidenceLabel, Guide, OwnerLabel, TierLabel } from "@/lib/schema";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/guides/[slug]">): Promise<Metadata> {
  const guide = await getGuide((await params).slug);
  return { title: guide ? `${guide.name} OAuth guide · OAuth Ready` : "Guide not found · OAuth Ready" };
}

const IMPACT_ORDER = { high: 0, medium: 1, low: 2 } as const;
const IMPACT_STYLE = {
  high: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
} as const;
const REQUIRED_FOR = [
  { key: "dev", label: "For development" },
  { key: "production", label: "For production" },
  { key: "both", label: "For both" },
] as const;
const SOURCE_TYPE = { official: "Official", third_party: "Third party", community: "Community" } as const;

export default async function GuidePage({ params, searchParams }: PageProps<"/guides/[slug]">) {
  const { slug } = await params;
  const guide = await getGuide(slug);
  if (!guide) notFound();
  const fresh = (await searchParams).fresh === "1";

  const srcIndex = Object.fromEntries(guide.sources.map((s, i) => [s.id, i + 1]));
  const v = guide.verdict;

  return (
    <article className="print-open space-y-10">
      {fresh && (
        <div className="no-print rounded-lg border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200">
          New guide generated. Claims marked <EvidenceBadge evidence="uncertain" /> need a human check before you rely on them.
        </div>
      )}

      {/* Header */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            Last checked <time dateTime={guide.last_checked}>{guide.last_checked}</time> · {guide.category} ·{" "}
            <a href={guide.website} className="hover:underline">
              {guide.website.replace(/^https?:\/\//, "")}
            </a>
          </p>
          <GuideActions slug={guide.slug} name={guide.name} generated={!!guide.generated} />
        </div>
        <h1 className="flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight">
          {guide.name}
          {guide.generated && <GeneratedBadge />}
        </h1>
      </header>

      <HowToRead />

      {/* Verdict */}
      <section aria-labelledby="verdict" className="print-plain rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 id="verdict" className="sr-only">Verdict</h2>
        <div className="flex flex-wrap items-center gap-4">
          <TierBadge tier={v.tier} large />
          <span className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            Difficulty <DifficultyDots value={v.difficulty} /> <span className="font-medium">{v.difficulty}/5</span>
          </span>
        </div>
        <p className="mt-4 text-lg leading-relaxed">{v.summary}</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
          <Timeline label="Time to first connection" sub="You and test users" t={v.time_to_first_connection} tone="fast" />
          <div className="hidden items-center text-2xl text-zinc-400 sm:flex" aria-hidden>
            →
          </div>
          <Timeline label="Time to production" sub="Any user" t={v.time_to_production} tone="slow" />
        </div>

        {v.top_blockers.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold">Top blockers</h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {v.top_blockers.map((b) => (
                <li key={b} className="flex gap-2">
                  <span className="text-red-500" aria-hidden>
                    ●
                  </span>
                  {b}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Key decision */}
      <section aria-labelledby="decision" className="print-plain rounded-2xl border-2 border-sky-300 bg-sky-50 p-5 dark:border-sky-800 dark:bg-sky-950/40">
        <h2 id="decision" className="text-xs font-semibold uppercase tracking-wider text-sky-800 dark:text-sky-300">
          Key decision
        </h2>
        <p className="mt-1 text-xl font-semibold">{guide.key_decision.question}</p>
        <p className="mt-3">
          <span className="font-semibold">Recommendation: </span>
          {guide.key_decision.recommendation}
        </p>
        <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-semibold">Why: </span>
          {guide.key_decision.why}
          <Footnotes ids={guide.key_decision.source_ids} index={srcIndex} />
        </p>
      </section>

      {/* Prerequisites */}
      <Section id="prerequisites" title="Prerequisites">
        <div className="grid gap-4 md:grid-cols-3">
          {REQUIRED_FOR.map(({ key, label }) => {
            const items = guide.prerequisites.filter((p) => p.required_for === key);
            return (
              <div key={key} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <h3 className="text-sm font-semibold">{label}</h3>
                {items.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">Nothing extra.</p>
                ) : (
                  <ul className="mt-2 space-y-3 text-sm">
                    {items.map((p) => (
                      <li key={p.item}>
                        <p>
                          {p.item}
                          <Footnotes ids={p.source_ids} index={srcIndex} />
                        </p>
                        <div className="mt-1 flex gap-1.5">
                          <OwnerBadge owner={p.owner} />
                          <EvidenceBadge evidence={p.evidence} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Phases */}
      <Section id="steps" title="Steps">
        <ol className="space-y-8">
          {guide.phases.map((phase, pi) => (
            <li key={phase.name}>
              <h3 className="flex items-center gap-2 font-semibold">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900">
                  {pi + 1}
                </span>
                {phase.name}
              </h3>
              <ol className="ml-3 mt-3 space-y-4 border-l-2 border-zinc-200 pl-6 dark:border-zinc-800">
                {phase.steps.map((s) => (
                  <li key={s.title} className="relative">
                    <span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-400 bg-white dark:bg-zinc-900" />
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{s.title}</p>
                      <OwnerBadge owner={s.owner} />
                      <span className="text-xs text-zinc-500">⏱ {s.est_time}</span>
                      <EvidenceBadge evidence={s.evidence} />
                    </div>
                    <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                      {s.detail}
                      <Footnotes ids={s.source_ids} index={srcIndex} />
                    </p>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </Section>

      {/* Nuances */}
      <Section id="nuances" title="Nuances">
        <ul className="space-y-3">
          {[...guide.nuances]
            .sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact])
            .map((n) => (
              <li key={n.title} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`print-plain rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${IMPACT_STYLE[n.impact]}`}>
                    {n.impact} impact
                  </span>
                  <p className="font-medium">{n.title}</p>
                  <EvidenceBadge evidence={n.evidence} />
                </div>
                <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                  {n.detail}
                  <Footnotes ids={n.source_ids} index={srcIndex} />
                </p>
              </li>
            ))}
        </ul>
      </Section>

      {/* Blockers */}
      <Section id="blockers" title="Blocker playbook">
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-zinc-100 text-xs uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              <tr>
                <th className="p-3">Symptom</th>
                <th className="p-3">Cause</th>
                <th className="p-3">Fix</th>
                <th className="p-3">Escalation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {guide.blockers.map((b) => (
                <tr key={b.symptom} className="align-top">
                  <td className="p-3 font-medium">
                    {b.symptom}
                    <div className="mt-1">
                      <EvidenceBadge evidence={b.evidence} />
                    </div>
                  </td>
                  <td className="p-3">{b.cause}</td>
                  <td className="p-3">
                    {b.fix}
                    <Footnotes ids={b.source_ids} index={srcIndex} />
                  </td>
                  <td className="p-3">{b.escalation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Agent hand-off */}
      <Section id="handoff" title="Agent hand-off">
        <div className="grid gap-4 md:grid-cols-2">
          <HandoffList owner="agent" title="Agent can do" items={guide.agent_handoff.agent_can} />
          <HandoffList owner="you" title="You must do" items={guide.agent_handoff.you_must} />
        </div>
      </Section>

      {/* Evidence log */}
      <Section id="evidence" title="Evidence log">
        <div className="grid gap-4 md:grid-cols-3">
          <LogList title="Tested" items={guide.evidence_log.tested} empty="No setup attempts recorded yet" />
          <LogList title="Corrected" items={guide.evidence_log.corrected} empty="Nothing corrected." />
          <LogList title="Unverified" items={guide.evidence_log.unverified} empty="Nothing open." />
        </div>
      </Section>

      {/* Sources */}
      <Section id="sources" title="Sources">
        <ol className="space-y-2 text-sm">
          {guide.sources.map((s, i) => (
            <li key={s.id} id={`src-${s.id}`} className="flex scroll-mt-20 gap-2">
              <span className="w-6 shrink-0 text-right text-zinc-500">[{i + 1}]</span>
              <div>
                <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-sky-700 hover:underline dark:text-sky-400">
                  {s.title}
                </a>
                <span className="ml-2 text-xs text-zinc-500">
                  {SOURCE_TYPE[s.type]} · accessed {s.accessed}
                </span>
                <div className="hidden break-all text-xs text-zinc-500 print:block">{s.url}</div>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <p className="no-print text-sm">
        <Link href="/" className="text-sky-700 hover:underline dark:text-sky-400">
          ← All guides
        </Link>
      </p>
    </article>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Timeline({
  label,
  sub,
  t,
  tone,
}: {
  label: string;
  sub: string;
  t: Guide["verdict"]["time_to_production"];
  tone: "fast" | "slow";
}) {
  const color =
    tone === "fast"
      ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40"
      : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40";
  return (
    <div className={`print-plain rounded-xl border p-4 ${color}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">{label}</p>
        <EvidenceBadge evidence={t.evidence} />
      </div>
      <p className="text-xs text-zinc-500">{sub}</p>
      <p className="mt-2 text-xl font-bold sm:text-2xl leading-tight">{t.estimate}</p>
      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{t.basis}</p>
    </div>
  );
}

function HandoffList({ owner, title, items }: { owner: OwnerLabel; title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="flex items-center gap-2 font-semibold">
        <span aria-hidden>{OWNERS[owner].icon}</span>
        {title}
      </h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function LogList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{empty}</p>
      ) : (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HowToRead() {
  return (
    <details className="no-print group rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer select-none font-medium">How to read this guide</summary>
      <div className="mt-3 grid gap-5 md:grid-cols-3">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Tiers</h3>
          <ul className="space-y-2">
            {(Object.keys(TIERS) as TierLabel[]).map((t) => (
              <li key={t}>
                <TierBadge tier={t} /> <span className="text-zinc-600 dark:text-zinc-400">{TIERS[t].blurb}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">Difficulty dots run from 1 (minutes) to 5 (months, paid audits).</p>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Who does each step</h3>
          <ul className="space-y-2">
            {(Object.keys(OWNERS) as OwnerLabel[]).map((o) => (
              <li key={o}>
                <OwnerBadge owner={o} /> <span className="text-zinc-600 dark:text-zinc-400">{OWNERS[o].blurb}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Evidence labels</h3>
          <ul className="space-y-2">
            {(Object.keys(EVIDENCE) as EvidenceLabel[]).map((e) => (
              <li key={e}>
                <EvidenceBadge evidence={e} /> <span className="text-zinc-600 dark:text-zinc-400">{EVIDENCE[e].blurb}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">Small [1] links jump to the source behind a claim.</p>
        </div>
      </div>
    </details>
  );
}
