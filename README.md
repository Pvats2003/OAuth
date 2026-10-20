# OAuth Ready

Find out how far your OAuth app is from production, for any provider, before you start.

A developer building an AI agent picks an app (or types any name or URL) and gets a shareable guide: how hard approval is, how long it takes to first connection vs to production, what can block it, and which steps an agent can do for them.

**Live demo:** _link_ · **Repo:** https://github.com/Pvats2003/OAuth

## Setup

You need Node.js 20+ and an Anthropic API key (console.anthropic.com → API keys).

```
git clone https://github.com/Pvats2003/OAuth.git oauth-ready
cd oauth-ready
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm install
npm run dev                  # http://localhost:3000
```

- Without `BLOB_READ_WRITE_TOKEN`, generated guides are saved to `data/generated/` (git-ignored).
- Seed guides live in `data/guides/*.json`. Edit them by hand; the app validates them against `lib/schema.ts` on load.
- Checks: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

### Deploy on Vercel

1. vercel.com → Add New → Project → import this GitHub repo. Framework: Next.js (detected). Deploy.
2. Project → Settings → Environment Variables: add `ANTHROPIC_API_KEY` (Production and Preview).
3. Project → Storage → Create → Blob → connect it to the project. This adds `BLOB_READ_WRITE_TOKEN` automatically.
4. Redeploy (Deployments → ⋯ → Redeploy) so the new variables are picked up.

`/api/generate` runs up to 300 seconds (`maxDuration`) and is limited to 10 runs per IP per hour
(`GENERATE_LIMIT_PER_HOUR`). The limit is kept in memory per server instance, so it stops accidental
bursts, not a determined user.

### Where things are

| Path | What |
| --- | --- |
| `app/page.tsx`, `components/Library.tsx` | Library with search and tier filter |
| `app/guides/[slug]/page.tsx` | Guide page (all sections, footnotes, print styles) |
| `app/generate/page.tsx`, `components/Generator.tsx` | Live generation UI (reads the event stream) |
| `app/api/generate/route.ts` | Runs the agent, streams progress as Server-Sent Events, saves the guide |
| `lib/agent.ts` | Claude with server-side web search + web fetch; schema validation, one repair round |
| `lib/agentPrompt.ts` | System prompt (includes the Gmail guide as the example) |
| `lib/selfcheck.ts` | Downgrades unsourced claims to `uncertain`; strips `tested` from agent output |
| `lib/schema.ts` | Zod schema and types shared by seed and live guides |
| `lib/guides.ts` | Loads seeds; stores generated guides in Vercel Blob or `data/generated/` |

## What I learned

- **The OAuth flow isn't the hard part; the provider's approval gate is.** Token exchange is nearly identical everywhere. What varies is review: none (GitHub), optional marketplace review (Slack), verification plus a yearly paid security audit (Gmail restricted scopes), business verification plus app review (Meta), and partner programs with no published timeline (LinkedIn).
- **"Works in dev" and "works for users" are different milestones.** Google gives you 100 test users in an hour, but their tokens expire after 7 days. Meta works only for people with a role on your app. The guides show both timelines side by side.
- **Each provider has one decision that sets the rest.** OAuth App vs GitHub App; which Gmail scope tier; unlisted vs Slack Marketplace; Instagram Login vs Facebook Login; LinkedIn self-serve vs partner program. Each guide answers it up front.

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Guide opens with | A verdict: tier, difficulty, two timelines, top blockers | Developers first need "an hour or a quarter?" |
| Difficulty model | 4 tiers: self-serve, self-serve with review, review required, partner-gated | Matches the approval mechanisms found across providers |
| Every step | Owner: Agent / You / Provider | Shows what an agent can take on and where waiting happens |
| Every claim | Evidence label + source + check date | Guides age; readers need to know what to trust |
| Output format | One fixed JSON schema for seed and live guides | Live guides stay consistent and comparable |
| Agent boundary | Research and draft; stop before sign-in | Login, legal terms, documents and payment are the developer's |

## How the agent works

Claude with web search and web fetch: resolves the app → searches for review, verification, marketplace and scope-tier requirements → reads official pages → checks the public developer console → fills the schema with evidence labels → validates and self-checks (unsourced claims are downgraded to "uncertain") → saves the guide at its own URL.

## Evidence: what I tested, corrected and couldn't verify

- **Tested:** _update after setup attempts._
- **Corrected:** GitHub OAuth Apps now allow up to 10 callback URLs, not one as older docs and tutorials say; token expiry is on by default.
- **Conflicting sources:** Google gives 3–5 business days for sensitive-scope review on one page and 10 days on another. The guide shows the range.
- **Unverified:** Meta and LinkedIn review timelines (third-party and community only), LinkedIn's refresh-token restriction, whether Slack token rotation is irreversible, Meta's Access Verification gate.

## Limitations

- Production timelines are mostly estimates because providers rarely publish them. Every estimate is labelled.
- Guides go stale as consoles and policies change. A scheduled re-check is the next step.
- Live guides depend on public docs; for poorly documented providers expect more "uncertain" labels.
- No provider approval was completed for this project.
- Five seed guides, not 100. The same agent builds the rest.

## Prior art

Unified.to and Nango publish per-provider OAuth setup guides for their own platforms. OAuth Ready differs by leading with time to production, labelling evidence on every claim, and generating guides on demand for any app.
