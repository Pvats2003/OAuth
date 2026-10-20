import { promises as fs } from "fs";
import path from "path";
import { get, list, put } from "@vercel/blob";
import { GuideSchema, summarize, type Guide, type GuideSummary } from "./schema";

// Seed guides live in data/guides (read-only, committed).
// Generated guides go to Vercel Blob when BLOB_READ_WRITE_TOKEN is set,
// otherwise to data/generated/ on local disk.

const SEED_DIR = path.join(process.cwd(), "data", "guides");
const LOCAL_DIR = path.join(process.cwd(), "data", "generated");
const BLOB_PREFIX = "guides/";

const blobEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

async function readDir(dir: string): Promise<Guide[]> {
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const guides: Guide[] = [];
  for (const f of files) {
    const parsed = GuideSchema.safeParse(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")));
    if (parsed.success) guides.push(parsed.data);
    else console.error(`Invalid guide ${f}:`, parsed.error.issues.slice(0, 3));
  }
  return guides;
}

async function readBlob(pathname: string): Promise<Guide | null> {
  const res = await get(pathname, { access: "private", useCache: false });
  if (!res) return null;
  const parsed = GuideSchema.safeParse(JSON.parse(await new Response(res.stream).text()));
  return parsed.success ? parsed.data : null;
}

async function generatedGuides(): Promise<Guide[]> {
  if (!blobEnabled()) return readDir(LOCAL_DIR);
  const { blobs } = await list({ prefix: BLOB_PREFIX });
  const guides = await Promise.all(blobs.map((b) => readBlob(b.pathname).catch(() => null)));
  return guides.filter((g): g is Guide => g !== null);
}

export async function seedGuides(): Promise<Guide[]> {
  return readDir(SEED_DIR);
}

/** All guides for the library. A seed guide wins over a generated one with the same slug. */
export async function listGuides(): Promise<GuideSummary[]> {
  const seeds = await seedGuides();
  const seedSlugs = new Set(seeds.map((g) => g.slug));
  const generated = (await generatedGuides()).filter((g) => !seedSlugs.has(g.slug));
  return [...seeds, ...generated].map(summarize).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getGuide(slug: string): Promise<Guide | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const seed = (await seedGuides()).find((g) => g.slug === slug);
  if (seed) return seed;
  if (blobEnabled()) return readBlob(`${BLOB_PREFIX}${slug}.json`).catch(() => null);
  try {
    const parsed = GuideSchema.safeParse(
      JSON.parse(await fs.readFile(path.join(LOCAL_DIR, `${slug}.json`), "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function isSeed(slug: string): Promise<boolean> {
  return (await seedGuides()).some((g) => g.slug === slug);
}

export async function saveGuide(guide: Guide): Promise<void> {
  const body = JSON.stringify(guide, null, 2);
  if (blobEnabled()) {
    await put(`${BLOB_PREFIX}${guide.slug}.json`, body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.writeFile(path.join(LOCAL_DIR, `${guide.slug}.json`), body);
}
