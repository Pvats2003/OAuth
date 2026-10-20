import { runAgent, type AgentEvent } from "@/lib/agent";
import { isSeed, saveGuide } from "@/lib/guides";
import { rateLimit } from "@/lib/rateLimit";

export const maxDuration = 300;

type ServerEvent = AgentEvent | { type: "saved"; slug: string };

export async function POST(req: Request) {
  const { input } = (await req.json().catch(() => ({}))) as { input?: string };
  const app = (input ?? "").trim().slice(0, 200);
  if (!app) return Response.json({ error: "Enter an app name or website." }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 503 });
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
        for await (const event of runAgent(app)) {
          if (event.type === "done") {
            const guide = event.guide;
            // Never overwrite a hand-checked seed guide.
            if (await isSeed(guide.slug)) guide.slug = `${guide.slug}-live`;
            await saveGuide(guide);
            send({ ...event, guide });
            send({ type: "saved", slug: guide.slug });
          } else {
            send(event);
          }
        }
      } catch (err) {
        console.error("generate failed:", err);
        send({ type: "error", message: err instanceof Error ? err.message : "Generation failed." });
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
