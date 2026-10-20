import gmail from "@/data/guides/gmail.json";

// The gold-standard example. Shows depth, tone and how evidence labels are used.
const EXAMPLE = JSON.stringify(gmail, null, 2);

const SCHEMA = `{
  "slug": "lowercase-dashes",
  "name": "Display name (Company)",
  "website": "https://...",
  "category": "e.g. Productivity, CRM, Video conferencing",
  "last_checked": "YYYY-MM-DD (today)",
  "verdict": {
    "tier": "self_serve" | "self_serve_with_review" | "review_required" | "partner_gated",
    "difficulty": 1-5,
    "summary": "2-3 sentences",
    "time_to_first_connection": { "estimate": "...", "basis": "...", "evidence": EVIDENCE },
    "time_to_production": { "estimate": "...", "basis": "...", "evidence": EVIDENCE },
    "top_blockers": ["..."]
  },
  "key_decision": { "question": "...", "recommendation": "...", "why": "...", "source_ids": ["..."] },
  "prerequisites": [{ "item": "...", "required_for": "dev" | "production" | "both", "owner": OWNER, "evidence": EVIDENCE, "source_ids": ["..."] }],
  "phases": [{ "name": "Register" | "Configure" | "Test" | "Go to production",
               "steps": [{ "title": "...", "detail": "...", "owner": OWNER, "est_time": "...", "evidence": EVIDENCE, "source_ids": ["..."] }] }],
  "nuances": [{ "title": "...", "detail": "...", "impact": "high" | "medium" | "low", "evidence": EVIDENCE, "source_ids": ["..."] }],
  "blockers": [{ "symptom": "...", "cause": "...", "fix": "...", "escalation": "...", "evidence": EVIDENCE, "source_ids": ["..."] }],
  "agent_handoff": { "agent_can": ["..."], "you_must": ["..."] },
  "evidence_log": { "tested": [], "corrected": ["..."], "unverified": ["..."] },
  "sources": [{ "id": "short id, e.g. n1", "title": "...", "url": "https://...", "type": "official" | "third_party" | "community", "accessed": "YYYY-MM-DD" }]
}
EVIDENCE = "sourced" | "community" | "uncertain"
OWNER = "agent" | "you" | "provider"`;

const WHAT_MATTERS = `What matters
- The difficulty lives in the approval path, not the OAuth flow itself: app review, verification, security assessments, marketplace or app directory listing, partner programs, scope or permission tiers, user caps, and token expiry or other limits in test/development mode. Search for each of these specifically.
- Always separate time to first working connection (the developer and test users) from time to production (any user who signs up). These are often very different; make the contrast clear.
- Find the one decision that shapes everything else (for example: which app type, which scope tier, public listing vs unlisted) and answer it in key_decision.
`;

const LABELS_OWNERS_TIERS = `Evidence labels (every claim gets one)
- "sourced": stated in official provider docs you fetched.
- "community": from third-party articles, forums or community threads.
- "uncertain": inferred, conflicting, or not confirmed in what you read.
- Never use "tested". Only a human adds that after a real setup attempt. Leave evidence_log.tested empty.
- Every item's source_ids must point to ids in "sources". If an item has no source, give it an empty source_ids list and label it "uncertain".
- If official sources don't publish a timeline, say "Not published" in the basis. Any number you estimate yourself is "uncertain", never "sourced".
- When sources contradict each other or older docs differ from current ones, record it in evidence_log.corrected (what changed and what the guide uses) or evidence_log.unverified (what you couldn't confirm). Your own estimates don't belong in corrected.

Owners
- "agent": research, drafting, classification, generating form values.
- "you": signing in, filling and submitting forms, accepting legal terms, uploading documents, payment, recording videos.
- "provider": reviews, verification and waiting.

Tiers
- self_serve: no provider review to serve any user.
- self_serve_with_review: works for anyone without review; review only for an optional listing/marketplace.
- review_required: the provider must approve before you can serve general users.
- partner_gated: key access needs a partner program or business agreement, often with no published timeline.
`;

// The tier test: an optional listing review never makes an app review_required. Shared by all prompts.
const TIER_TEST = `Choosing the tier (decide this before writing the rest)
- Ask one question: can a user outside your own workspace or team authorize the app before any review or approval is done?
- If yes, the tier is self_serve or self_serve_with_review, even when the provider also offers a reviewed directory,
  marketplace or gallery listing. An optional listing review means self_serve_with_review, and it does not count
  toward time_to_production.
- Being eligible for a listing is not the same as needing one. Words like "eligible", "can be listed", "optional",
  or a review that applies "before being listed" describe an optional listing. Settings that only make an app
  listable (e.g. a public or "any workspace" install scope) don't make the listing required.
- Use review_required or partner_gated only when a review or approval blocks other users from authorizing the app
  (or from getting the scopes it needs), and you can quote the sentence from the pages that says so. Put that quote
  in key_decision.why. If no page says it, the tier is self_serve or self_serve_with_review, and time_to_production
  is the time to serve users without the listing.
- Ignore reviews and approvals for unrelated programs (template galleries, partner or reseller programs, security or
  bug-bounty programs, certifications) unless the page ties them to OAuth or API access.
`;

// Which flow the guide describes, how timelines are labelled, and how citations work. Shared by all prompts.
const FLOW_TIMELINES_CITATIONS = `Which flow to describe
- The main steps are the flow where the developer's app asks the provider's users for access to their own accounts
  (user OAuth: consent screen, authorization code, user tokens).
- Don't build the steps around server-to-server, client-credentials or account-level tokens that only reach the
  developer's own account (for example Zoom "Server-to-Server OAuth"); mention them in a nuance if relevant.
- Don't build the steps around the provider's own features that call other services (for example Notion "Workers"
  that fetch tokens for other APIs, automations, outbound connectors).
- Include at least two steps with owner "agent" (choosing scopes, drafting form values, review justifications,
  privacy policy text).

Timelines
- When no review blocks other users, give time_to_first_connection and time_to_production in minutes or hours,
  unless a page you read states a longer time.
- Label a duration "sourced" only when a page you read states it; otherwise "uncertain".

Citations
- Cite only through source_ids. Never write source ids such as "[n1]" or "(sources: g2)" in text.
- Every marketplace, directory or listing claim must cite the page that describes the listing; otherwise label it
  "uncertain".
`;

const outputRules = (today: string) => `- Use the slug of the product name (e.g. "hubspot", "zoom"), set last_checked and every source's accessed date to ${today}.`;

export function agentSystemPrompt(today: string): string {
  return `You research one provider's OAuth app registration and approval path for a developer building an AI agent. Today is ${today}.

${WHAT_MATTERS}
Research rules
- Prefer the provider's official developer docs. Fetch a page before relying on it; a search snippet is not a source. Only list pages you actually fetched or read in "sources".
- You have a small budget (about 15 searches and fetches in total). Start with one or two searches to find the official OAuth/app registration and app review pages, then fetch the most important ones. Don't fetch the same page twice.
- If you need the developer console, read its public documentation; you can't sign in.

${LABELS_OWNERS_TIERS}
${TIER_TEST}
${FLOW_TIMELINES_CITATIONS}
Output
- When your research is done, reply with only one JSON object matching the schema below. No prose, no markdown fences, no citations outside the JSON.
- Match the depth and style of the example: concrete console paths, numbers, limits, and short plain sentences. Use the four phase names where they apply.
${outputRules(today)}

Schema
${SCHEMA}

Example (Gmail):
${EXAMPLE}`;
}

/**
 * A short version for providers with small per-request token limits (Groq's free tier is
 * 8,000 tokens a minute): no worked example, and the research is already done for the model.
 */
export function compactSystemPrompt(today: string): string {
  return `You write a guide to one provider's OAuth app registration and approval path for a developer building an AI agent. Today is ${today}.

${WHAT_MATTERS}
Sources
- The research is done. The user message holds passages from the pages that were read, each with its URL. Use only these.
- Every entry in "sources" must use one of those URLs exactly. Mark the provider's own pages "official".

${LABELS_OWNERS_TIERS}
${TIER_TEST}
${FLOW_TIMELINES_CITATIONS}
Output
- Reply with only one JSON object matching the schema below. No prose, no markdown fences.
- Be concrete: console paths, numbers, limits, short plain sentences. Use the phase names Register, Configure, Test, Go to production where they apply.
${outputRules(today)}

Schema
${SCHEMA}`;
}

export function agentUserPrompt(input: string): string {
  return `Research the OAuth app registration and approval path for: ${input}

First work out which product and provider this is (if it's a URL or an ambiguous name, pick the product a developer building an AI agent would most likely integrate with). Then research and return the guide JSON.`;
}
