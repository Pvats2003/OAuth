import { getGuide } from "@/lib/guides";
import { slugify } from "@/lib/schema";

// Is there already a guide for this app name? Used by /generate before spending a run.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const slug = slugify(q);
  if (!slug) return Response.json({ exists: false });
  for (const s of [slug, `${slug}-live`]) {
    const guide = await getGuide(s);
    if (guide) return Response.json({ exists: true, slug: s, name: guide.name, generated: !!guide.generated });
  }
  return Response.json({ exists: false, slug });
}
