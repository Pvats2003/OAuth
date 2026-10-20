import Anthropic from "@anthropic-ai/sdk";
import { ProviderError } from "@/lib/finalize";
import { missingKeys, researchProvider, runResearch } from "@/lib/research";
import type { AgentEvent } from "@/lib/stages";
import { isSeed, saveGuide } from "@/lib/guides";
import { rateLimit } from "@/lib/rateLimit";

export const maxDuration = 300;

type ServerEvent = AgentEvent | { type: "saved"; slug: string };

// API errors (credit, rate limit, overload, network, bad key) all mean "try later" to the user.
function userMessage(err: unknown): string {
  if (err instanceof Anthropic.APIError || err instanceof ProviderError) {
    return "The research agent is unavailable right now (API credit or rate limit). Try again shortly.";
  }
  return "Something went wrong while writing the guide. Try again.";
}

export async function POST(req: Request) {
  const { input } = (await req.json().catch(() => ({}))) as { input?: string };
  const app = (input ?? "").trim().slice(0, 200);
  if (!app) return Response.json({ error: "Enter an app name or website." }, { status: 400 });
  const missing = missingKeys(researchProvider());
  if (missing.length) {
    return Response.json({ error: `${missing.join(" and ")} not set on the server.` }, { status: 503 });
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const limit = rateLimit(ip);
  if (!limit.ok) {
    return Response.json(
      { error: `Generation limit reached. Try again in about ${limit.retryAfterMin} minutes.` },
      { status: 429 },
    );
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (e: ServerEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        for await (const event of runResearch(app)) {
          if (event.type === "done") {
            const guide = event.guide;
            // Never overwrite a hand-checked seed guide.
            if (await isSeed(guide.slug)) guide.slug = `${guide.slug}-live`;
            try {
              await saveGuide(guide);
            } catch (err) {
              // Storage, not research: log it as such so the cause is clear in Vercel Logs.
              console.error(
                `saving guide "${guide.slug}" failed (${process.env.BLOB_READ_WRITE_TOKEN ? `Vercel Blob, access=${process.env.BLOB_ACCESS || "public"}` : "local disk"}):`,
                err,
              );
              send({ type: "error", message: "The guide was written but couldn't be saved. Try again shortly." });
              return;
            }
            send({ ...event, guide });
            send({ type: "saved", slug: guide.slug });
          } else {
            send(event);
          }
        }
      } catch (err) {
        // Full detail goes to the server log only; the page gets a short message.
        console.error(`generate failed for "${app}":`, err);
        send({ type: "error", message: userMessage(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
