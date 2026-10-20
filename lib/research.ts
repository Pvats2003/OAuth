import { runAgent } from "./agent";
import { runGeminiAgent } from "./geminiAgent";
import type { AgentEvent } from "./stages";

// RESEARCH_PROVIDER=anthropic (default) | gemini
export type Provider = "anthropic" | "gemini";

export function researchProvider(): Provider {
  return process.env.RESEARCH_PROVIDER?.trim().toLowerCase() === "gemini" ? "gemini" : "anthropic";
}

/** Env vars the chosen provider needs that are not set. */
export function missingKeys(provider: Provider): string[] {
  const needed = provider === "gemini" ? ["GEMINI_API_KEY", "TAVILY_API_KEY"] : ["ANTHROPIC_API_KEY"];
  return needed.filter((k) => !process.env[k]);
}

export function runResearch(input: string): AsyncGenerator<AgentEvent> {
  return researchProvider() === "gemini" ? runGeminiAgent(input) : runAgent(input);
}
