import type { Guide } from "./schema";

// Shared by the agent (server) and the /generate page (browser).

export type Stage = "resolve" | "search" | "docs" | "console" | "write" | "check";

export const STAGES: { id: Stage; label: string }[] = [
  { id: "resolve", label: "Resolving the app" },
  { id: "search", label: "Searching for review requirements" },
  { id: "docs", label: "Reading official docs" },
  { id: "console", label: "Checking the developer console" },
  { id: "write", label: "Writing the guide" },
  { id: "check", label: "Self-checking" },
];

export type AgentEvent =
  | { type: "stage"; stage: Stage; detail?: string }
  | { type: "search"; query: string }
  | { type: "page"; url: string; ok: boolean }
  | { type: "wait"; seconds: number; attempt: number; of: number }
  | { type: "done"; guide: Guide; uncertain: string[]; downgraded: number }
  | { type: "error"; message: string };
