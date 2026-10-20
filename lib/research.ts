import { runAgent } from "./agent";
import { runGeminiAgent } from "./geminiAgent";
import { runGroqAgent } from "./groqAgent";
import type { AgentEvent } from "./stages";

// RESEARCH_PROVIDER=anthropic | gemini | groq. When it isn't set, Groq is used if GROQ_API_KEY
// is set, otherwise Anthropic.
export type Provider = "anthropic" | "gemini" | "groq";

export function researchProvider(env: NodeJS.ProcessEnv = process.env): Provider {
  const chosen = env.RESEARCH_PROVIDER?.trim().toLowerCase();
  if (chosen === "anthropic" || chosen === "gemini" || chosen === "groq") return chosen;
  return env.GROQ_API_KEY ? "groq" : "anthropic";
}

/** Env vars the chosen provider needs that are not set. */
export function missingKeys(provider: Provider): string[] {
  const needed = {
    anthropic: ["ANTHROPIC_API_KEY"],
    gemini: ["GEMINI_API_KEY", "TAVILY_API_KEY"],
    groq: ["GROQ_API_KEY", "TAVILY_API_KEY"],
  }[provider];
  return needed.filter((k) => !process.env[k]);
}

export function runResearch(input: string): AsyncGenerator<AgentEvent> {
  const provider = researchProvider();
  if (provider === "groq") return runGroqAgent(input);
  if (provider === "gemini") return runGeminiAgent(input);
  return runAgent(input);
}
