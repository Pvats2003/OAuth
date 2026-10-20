import { promises as fs } from "fs";
import path from "path";
import { del, get, list, put } from "@vercel/blob";
import { GuideSchema, summarize, type Guide, type GuideSummary } from "./schema";

// Seed guides live in data/guides (read-only, committed).
// Generated guides go to Vercel Blob when it is configured, otherwise to data/generated/ on local
// disk. On Vercel the disk is never used: its filesystem is read-only.
// Blob counts as configured with either:
// - BLOB_STORE_ID (OIDC): @vercel/blob authenticates by itself with the Vercel OIDC token, or
// - a read-write token: BLOB_READ_WRITE_TOKEN (or BLOB_DATABASE_READ_WRITE_TOKEN, as some stores name it).
//
// In Blob, each save writes a new file, guides/<slug>/<timestamp>.json, and reads pick the newest one
// found by list() (an API call, never cached). Overwriting one file doesn't work on a public store: get()
// can't bypass the CDN cache for public blobs, so a regenerated guide could show the previous version.
// Older single-file guides (guides/<slug>.json) are still read until they're regenerated.

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

type BlobEntry = { pathname: string; uploadedAt: Date };

/** guides/notion/1760950000000.json or the older guides/notion.json -> "notion". */
function slugOf(pathname: string): string | null {
  return pathname.match(/^guides\/([a-z0-9-]+)(?:\/\d+)?\.json$/)?.[1] ?? null;
}

async function listBlobs(prefix: string, abortSignal?: AbortSignal): Promise<BlobEntry[]> {
  const out: BlobEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, ...blobAuth(), ...(abortSignal ? { abortSignal } : {}) });
    out.push(...page.blobs.map((b) => ({ pathname: b.pathname, uploadedAt: new Date(b.uploadedAt) })));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** The newest file for each slug. */
function newestBySlug(blobs: BlobEntry[]): Map<string, BlobEntry> {
  const newest = new Map<string, BlobEntry>();
  for (const b of blobs) {
    const slug = slugOf(b.pathname);
    if (slug && (!newest.has(slug) || b.uploadedAt > newest.get(slug)!.uploadedAt)) newest.set(slug, b);
  }
  return newest;
}

async function generatedGuides(): Promise<Guide[]> {
  if (!blobEnabled()) return onVercel() ? [] : readDir(LOCAL_DIR);
  const newest = newestBySlug(await listBlobs(BLOB_PREFIX));
  const guides = await Promise.all([...newest.values()].map((b) => readBlob(b.pathname).catch(() => null)));
  return guides.filter((g): g is Guide => g !== null);
}

async function blobFilesFor(slug: string, abortSignal?: AbortSignal): Promise<BlobEntry[]> {
  // "guides/notion" also matches "guides/notion-live/…", so keep only this slug's files.
  return (await listBlobs(`${BLOB_PREFIX}${slug}`, abortSignal)).filter((b) => slugOf(b.pathname) === slug);
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
  if (blobEnabled()) {
    const newest = newestBySlug(await blobFilesFor(slug).catch(() => [])).get(slug);
    return newest ? readBlob(newest.pathname).catch(() => null) : null;
  }
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
    const pathname = `${BLOB_PREFIX}${guide.slug}/${Date.now()}.json`;
    await put(pathname, body, {
      access,
      addRandomSuffix: false,
      contentType: "application/json",
      ...blobAuth(),
    });
    // Remove older versions of this guide. Best effort, capped at 10s (the SDK otherwise retries
    // for minutes): a leftover old file is never shown, because reads pick the newest.
    try {
      const abortSignal = AbortSignal.timeout(10_000);
      const cleanup = (async () => {
        const old = (await blobFilesFor(guide.slug, abortSignal)).filter((b) => b.pathname !== pathname).map((b) => b.pathname);
        if (old.length) await del(old, { ...blobAuth(), abortSignal });
      })();
      // The SDK's retry loop doesn't always stop on abort, so also stop waiting after 10s.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out after 10s")), 10_000);
      });
      cleanup.catch(() => {}); // if the timeout wins, a later failure here is already handled
      try {
        await Promise.race([cleanup, timeout]);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      console.error(`removing older versions of guide "${guide.slug}" failed (not fatal):`, err);
    }
    return;
  }
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.writeFile(path.join(LOCAL_DIR, `${guide.slug}.json`), body);
}
