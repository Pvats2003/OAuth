"use client";

import Link from "next/link";
import { useState } from "react";

export default function GuideActions({ slug, name, generated }: { slug: string; name: string; generated: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.origin + `/guides/${slug}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", window.location.origin + `/guides/${slug}`);
    }
  }

  const btn =
    "rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500";
  return (
    <div className="no-print flex flex-wrap gap-2">
      <button type="button" onClick={copy} className={btn}>
        {copied ? "Copied ✓" : "Copy link"}
      </button>
      <button type="button" onClick={() => window.print()} className={btn}>
        Print / Save as PDF
      </button>
      {generated && (
        <Link href={`/generate?app=${encodeURIComponent(name)}&regenerate=1`} className={btn}>
          Regenerate
        </Link>
      )}
    </div>
  );
}
