import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "OAuth Ready",
  description: "How far is your OAuth app from production? Approval paths, timelines and blockers for AI agent builders.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="no-print border-b border-zinc-200 dark:border-zinc-800">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              <span className="font-mono text-emerald-600 dark:text-emerald-400">✓</span> OAuth Ready
            </Link>
            <div className="flex gap-4 text-sm">
              <Link href="/" className="hover:underline">Library</Link>
              <Link href="/generate" className="rounded-md bg-zinc-900 px-3 py-1 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
                Generate a guide
              </Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <footer className="no-print border-t border-zinc-200 py-4 text-center text-xs text-zinc-500 dark:border-zinc-800">
          Guides are research, not guarantees. Every claim carries an evidence label and a check date.
        </footer>
      </body>
    </html>
  );
}
