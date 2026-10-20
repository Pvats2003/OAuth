import Generator from "@/components/Generator";

export const metadata = { title: "Generate a guide · OAuth Ready" };

export default async function GeneratePage({ searchParams }: PageProps<"/generate">) {
  const sp = await searchParams;
  const app = typeof sp.app === "string" ? sp.app : "";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Generate a guide</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          An agent searches the provider&apos;s docs for app review, verification, scope tiers and partner programs, then
          writes a guide with an evidence label on every claim. It takes a few minutes.
        </p>
      </div>
      <Generator initialApp={app} regenerate={sp.regenerate === "1"} />
    </div>
  );
}
