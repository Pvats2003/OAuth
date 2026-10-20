"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { STAGES, type AgentEvent, type Stage } from "@/lib/stages";

type ServerEvent = AgentEvent | { type: "saved"; slug: string };
type Existing = { slug: string; name: string };

export default function Generator({ initialApp, regenerate }: { initialApp: string; regenerate: boolean }) {
  const router = useRouter();
  const [app, setApp] = useState(initialApp);
  const [running, setRunning] = useState(false);
  const [existing, setExisting] = useState<Existing | null>(null);
  const [reached, setReached] = useState<Stage[]>([]);
  const [detail, setDetail] = useState<string>("");
  const [searches, setSearches] = useState<string[]>([]);
  const [pages, setPages] = useState<{ url: string; ok: boolean }[]>([]);
  const [error, setError] = useState<string>("");
  const [doneSlug, setDoneSlug] = useState<string>("");
  const [waiting, setWaiting] = useState<string>("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = app.trim();
    if (!name || running) return;
    setError("");
    setExisting(null);
    if (!regenerate) {
      const res = await fetch(`/api/lookup?q=${encodeURIComponent(name)}`).then((r) => r.json());
      if (res.exists) {
        setExisting({ slug: res.slug, name: res.name });
        return;
      }
    }
    await generate(name);
  }

  async function generate(name: string) {
    setExisting(null);
    setRunning(true);
    setReached([]);
    setDetail("");
    setSearches([]);
    setPages([]);
    setError("");
    setDoneSlug("");
    setWaiting("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: name }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let saved = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as ServerEvent;
          // Any progress after a rate-limit pause means the wait is over.
          setWaiting(event.type === "wait" ? `Waiting for rate limit… retrying in ${event.seconds}s (attempt ${event.attempt} of ${event.of})` : "");
          if (event.type === "stage") {
            setReached((r) => (r.includes(event.stage) ? r : [...r, event.stage]));
            setDetail(event.detail ?? "");
          } else if (event.type === "search") setSearches((s) => [...s, event.query]);
          else if (event.type === "page") setPages((p) => [...p, { url: event.url, ok: event.ok }]);
          else if (event.type === "error") setError(event.message);
          else if (event.type === "saved") saved = event.slug;
        }
      }
      if (saved) {
        setDoneSlug(saved);
        router.push(`/guides/${saved}?fresh=1`);
      } else {
        setError((e) => e || "The connection closed before the guide was finished. Try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setWaiting("");
      setRunning(false);
    }
  }

  const current = reached[reached.length - 1];
  const started = running || reached.length > 0;

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor="app" className="sr-only">
          App name or website
        </label>
        <input
          id="app"
          value={app}
          onChange={(e) => setApp(e.target.value)}
          placeholder="App name or website, e.g. Notion or zoom.us"
          disabled={running}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={running || !app.trim()}
          className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {running ? "Researching…" : regenerate ? "Regenerate" : "Generate"}
        </button>
      </form>

      {existing && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm dark:border-sky-800 dark:bg-sky-950/40">
          A guide for <strong>{existing.name}</strong> already exists.
          <div className="mt-3 flex gap-2">
            <Link href={`/guides/${existing.slug}`} className="rounded-md bg-zinc-900 px-3 py-1.5 text-white dark:bg-zinc-100 dark:text-zinc-900">
              View guide
            </Link>
            <button
              type="button"
              onClick={() => generate(app.trim())}
              className="rounded-md border border-zinc-400 px-3 py-1.5 hover:border-zinc-600"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}

      {started && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <ol className="space-y-2">
            {STAGES.map((s) => {
              const isCurrent = running && s.id === current;
              const isDone = reached.includes(s.id) && !isCurrent;
              return (
                <Fragment key={s.id}>
                <li className="flex items-center gap-3 text-sm">
                  <span className="flex h-5 w-5 items-center justify-center">
                    {isCurrent ? (
                      <span className="h-3 w-3 animate-pulse rounded-full bg-sky-500" />
                    ) : isDone ? (
                      <span className="text-emerald-600">✓</span>
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                    )}
                  </span>
                  <span className={isCurrent ? "font-medium" : isDone ? "" : "text-zinc-400"}>{s.label}</span>
                </li>
                {isCurrent && waiting && (
                  <li role="status" className="ml-8 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                    <span aria-hidden>⏳</span>
                    {waiting}
                  </li>
                )}
                </Fragment>
              );
            })}
          </ol>
          {running && detail && <p className="mt-3 truncate font-mono text-xs text-zinc-500">{detail}</p>}

          {(searches.length > 0 || pages.length > 0) && (
            <div className="mt-5 grid gap-4 border-t border-zinc-200 pt-4 text-xs sm:grid-cols-2 dark:border-zinc-800">
              <div>
                <h3 className="mb-1 font-semibold uppercase tracking-wider text-zinc-500">Searches ({searches.length})</h3>
                <ul className="space-y-1">
                  {searches.map((q, i) => (
                    <li key={i} className="font-mono">🔎 {q}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-1 font-semibold uppercase tracking-wider text-zinc-500">Pages fetched ({pages.length})</h3>
                <ul className="space-y-1">
                  {pages.map((p, i) => (
                    <li key={i} className={`break-all font-mono ${p.ok ? "" : "text-red-600"}`}>
                      📄 {p.url}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {doneSlug && <p className="mt-4 text-sm text-emerald-700">Done. Opening the guide…</p>}
        </div>
      )}

      {error && (
        <div role="alert" className="whitespace-pre-wrap rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
