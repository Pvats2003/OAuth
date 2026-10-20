import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-3 py-16 text-center">
      <h1 className="text-2xl font-semibold">No guide here yet</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        <Link href="/generate" className="text-sky-700 underline dark:text-sky-400">
          Generate one
        </Link>{" "}
        or go back to the{" "}
        <Link href="/" className="text-sky-700 underline dark:text-sky-400">
          library
        </Link>
        .
      </p>
    </div>
  );
}
