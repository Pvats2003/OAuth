import Library from "@/components/Library";
import { listGuides } from "@/lib/guides";

export const dynamic = "force-dynamic";

export default async function Home() {
  const guides = await listGuides();
  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">How far is your OAuth app from production?</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          For developers building AI agents. Each guide shows how hard provider approval is, how long it takes to a first
          connection versus to real users, what can block you, and which steps an agent can do for you.
        </p>
      </div>
      <Library guides={guides} />
    </div>
  );
}
