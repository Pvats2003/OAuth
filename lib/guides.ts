import { promises as fs } from "fs";
import path from "path";
import { get, list, put } from "@vercel/blob";
import { GuideSchema, summarize, type Guide, type GuideSummary } from "./schema";

// Seed guides live in data/guides (read-only, committed).
// Generated guides go to Vercel Blob when it is configured, otherwise to data/generated/ on local
// disk. On Vercel the disk is never used: its filesystem is read-only.
// Blob counts as configured with either:
// - BLOB_STORE_ID (OIDC): @vercel/blob authenticates by itself with the Vercel OIDC token, or
// - a read-write token: BLOB_READ_WRITE_TOKEN (or BLOB_DATABASE_READ_WRITE_TOKEN, as some stores name it).

const SEED_DIR = path.join(process.cwd(), "data", "guides");
const LOCAL_DIR = path.join(process.cwd(), "data", "generated");
const BLOB_PREFIX = "guides/";

const blobToken = () => process.env.BLOB_READ_WRITE_TOKEN ?? process.env.BLOB_DATABASE_READ_WRITE_TOKEN;
const blobEnabled = () => Boolean(blobToken() || process.env.BLOB_STORE_ID);
// Pass a token only when there is one; with just BLOB_STORE_ID the SDK uses OIDC on its own.
const blobAuth = (): { token?: string } => {
  const token = blobToken();
  return token ? { token } : {};
};
const onVercel = () => Boolean(process.env.VERCEL);
// Must match the Blob store's own setting, or every save fails. Stores are public unless created as private.
const blobAccess = (): "public" | "private" => (process.env.BLOB_ACCESS?.trim().toLowerCase() === "private" ? "private" : "public");

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
  const res = await get(pathname, { access: blobAccess(), useCache: false, ...blobAuth() });
  if (!res) return null;
  const parsed = GuideSchema.safeParse(JSON.parse(await new Response(res.stream).text()));
  return parsed.success ? parsed.data : null;
}

async function generatedGuides(): Promise<Guide[]> {
  if (!blobEnabled()) return onVercel() ? [] : readDir(LOCAL_DIR);
  const { blobs } = await list({ prefix: BLOB_PREFIX, ...blobAuth() });
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
  if (onVercel()) return null;
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

/** Where generated guides are saved, for log lines. */
export function storageLabel(): string {
  if (!blobEnabled()) return "local disk";
  const via = process.env.BLOB_READ_WRITE_TOKEN
    ? "BLOB_READ_WRITE_TOKEN"
    : process.env.BLOB_DATABASE_READ_WRITE_TOKEN
      ? "BLOB_DATABASE_READ_WRITE_TOKEN"
      : "OIDC with BLOB_STORE_ID";
  return `Vercel Blob via ${via}, access=${blobAccess()}`;
}

/** True when generated guides can't be saved: on Vercel (read-only filesystem) with Blob not configured. */
export function storageMissing(): boolean {
  return onVercel() && !blobEnabled();
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Blob storage not configured");
    this.name = "StorageNotConfiguredError";
  }
}

export async function saveGuide(guide: Guide): Promise<void> {
  const body = JSON.stringify(guide, null, 2);
  // Never fall back to data/generated on Vercel: its filesystem is read-only.
  if (storageMissing()) throw new StorageNotConfiguredError();
  if (blobEnabled()) {
    const access = blobAccess();
    await put(`${BLOB_PREFIX}${guide.slug}.json`, body, {
      access,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      ...blobAuth(),
      // Public blobs are cached by the CDN (a month by default); keep it short so a regenerated guide shows up.
      ...(access === "public" ? { cacheControlMaxAge: 60 } : {}),
    });
    return;
  }
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.writeFile(path.join(LOCAL_DIR, `${guide.slug}.json`), body);
}
