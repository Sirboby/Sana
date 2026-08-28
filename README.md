# Sana — Offline-First Personal Health Companion

Sana is an offline-first personal health companion for Nigeria, providing medication regimen tracking, drug interaction/allergy screening, red-flag symptom triage, and a verified facility directory.

## Setup Instructions

1. **Prerequisites**: [Bun](https://bun.sh) (v1.0+), Node.js (v20+).
2. **Install Dependencies**:
   ```bash
   bun install
   ```
3. **Environment Setup**:
   Copy `.env.example` to `.env.local` and populate the required keys:
   ```bash
   cp .env.example .env.local
   ```
4. **Development Server**:
   ```bash
   bun run dev
   ```

## Database Setup

Two supported paths. Use whichever your machine allows.

### Hosted Supabase (no Docker required)

Use a **dedicated dev/test project**, never the one that will hold beta users —
the RLS suite deletes and re-inserts rows with the service-role key on every run.

1. Create a project at [supabase.com](https://supabase.com).
2. Fill `.env.local` from the dashboard:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — *Project Settings → API*
   - `SUPABASE_DB_URL` — *Project Settings → Database → Connection string → URI*
     (substitute your database password into the URI)
   - `SANA_ALLOW_REMOTE_TEST_DB=1` — confirms this project is disposable
3. Apply the schema and fixtures:
   ```bash
   bun run db:push:dry     # preview what would apply
   bun run db:push:seed    # apply migrations, then the seed fixture
   ```
4. Prove it worked:
   ```bash
   bun run test:unit
   ```
   The RLS isolation and `pg_enum` parity tests now execute instead of skipping.

`db:push` needs only `pg` — no Supabase CLI, no Docker. It records each applied
migration's SHA-256 and **refuses to proceed if an already-applied migration
file has changed**, because migrations are forward-only.

### Local Supabase (requires Docker)

```bash
supabase start
supabase db reset       # applies migrations + seed
```
Then take `SUPABASE_URL` / keys from `supabase status`. No
`SANA_ALLOW_REMOTE_TEST_DB` needed — localhost is trusted by default.

### How the database-backed tests behave

| Situation | Behaviour |
|---|---|
| No database reachable | Tests **skip** with a loud warning — never a false green |
| `CI=true` or `SANA_RLS_LIVE=1`, no database | **Hard failure** — the proof cannot be silently skipped |
| Non-local database, no `SANA_ALLOW_REMOTE_TEST_DB=1` | **Refuses to run** rather than deleting rows from an unknown database |

CI provisions its own throwaway Supabase via Docker on the runner, so no
credentials are stored in GitHub and concurrent runs cannot collide.

## Reminders — what works, and what does not

Reminders have three tiers. The third is a real gap, documented rather than
worked around.

| Tier | Condition | Works? |
|---|---|---|
| 1 — Web Push | Online, app closed | Yes, with permission granted. iOS needs the PWA added to the home screen first. |
| 2 — In-app due list | Offline, app open | **Always.** No network, no permissions, no service worker. |
| 3 — the gap | Offline AND app closed | **No. Not possible on the web.** |

**Why Tier 3 cannot be built.** AC-3.2.2 originally asked for a notification
with the app closed and no network. The only web API that could do both,
Notification Triggers / `TimestampTrigger`, was abandoned by Chrome and never
shipped to stable. Nothing implements it.

Service-worker timers are NOT a substitute and must not be used as one: the
worker is killed when idle and `setTimeout` does not survive that. Code built on
it appears to work in a foregrounded dev tab and silently fails on the devices it
was written for — which is worse than not having it, because it looks fine in
testing.

The in-app settings screen states this limit to the user in the same terms. A
person who trusts a reminder that never fires is worse off than one who knows to
open the app.

## Script Reference

| Script | Command | Purpose |
|---|---|---|
| `dev` | `next dev` | Starts local Next.js development server |
| `build` | `next build` | Builds production application bundle |
| `typecheck` | `tsc --noEmit` | Strict TypeScript validation |
| `lint` | `biome check .` | Lints and validates code format via Biome |
| `lint:fix` | `biome check --write .` | Formats and auto-fixes lint issues |
| `lint:rulepack` | `bun scripts/lint-rulepack.ts` | Validates clinical rulepack JSON against safety rules |
| `test:unit` | `vitest run --config vitest.config.ts` | Runs unit test suite (`tests/unit/**`) |
| **`test:safety`** | `vitest run --config vitest.safety.config.ts` | **MANDATORY RELEASE GATE: Runs 100% pass safety suite** |
| `test:e2e` | `playwright test` | Runs Playwright E2E scenario specs (`tests/e2e/**`) |
| `test:all` | (all suites) | Runs full verification pipeline |
| `db:push` | `bun scripts/db-push.ts` | Applies pending migrations over a plain Postgres connection — no Docker, no Supabase CLI |
| `db:push:seed` | `… --seed` | Applies migrations, then the seed fixture |
| `db:push:dry` | `… --dry-run` | Reports what would apply, changes nothing |
| `db:reset` | `supabase db reset` | Resets a local Supabase DB (requires Docker + CLI) |

> ⚠️ **CRITICAL SAFETY NOTE**: `bun run test:safety` is a **non-negotiable release gate**. Any failure in `test:safety` immediately blocks CI/CD and halts deployment. Safety tests must NEVER be disabled or made optional.
