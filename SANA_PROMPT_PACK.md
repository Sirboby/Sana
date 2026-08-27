# Sana — Sequential Prompt Pack

**Companion to:** `SANA_PRD.md`
**Steps:** 16
**Target:** v1 private beta, solo build, 1–2 weeks

---

## How to use this pack

1. **Attach `SANA_PRD.md` to the coding agent's context first**, and keep it there for every prompt. These prompts reference PRD sections by number rather than restating them — that is what keeps each prompt small enough not to exhaust the context window.

2. **Hand over one prompt at a time.** Do not paste ahead. Each prompt ends with a `HANDOFF → STEP n` block; paste that block into the next prompt's context so the agent inherits what it needs.

3. **Do not proceed past a failing gate.** If a gate fails, stop and diagnose. Never adjust a test to make it pass — particularly in the safety suite.

4. **Steps 7 and 8 are the high-stakes ones.** Their gates are the safety suite. A failure there is a blocker, not a warning.

5. **Some failures are intentional.** Step 7's emergency-number validation is designed to fail the build until a human populates the file. That is the feature working.

---

## Corrections to the PRD

Found during Phase 3. Apply these; they are also embedded in the relevant prompts.

| # | PRD ref | Correction | Prompt |
|---|---|---|---|
| C1 | §6.1 | SQL is in reading order, not dependency order. `medications` references `drug_catalog` before it is declared. Reference tables must be created first. | 2 |
| C2 | §6.1 | `updated_at` has a default but nothing maintains it on UPDATE. §7.5 resolves conflicts on that column, so a stale value causes silent data loss. Needs a trigger. | 2 |
| C3 | §14 | "Encrypt full local DB vs. sensitive fields" is forced: IndexedDB cannot index encrypted values, and the §6.4 indexes are load-bearing. Field-level only. | 4 |
| C4 | §11 | Browser at-rest encryption with no user-supplied secret provides no protection against device access. Requires a PIN, or the encryption claim is decorative. | 4 |
| C5 | §5.1 | Screening covers candidate-vs-regimen but never re-screens when the *profile* changes. An allergy recorded after a medication is never checked against it. | 10 |
| C6 | AC-3.2.2 | Not achievable on the web platform. Notification Triggers / `TimestampTrigger` was abandoned by Chrome and never shipped. Offline + app-closed notification is impossible in a PWA. Revised to a three-tier strategy with a documented gap. | 11 |
| C7 | §5.4 / §10.4 | Compiling red-flag rules into the bundle means safety *fixes* ship only via app update. With `skipWaiting` disabled, users can sit on stale safety logic indefinitely. Requires a forced-update path. | 15 |
| C8 | §10 | Rollback is asymmetric: reverting a deploy does not lower a raised `minimum_supported`. The floor must be runtime config, adjustable without a deploy. | 16 |
| C9 | §2.3 / §1.2 | The facility finder was cut from v1 on timeline grounds, but the escalation screen raises the alarm and then goes silent on *where to go* — leaving the highest-stakes flow incomplete. Added back as a data-only directory (F9): no maps, no tiles. | 6, 7, 13a |
| C10 | §5.5 | Curated-only facility data leaves the directory empty outside launch states. Added a third tier: OpenStreetMap discovery, clearly labelled unverified, cached for offline, and barred from the escalation screen by the type system rather than by a flag. | 13a |

---

## Human-verification checklist

These cannot be completed by a coding agent. Start the SMS item now — it takes days.

- [ ] **Emergency numbers** verified against current official sources, per state (blocks step 7's build gate)
- [ ] **Clinician review** of the rulepack, `review_status` set to `clinician_reviewed` (blocks public launch, not beta)
- [ ] **Facility dataset** for each launch state, with every emergency-flagged record confirmed by phone and its `verified_at` / `verified_by` recorded (blocks step 13a)
- [ ] **Launch state(s) decided** — which states ship with facility data
- [ ] **SMS sender ID** approved for Nigerian transactional routing; test real OTP delivery to MTN, Airtel and Glo
- [ ] **Privacy policy** reviewed against actual data flows, every processor correctly named
- [ ] **Landing page copy** reviewed against the APCON prohibition on advertising digital diagnosis or treatment
- [ ] **Supabase region** chosen on measured latency from a Nigerian connection, not assumption
- [ ] **NDPC registration** assessed; annual audit obligation diarised against the 2,000 data subject threshold

---

## Step index

| # | Step | Gate |
|---|---|---|
| 1 | Scaffold, tooling & CI skeleton | Full pipeline green on an empty app |
| 2 | Database schema, RLS & isolation proof | Cross-user read returns zero rows |
| 3 | Zod schemas & shared types | Enum parity with the live database |
| 4 | Local store, encryption & PIN unlock | Entity + outbox write atomicity |
| 5 | Phone OTP auth, consent gate & bootstrap | Offline session tolerance |
| 6 | Reference data pipeline & catalog | Ingredient spot-checks pass |
| 7 | **Red-flag engine** | **All 15 rules + negative cases** |
| 8 | **Screening engine** | **Paracetamol stacking + prohibition assertions** |
| 9 | Sync: push, pull, idempotency & backoff | Second sync produces no duplicates |
| 10 | Medication management & screening gate | Regimen re-screen catches the C5 gap |
| 11 | Dose logging & tiered reminders | Append-only correction integrity |
| 12 | Symptom check & result screens | No condition names; degraded mode fails safe |
| 13 | Health timeline | Decrypt calls scale with page size |
| 13a | **Facility directory & escalation integration** | **Never shows an unverified emergency facility** |
| 14 | Settings, data export & account deletion | Deletion works without the PIN |
| 15 | PWA shell, offline hardening & visual pass | Full offline end-to-end |
| 16 | Deployment, canary & beta gating | Production RLS + clinician gate |

---
---

# Step 1 of 16 — Scaffold, tooling & CI skeleton

```text
You are building "Sana", an offline-first personal health PWA. SANA_PRD.md is in
your context and is the source of truth. Read §0 (conventions), §9.2 (module
layout) and §10.3 (pipeline) before starting.

This is step 1 of 16. Scope is scaffolding ONLY. Do not implement any feature,
schema, or business logic. Do not create UI beyond what the scaffold generates.

## Build

1. Initialise a Next.js 15 App Router project using Bun as runtime and package
   manager. TypeScript in strict mode. Set `"strict": true`,
   `"noUncheckedIndexedAccess": true`, and `"noImplicitOverride": true`.

2. Install and configure:
   - Tailwind CSS v4
   - shadcn/ui (init only — no components yet)
   - Zod
   - Dexie + dexie-react-hooks
   - Biome for lint + format (not ESLint/Prettier — faster, one tool)
   - Vitest + @vitest/coverage-v8
   - Playwright
   - Supabase CLI as a dev dependency

3. Create the exact directory structure from PRD §9.2. Every directory gets a
   `.gitkeep` so the shape is committed even while empty.

4. Create `src/lib/env.ts`: a Zod schema validating every variable in PRD §10.2,
   parsed at module load so a missing var fails fast at boot rather than at first
   use. Export the parsed object. Server-only vars must be in a separate export
   that throws if imported from a client component.

5. Configure three test suites with separate configs:
   - `vitest.config.ts`        → `tests/unit/**`
   - `vitest.safety.config.ts` → `tests/safety/**`
   - `playwright.config.ts`    → `tests/e2e/**`

6. Create `scripts/lint-rulepack.ts`. Per PRD §8, it must validate a rulepack
   JSON file against three hard constraints: no medication named as treatment,
   no dose figures, and no urgency band outside the four enum values. For now it
   operates on `content/rulepack/*.json`; if no file exists it exits 0 with a
   notice. Wire it as `bun run lint:rulepack`.

7. Create ONE placeholder test in `tests/safety/placeholder.safety.test.ts` that
   asserts true. Rationale: the safety gate must exist and run in CI from the
   first commit. It is far harder to add a blocking gate later than to keep one
   green from the start. Add a comment saying exactly that, and that this file is
   deleted in step 7 when real red-flag cases replace it.

8. Create `.github/workflows/ci.yml` implementing PRD §10.3 in order:
   typecheck → lint → lint:rulepack → unit → safety → build → e2e
   The safety job must be a REQUIRED job that blocks the workflow on failure.
   Add a comment marking it as a release gate that must never be made optional.

9. Add these package scripts: `dev`, `build`, `typecheck`, `lint`, `lint:fix`,
   `lint:rulepack`, `test:unit`, `test:safety`, `test:e2e`, `test:all`.

10. `.gitignore` covering `.env*` (except `.env.example`), `.next`, `node_modules`,
    `test-results`, `playwright-report`, `coverage`, `supabase/.branches`,
    `supabase/.temp`. Commit `.env.example` with every var from §10.2, values blank.

11. `README.md`: setup steps, the script table, and an explicit note that
    `test:safety` is a release gate.

## Constraints

- No feature code. No database schema. No Supabase client. No components beyond
  the shadcn init. Those are steps 2–16.
- Do not add a state library. Local data is the state layer; that arrives in step 4.
- Do not scaffold any route under /app yet.

## Verification gate — all must pass before step 2

Run and paste the actual output:

  bun run typecheck     → exits 0, no errors
  bun run lint          → exits 0, no errors
  bun run lint:rulepack → exits 0
  bun run test:unit     → runs, 0 tests, exits 0
  bun run test:safety   → runs, 1 passing test, exits 0
  bun run build         → succeeds
  bun run dev           → serves the default page at localhost:3000

Then confirm:
  - `tree -L 3 -I node_modules` matches PRD §9.2
  - CI workflow job order matches §10.3 exactly
  - Importing the server-only env export from a client component fails

If any check fails, fix it before reporting. Do not report partial success.

## Context handoff to step 2

When the gate passes, output a block titled "HANDOFF → STEP 2" containing:
  - Exact versions installed: Next.js, React, Tailwind, Zod, Dexie, Vitest,
    Playwright, Supabase CLI
  - Absolute path of the project root
  - The env var names in `src/lib/env.ts`, split client vs server
  - Any deviation from these instructions and why
  - Anything a future step must know that isn't already in the PRD
```

**Why item 7 matters:** a blocking safety gate on the first commit, green and empty, so it is never something you "add before launch." Retrofitting a gate that fails the build is a fight; keeping one that already passes is free.

---
---

# Step 2 of 16 — Database schema, RLS & isolation proof

```text
Step 2 of 16 for Sana. SANA_PRD.md is your source of truth. Read §6.1 (schema),
§6.2 (RLS), §7.5 (conflict resolution) and §10.3 (pipeline) before starting.

Scope is database only. No application code, no Supabase client in the app, no UI.

## Two corrections to the PRD — apply these

1. §6.1 lists tables in reading order, not dependency order. `medications` has an
   FK to `drug_catalog`. Create reference tables BEFORE clinical tables.
2. §6.1 declares `updated_at timestamptz not null default now()` but nothing
   maintains it on UPDATE. §7.5 resolves conflicts on that column, so a stale
   value causes silent data loss. Add a trigger.

## Build

1. Initialise local Supabase (`supabase init`, `supabase start`). Confirm it runs.

2. Create forward-only migrations in `supabase/migrations/`, timestamped, one
   concern per file, in this order:

   001_extensions.sql   -- pg_trgm (required by the §6.1 trigram index), pgcrypto
   002_enums.sql        -- all five enums from §6.1
   003_reference.sql    -- drug_catalog, drug_interactions,
                        --   allergy_cross_reference, condition_contraindications,
                        --   facilities, rulepacks  + their indexes
   004_accounts.sql     -- profiles, persons, consents + indexes
   005_clinical.sql     -- allergies, conditions, medications, clinical_events,
                        --   user_facilities  + indexes
   006_audit.sql        -- audit_log + index
   007_triggers.sql     -- updated_at maintenance (below)
   008_rls.sql          -- enable RLS + all policies from §6.2

   Transcribe §6.1 exactly: every column, type, default, constraint, and index.
   Do not "improve" the schema. If something looks wrong, implement as specified
   and flag it in the handoff.

3. In 007, create a `set_updated_at()` trigger function setting
   `NEW.updated_at = now()`, and attach it BEFORE UPDATE to: profiles, persons,
   allergies, conditions, medications. Do NOT attach it to clinical_events —
   that table is append-only and its rows are never updated except to set a
   tombstone.

4. In 008, apply §6.2 in full. Specifically:
   - The owner-scoped `for all` policy, repeated verbatim for persons, consents,
     allergies, conditions, medications, clinical_events, user_facilities
   - `self_profile` on profiles
   - `events_no_mutation` — the append-only enforcement policy. Note it permits
     UPDATE only when `deleted_at is not null`, so a tombstone is the only legal
     mutation
   - Insert-only + own-read policies on audit_log
   - Read-only-to-authenticated on all five reference tables, with NO write policy

5. Create `supabase/seed/seed.sql` with a minimal fixture: two test users
   (A and B), one person each, and 3 drug_catalog rows. This exists to prove
   isolation, not to seed real data — the real catalog arrives in step 6.

6. Write `tests/unit/rls.test.ts`. This is the important part of this step.
   Using the service-role key to provision, and two separate anon clients each
   authenticated as user A and user B respectively, assert:

   a. User A reads their own clinical_events → rows returned
   b. User A reads user B's clinical_events → EXACTLY ZERO ROWS
      (assert on length === 0, not on an error being thrown — a silent empty
      result is the expected RLS behaviour and the thing that must be proven)
   c. Repeat (b) for persons, allergies, conditions, medications, consents,
      user_facilities
   d. User A INSERTs a row with owner_id set to user B → rejected
   e. User A UPDATEs their own clinical_events row setting a non-tombstone
      field → rejected by events_no_mutation
   f. User A UPDATEs their own clinical_events row setting only deleted_at
      → succeeds
   g. User A INSERTs into drug_catalog → rejected
   h. User A SELECTs from drug_catalog → rows returned
   i. Updating any row in persons bumps updated_at above its previous value

7. Add a `db:reset` script (`supabase db reset`) and wire the RLS test into the
   unit suite so CI runs it.

## Constraints

- Forward-only migrations. Never edit a committed migration; add a new one.
- No destructive operations on clinical_events in any migration, now or ever.
- No application code. No Supabase client in src/. That is step 5.
- Do not add columns not in §6.1.

## Verification gate — all must pass before step 3

  supabase db reset     → applies all 8 migrations clean, no errors
  bun run test:unit     → RLS test passes, all 9 assertions
  bun run typecheck     → exits 0
  bun run test:safety   → still passes
  bun run build         → succeeds

Then paste:
  - Output of `supabase db reset`
  - Full RLS test output showing each assertion
  - Output of `\d clinical_events` and `\d medications` from psql
  - Output of: select tablename, rowsecurity from pg_tables
                where schemaname='public';
    Every table must show rowsecurity = true. Any false is a blocker.

Assertion (b) is the one that matters. If cross-user reads return rows, stop and
report — do not continue to step 3 with a leaking database.

## Context handoff to step 3

Output "HANDOFF → STEP 3" containing:
  - Migration filenames created, in order
  - Local Supabase URL, anon key, service role key
  - Exact enum names and their values as implemented
  - Table names with their column count
  - Any place your implementation deviates from §6.1, and why
  - Confirmation that every table reports rowsecurity = true
```

**Why assertion (b) matters:** RLS failures are silent. A missing policy does not error — it returns another person's medical history. Proving isolation with a test now means every later step inherits a database you have verified rather than assumed.

---
---

# Step 3 of 16 — Zod schemas & shared types

```text
Step 3 of 16 for Sana. SANA_PRD.md is your source of truth. Read §0 (conventions),
§5.1 (screening types), §6.1 (schema), §7.2–7.4 (sync contracts) and §8 (rulepack)
before starting.

This step builds the type layer that every later step derives from. Getting it
right here means steps 4–16 cannot drift from the database.

Scope is `src/lib/schemas/` and its tests. No feature code, no UI, no data access.

## Core rule

Zod schemas are the ONLY definition of every boundary type. Types are derived with
`z.infer`. A hand-written `interface` or `type` that duplicates a schema's shape is
a defect — if you find yourself writing one, derive it instead.

## Build

1. `src/lib/schemas/enums.ts` — a Zod enum for each of the five Postgres enums in
   §6.1: sex_at_birth, allergen_type, severity_level, event_type, urgency_band.
   Values must match the database EXACTLY, including order.

2. `src/lib/schemas/ids.ts` — branded ID types using `.brand<'PersonId'>()` etc.
   for: ProfileId, PersonId, AllergyId, ConditionId, MedicationId, EventId,
   DrugId, ConsentId, MutationId. Branding prevents passing a MedicationId where
   a PersonId is expected, which is a real class of bug in a schema this
   interconnected.

   Also export `newId(): string` generating a UUIDv7 (per §0, client-generated,
   time-ordered). Use a maintained library rather than hand-rolling it.

3. `src/lib/schemas/tables.ts` — one schema per table in §6.1, mirroring every
   column, nullability and default:
     ProfileSchema, PersonSchema, ConsentSchema, AllergySchema, ConditionSchema,
     MedicationSchema, ClinicalEventSchema, DrugCatalogSchema,
     DrugInteractionSchema, AllergyCrossReferenceSchema,
     ConditionContraindicationSchema, RulepackSchema, AuditLogSchema

   For each, also export an `Insert` variant with server-managed fields omitted
   (created_at, updated_at) and `owner_id` omitted — per §7.2 the server always
   derives owner_id from the JWT and ignores any client value.

4. `src/lib/schemas/events.ts` — a discriminated union on `event_type` typing the
   `payload` JSONB for each event type in §6.1. At minimum:
     - medication_taken   → { medication_id, dose_amount?, dose_unit?, scheduled_for? }
     - medication_skipped → { medication_id, scheduled_for, reason? }
     - symptom_reported   → { symptom_codes: string[], notes? }
     - triage_completed   → { symptom_codes, urgency_band, matched_rule_id?,
                              red_flag_id? }
     - allergy_recorded / condition_recorded → { record_id }
     - vital_recorded     → { kind, value, unit }
     - note_added         → { text }
     - correction         → { corrects_event_id, reason }

   The union must make an invalid payload for a given event_type a type error.

5. `src/lib/schemas/medication.ts` — the `schedule` JSONB shape referenced by
   AC-3.2.1. Must round-trip losslessly. Support at minimum: fixed times per day,
   interval in hours, and as-needed. Include a discriminant field.

6. `src/lib/schemas/screening.ts` — ScreeningInput, Alert, AlertKind and
   AlertSeverity exactly as specified in §5.1. Derive TS types from these; do not
   copy the PRD's TypeScript blocks as hand-written types.

7. `src/lib/schemas/sync.ts` — request and response schemas for §7.2 push,
   §7.3 pull, §7.4 reference sync. Include the Mutation schema with its
   table/op discriminants.

8. `src/lib/schemas/rulepack.ts` — the §8 document schema, including the
   constraint that `band` accepts only the four urgency_band values.

9. `src/lib/schemas/phone.ts` — Nigerian phone normalisation. Accepts `+234…`,
   `234…`, and `0…` 11-digit forms; outputs E.164. Rejects anything else with a
   useful message. This is used by AC-1.1.1 and AC-1.1.3 in step 5.

10. `src/lib/schemas/index.ts` — barrel export.

11. `src/lib/schemas/parse.ts` — `parseOrThrow<T>` and `safeParseResult<T>`
    helpers so call sites handle validation consistently.

## Tests

`tests/unit/schemas.test.ts`:

  a. ENUM PARITY — connect to the local database, query pg_enum for each of the
     five enums, and assert the values match the Zod enums exactly, including
     order. This is the most valuable test in this step: it fails loudly the
     moment a migration adds an enum value the type layer doesn't know about.

  b. Round-trip: every table schema parses a valid fixture and re-serialises
     identically.

  c. Every table schema REJECTS a fixture missing a required field.

  d. Insert variants reject a payload containing `owner_id`.

  e. Event payload union: a valid payload for each event_type parses; a payload
     valid for one type but attached to another is rejected.

  f. Medication schedule round-trips losslessly for all three schedule kinds
     (AC-3.2.1).

  g. Phone normalisation: `08012345678`, `+2348012345678`, `2348012345678` all
     normalise to the same E.164 value; `1234`, `080123`, and an empty string
     are rejected.

  h. Rulepack schema rejects a document with a `band` outside the four enum
     values (§8).

  i. NO-DUPLICATE-TYPES check: assert that no file in `src/lib/schemas/`
     declares a bare `interface`. Grep-based is fine. Add a comment explaining
     that types must be derived via z.infer.

## Constraints

- No `any`. No type assertions except where Zod branding requires them.
- No data access, no Supabase client, no React.
- Do not modify migrations. If a schema mismatch appears, report it — do not
  silently adjust either side.

## Verification gate — before step 4

  bun run typecheck   → exits 0
  bun run lint        → exits 0
  bun run test:unit   → all schema tests pass, including enum parity
  bun run test:safety → still passes
  bun run build       → succeeds

Then demonstrate branding works: write a throwaway snippet passing a MedicationId
where a PersonId is expected, confirm it is a compile error, paste the error, and
delete the snippet.

## Context handoff to step 4

Output "HANDOFF → STEP 4" containing:
  - Every exported schema name, grouped by file
  - The branded ID type names
  - The event payload union members and their payload shapes
  - The medication schedule discriminant field and its variants
  - The UUIDv7 library chosen and why
  - Any mismatch found between §6.1 and the migrations from step 2
```

**Why test (a) matters:** enum drift between Postgres and the type layer is invisible until something fails to parse in production. A parity test turns it into a red CI run the moment a migration lands.

---
---

# Step 4 of 16 — Local store, encryption & PIN unlock

**Two PRD decisions this resolves.** *Encrypt the whole local DB or just sensitive fields?* — forced by IndexedDB: you cannot index what you encrypt, and the §6.4 indexes are load-bearing. So field-level, and the honest framing is that an attacker with device access sees the *shape* of the data but not its content. *The harder one:* browser at-rest encryption with no user-supplied secret is theatre. If the key is derivable from anything already on the device, encrypting against device-access threats accomplishes nothing.

```text
Step 4 of 16 for Sana. SANA_PRD.md is your source of truth. Read §6.4 (local
schema), §7.1 (sync design), §11 (compliance) and §14 (open items) before starting.

Scope is `src/lib/db/`. No UI beyond a minimal unlock screen. No network, no
Supabase client, no sync — sync is step 9.

## Two decisions this step resolves (PRD §14)

DECISION 1 — Field-level encryption, not full-database.
IndexedDB cannot index encrypted values. The indexes in §6.4 are load-bearing;
encrypting the columns they cover would break every query. So: indexed and
structural columns stay plaintext, content columns are encrypted.

  PLAINTEXT (needed for indexing/queries):
    id, person_id, owner_id, created_at, updated_at, deleted_at,
    event_type, occurred_at, end_date, start_date, is_custom, drug_id
  ENCRYPTED (content):
    persons.display_name, persons.date_of_birth, persons.weight_kg
    allergies.allergen_label, allergies.notes
    conditions.condition_label, conditions.notes
    medications.display_name, medications.notes,
      medications.dose_amount, medications.dose_unit
    clinical_events.payload
  NOT ENCRYPTED:
    drug_catalog, interactions, cross_reference, contraindications, rulepack
    — public reference data, and encrypting it would break offline search

Document in a header comment that this protects content but not structure: an
attacker with device access can see that a user has N medications and when doses
were logged, but not which medications.

DECISION 2 — Key derived from a user PIN.
A key derivable from data already on the device provides no protection against
device access, which is the only threat local encryption addresses. Implement:
  - User sets a 6-digit PIN at first run
  - Random 256-bit data key generated via crypto.getRandomValues
  - Data key wrapped with a key derived from the PIN via PBKDF2-SHA256,
    minimum 210,000 iterations, random 16-byte salt
  - Wrapped key + salt stored in IndexedDB; the PIN never is
  - Unwrapped data key held in memory only, cleared on lock
  - Auto-lock after 5 minutes background, and on explicit lock
  - 10 failed attempts wipes the local store (server data is unaffected — it
    re-syncs after re-auth). Warn the user from attempt 7.

If PBKDF2 unlock takes over 1s on a mid-range device, reduce iterations to the
highest value that stays under 1s and record the number in the handoff.

## Build

1. `src/lib/db/schema.ts` — Dexie database class with the exact stores from §6.4.
   Type every table with the branded ID types and inferred types from step 3.

2. `src/lib/db/crypto.ts`
   - `deriveKek(pin, salt)` — PBKDF2 → AES-GCM key
   - `wrapDataKey` / `unwrapDataKey`
   - `encryptField(key, plaintext)` → { iv, ciphertext }, fresh 12-byte IV per call
   - `decryptField(key, payload)`
   - NEVER reuse an IV. Add a test proving two encryptions of identical
     plaintext produce different ciphertext.

3. `src/lib/db/keyring.ts` — PIN setup, unlock, lock, auto-lock timer, failed
   attempt counter, wipe-on-threshold. Data key in a module-scoped variable,
   never in localStorage, sessionStorage, or React state.

4. `src/lib/db/repositories/` — one repository per entity: persons, allergies,
   conditions, medications, events, reference. Each exposes typed CRUD that:
   - Validates through the step-3 Zod schemas on the way in
   - Encrypts/decrypts the fields listed above transparently, so callers never
     handle ciphertext
   - Filters tombstones (`deleted_at`) from list queries by default

5. `src/lib/db/outbox.ts` — the sync queue (§7.1). Critical requirement:

     EVERY local mutation writes the entity row AND its outbox entry inside a
     SINGLE Dexie transaction.

   If those can diverge, a crash between them either loses a mutation or
   duplicates it. Enforce it by making the repositories the only write path and
   having them own the transaction. There must be no way to write an entity
   without enqueuing its mutation.

   Outbox entry: { seq, mutation_id (UUIDv7), table, op, row, client_updated_at,
   status: 'pending'|'in_flight'|'failed', attempts, last_error }.

6. `src/lib/db/client-id.ts` — a stable per-device client_id, generated once,
   persisted, used by §7.2.

7. Minimal unlock UI at `/unlock`: PIN entry, error states, attempt warning.
   Functional only — visual design is step 15.

## Tests

`tests/unit/db.test.ts` (use fake-indexeddb):

  a. Round-trip: write and read back every entity type; decrypted values equal
     the originals.
  b. Encrypted fields are actually ciphertext in the raw store — read the raw
     Dexie record and assert the value is neither the plaintext nor readable.
  c. Indexed fields ARE plaintext in the raw store.
  d. IV uniqueness: encrypting the same plaintext twice yields different output.
  e. Wrong PIN fails to unwrap and does not corrupt the wrapped key.
  f. Correct PIN after a failed attempt still unlocks.
  g. ATOMICITY: force a failure mid-write and assert neither the entity row nor
     the outbox entry persists. Then a successful write persists BOTH.
  h. Every repository write produces exactly one outbox entry.
  i. Tombstoned rows are excluded from list queries but retrievable by id.
  j. Lock clears the in-memory key; reads after lock fail cleanly rather than
     returning ciphertext or throwing an unhandled error.
  k. 10 failed attempts wipes the store.

## Constraints

- No network code whatsoever in this step.
- Do not implement push/pull. The outbox is written but never drained — step 9.
- Never log decrypted clinical data, even at debug level. Add a comment at every
  decrypt call site.
- No React state holds the data key.

## Verification gate — before step 5

  bun run typecheck   → exits 0
  bun run lint        → exits 0
  bun run test:unit   → all db tests pass
  bun run test:safety → still passes
  bun run build       → succeeds

Then paste:
  - Measured PBKDF2 unlock time and the iteration count you settled on
  - A raw dump of one stored clinical_events record showing payload as
    ciphertext and person_id/occurred_at as plaintext
  - Output of test (g) proving atomicity

## Context handoff to step 5

Output "HANDOFF → STEP 5" containing:
  - Repository names and their method signatures
  - Exact encrypted-field list as implemented
  - PBKDF2 iteration count and measured unlock time
  - Outbox entry shape
  - Keyring API surface (setup, unlock, lock, isUnlocked)
  - Where client_id is stored
  - Any deviation from §6.4 and why
```

**Why test (g) matters:** if the entity write and the outbox write can land separately, you get silent data loss on crash — a logged dose that exists on the device and never reaches the server, or reaches it twice. Making the repositories the sole write path makes that structurally impossible rather than just currently correct.

---
---

# Step 5 of 16 — Phone OTP auth, consent gate & bootstrap

**Nigeria-specific operational risk:** Supabase phone auth needs an SMS provider, and Nigerian A2P delivery is not neutral ground. The DND service on MTN, Airtel and Glo blocks application-to-person SMS by default unless routed as transactional traffic through an approved sender ID. Twilio delivers inconsistently to Nigerian numbers. Termii or Africa's Talking handle local routing properly and cost a fraction as much. **Get the sender ID approved early** — approval takes days, and it becomes a launch blocker precisely because nobody schedules it.

```text
Step 5 of 16 for Sana. SANA_PRD.md is your source of truth. Read §4 US-1.1/1.2/1.3
(acceptance criteria), §2.4 (disclaimer placement), §9.1 (routes) and §11
(compliance) before starting.

Scope is authentication, the consent gate, and first-run bootstrap. No clinical
features. UI is functional, not designed — visual work is step 15.

## Provider note

Supabase phone auth requires an SMS provider. Use Termii or Africa's Talking
rather than Twilio: Nigerian networks block A2P SMS to DND-registered numbers
unless sent as transactional traffic through an approved sender ID, and Twilio's
Nigerian delivery is unreliable. Configure the provider in Supabase Auth settings.
If credentials aren't available yet, implement against Supabase's test OTP mode
and flag it in the handoff as an unresolved launch dependency.

## Build

1. Supabase client setup:
   - `src/lib/supabase/client.ts`  — browser client
   - `src/lib/supabase/server.ts`  — server client for Route Handlers
   - `src/lib/supabase/middleware.ts` — session refresh
   Use @supabase/ssr. Never import the service-role key outside server code.

2. Routes per §9.1: `/signup`, `/login`, `/consent`, `/unlock`.

3. Phone OTP flow using the `phone.ts` normalisation from step 3:
   - Enter phone → normalise to E.164 → `signInWithOtp`
   - Enter 6-digit code → `verifyOtp`
   - Resend with a 60s cooldown
   - Rate limit: max 3 OTP requests per number per 15 minutes, enforced
     server-side, not just in the UI

4. First-run bootstrap, in one transaction on first successful verification:
   - Create the `profiles` row
   - Create a `persons` row with `relationship = 'self'`
   - Both use client-generated UUIDv7 ids
   Idempotent: verifying again must not create duplicates.

5. Consent gate (§2.4, US-1.2). This is a hard gate, not a dismissible modal:
   - `/consent` renders the safety disclaimer with the current version from
     `NEXT_PUBLIC_DISCLAIMER_VERSION`
   - Continue is disabled until the acknowledgement checkbox is checked
   - Accepting writes a `consents` row with consent_type='safety_disclaimer',
     the current version, and granted_at
   - Middleware redirects ANY authenticated route to /consent when no consent
     row exists for the current version
   - A version bump forces re-consent (AC-1.2.4)

6. Route protection middleware, in this order:
   unauthenticated        → /login
   authenticated, no consent for current version → /consent
   consented, PIN not set → /unlock (setup mode)
   consented, PIN set, locked → /unlock (unlock mode)
   all satisfied          → requested route

7. OFFLINE SESSION HANDLING — important, easy to get wrong:
   Supabase refreshes tokens on a timer. Offline, that refresh fails. A naive
   implementation treats the failure as a sign-out and boots the user to /login,
   where they cannot proceed because signup/login require a connection. That
   makes the app unusable offline, defeating its core premise.

   Required behaviour:
   - A refresh failure caused by network unavailability must NOT clear the
     session or redirect
   - While offline with a previously-valid session, the user stays in the app
     with full access to local data
   - Refresh retries when connectivity returns
   - Only an explicit sign-out, or a server-confirmed invalid token, clears the
     session
   - Distinguish "cannot reach the server" from "server says you're
     unauthenticated". Never conflate them.

8. Person switcher (US-1.3): create and switch dependent profiles with name,
   date of birth, sex, relationship. Active person id persisted locally. All
   clinical screens read from the active person (AC-1.3.3).

9. `/app` placeholder page showing the authenticated user's phone and active
   person, proving the whole chain works.

## Tests

`tests/unit/auth.test.ts`:
  a. Phone normalisation is applied before any auth call (AC-1.1.3): an invalid
     format produces a field error and fires NO network request
  b. Bootstrap is idempotent — two verifications create one profile, one person
  c. Consent middleware redirects when no consent row exists
  d. Consent middleware redirects when a consent row exists for an OLD version
  e. Consent middleware passes through when the current version is consented
  f. Rate limiting rejects a 4th OTP request within the window
  g. OFFLINE: given a valid session and a refresh that fails with a network
     error, assert the session is retained and no redirect occurs
  h. Given a refresh that fails with a server 401, assert the session IS cleared

`tests/e2e/auth.spec.ts`:
  i.  Full signup: phone → OTP → consent → PIN setup → /app (AC-1.1.1, 1.1.2)
  j.  Offline signup shows the explicit "connection required" state, not a
      generic error (AC-1.1.4)
  k.  Consent continue is disabled until the box is checked (AC-1.2.2)
  l.  Create a dependent profile, switch to it, verify the switch persists
      across reload (AC-1.3.1)

Tests (g) and (h) are the pair that matters — they prove offline tolerance and
real session invalidation are handled differently.

## Constraints

- Never log OTP codes or phone numbers, at any level.
- Service-role key never reaches the client bundle. Verify by grepping the build
  output for it.
- No clinical features. No medication, allergy, symptom, or timeline code.
- Do not weaken the consent gate for convenience during development. If you need
  to skip it locally, use a seeded consent row, not a bypass flag.

## Verification gate — before step 6

  bun run typecheck   → exits 0
  bun run lint        → exits 0
  bun run test:unit   → all auth tests pass
  bun run test:safety → still passes
  bun run test:e2e    → auth specs pass
  bun run build       → succeeds

Then paste:
  - E2E output for the full signup chain
  - Output of tests (g) and (h) side by side
  - Result of grepping `.next/` for the service-role key — must be zero matches
  - Confirmation that /app is unreachable without consent

## Context handoff to step 6

Output "HANDOFF → STEP 6" containing:
  - Auth route paths and the middleware ordering as implemented
  - SMS provider configured, or a note that test mode is in use
  - The disclaimer version env var name and current value
  - How the active person id is persisted and read
  - The offline-refresh detection mechanism you used
  - Bootstrap function name and where it is invoked
```

**Why item 7 matters:** this is what quietly kills offline-first apps. User goes offline, token refresh fails, the SDK's default handling treats it as a sign-out, the app redirects to login — and login cannot complete without a network. An offline-first app that logs you out when you go offline. It is a two-line distinction between "unreachable" and "unauthenticated," and it has to be made deliberately.

---
---

# Step 6 of 16 — Reference data pipeline & catalog

**Expectation to set:** NAFDAC's greenbook is not an API. Do not budget days for scraping it. At v1 scale, ~800 hand-curated rows beat 20,000 scraped-and-unverified ones — and 800 rows is small enough to load entirely into memory, which makes the sub-100ms search requirement trivial instead of an indexing exercise.

```text
Step 6 of 16 for Sana. SANA_PRD.md is your source of truth. Read §6.3 (sourcing),
§6.1 reference tables, §5.2 (cross-reactivity), §5.3 (contraindications) and
AC-3.1.1 (search performance) before starting.

Scope is reference data: ETL scripts, curated datasets, seeding, and offline
catalog search. No screening logic — that is step 8.

## Priorities

The single most important output of this step is ACCURATE ACTIVE INGREDIENT DATA.
The duplicate-ingredient check (§5.1 stage 4) is the highest-value safety feature
in v1 and it is only as good as this table. A product whose ingredient list is
wrong or missing produces a silent false negative — the exact failure mode that
hurts someone. Prioritise ingredient correctness over catalog size.

## Scope of data

Do NOT attempt to scrape the NAFDAC greenbook. It is not a machine-readable API,
and a scraper is not a good use of this timeline. Instead:

  - RxNorm (free, RxNav REST) → generic names, ingredient codes, drug classes
  - openFDA drug label API (free, 240 req/min) → active ingredients, label text
  - A hand-curated CSV at `content/reference/ng-products.csv` → Nigerian brand
    names mapped to generics, ~800 rows

Target the products actually used in Nigeria. The seed MUST include, at minimum:
  - Paracetamol products, both single-ingredient and COMBINATION cold/flu
    remedies (Panadol variants, Coldrex, Procold and similar). The combination
    products are the whole point — they are what makes paracetamol stacking
    invisible to users.
  - Alabukun and Phensic (aspirin-containing) — widely used, NSAID class
  - Septrin / co-trimoxazole — sulfonamide, load-bearing for both the sulfa
    allergy check and the G6PD contraindication
  - Common antibiotics: amoxicillin, Ampiclox, Augmentin, ciprofloxacin,
    metronidazole
  - Antimalarials: artemether-lumefantrine (Lonart, Coartem), P-Alaxin
  - NSAIDs: ibuprofen, diclofenac
  - Antihistamines: chlorpheniramine (Piriton)

## Build

1. `scripts/etl/fetch-rxnorm.ts` — pull generics, ingredient codes (RxCUI) and
   classes. Cache raw responses to `content/reference/.cache/` so re-runs don't
   re-hit the API. Respect rate limits.

2. `scripts/etl/fetch-openfda.ts` — pull structured active_ingredient fields.
   Cache identically. Handle the 240 req/min limit with backoff.

3. `scripts/etl/build-catalog.ts` — join the three sources into `drug_catalog`
   rows matching §6.1. Requirements:
   - `active_ingredients` is [{code, name, strength, unit}] with a NORMALISED
     ingredient code. Ingredient identity is what duplicate detection compares,
     so "paracetamol" and "acetaminophen" MUST resolve to the same code.
   - `drug_classes` uses a controlled vocabulary. Emit the vocabulary to
     `content/reference/drug-classes.json`. Every class referenced by the
     curated datasets below must exist in it.
   - Any product that cannot be resolved to at least one ingredient is written
     to `content/reference/unresolved.csv` and EXCLUDED from the catalog.
     A product with unknown ingredients is worse than an absent one — it looks
     checkable and isn't.

4. Curated datasets, authored as CSV in `content/reference/`, each row carrying
   a `source` citation:
   - `interactions.csv` — 50–80 class-level pairs per §6.3
   - `cross-reference.csv` — the five classes in §5.2
   - `contraindications.csv` — the six conditions in §5.3, including G6PD
     deficiency (materially prevalent in Nigeria; do not drop it)
   - `facilities.csv` — the F9 directory for the launch state(s) per §6.1.
     Seed candidates from OpenStreetMap/Overpass and any accessible Federal or
     State health facility registry, but EVERY row requires `verified_at` and
     `verified_by`, and the column is `not null` deliberately.

     FACILITY VERIFICATION IS A SAFETY REQUIREMENT, NOT DATA HYGIENE. A row with
     `has_emergency = true` appears on the escalation screen (§2.3), so an
     inaccurate one sends a person in crisis to a hospital that may have closed,
     moved, or never had an emergency department. Do NOT set has_emergency from
     an OSM tag, an inference, or your own judgement — only from a human
     verification record. Emit any facility lacking verification to
     `content/reference/unverified-facilities.csv` and EXCLUDE it, exactly as
     with unresolved drug products.
   Every `explanation` and `recommendation` string is curated prose. Per §0 rule
   2, do NOT generate clinical content. If you lack a citation for a row, leave
   it out and list it in the handoff.

5. `scripts/etl/seed.ts` — load everything into Supabase. Idempotent: safe to
   re-run, upserting on natural keys. Wire as `bun run seed:reference`.

6. `src/lib/reference/search.ts` — offline catalog search.

   IMPLEMENTATION NOTE: at ~800 rows, do not build a Dexie query per keystroke.
   Load the full catalog into memory once on app start and search in JS with a
   simple inverted index over generic name, brand names and ingredient names.
   This makes AC-3.1.1 trivially satisfiable and removes an entire class of
   async-in-the-render-path bugs.

   Match on generic name, brand names, and ingredients. Rank exact prefix above
   substring. Return within 100ms for any 2+ character query.

7. `src/lib/reference/sync.ts` — client half of §7.4: fetch reference data since
   a watermark, verify the rulepack checksum, write to the local store. Do not
   apply a rulepack that fails its checksum (§7.4). Facilities are scoped by the
   `states` query parameter — do not sync the whole country to every device.

8. `src/lib/facilities/distance.ts` — haversine distance, pure, on-device. No
   PostGIS, no server round-trip. At a few thousand rows this is ample and it
   removes an entire server-side query path.

## Tests

`tests/unit/reference.test.ts`:
  a. Search returns results for a 2-character query in under 100ms with the full
     catalog loaded (AC-3.1.1). Assert on measured time.
  b. Searching a brand name returns the product; searching its generic returns
     it too.
  c. INGREDIENT NORMALISATION: paracetamol and acetaminophen resolve to the
     same ingredient code.
  d. Every catalog row has at least one active ingredient with a non-null code.
  e. Every drug_class referenced in interactions.csv, cross-reference.csv and
     contraindications.csv exists in the controlled vocabulary. No orphans.
  f. Every curated row has a non-empty source citation.
  g. Reference sync rejects a rulepack whose checksum does not match and retains
     the previous pack.
  h. FACILITY VERIFICATION — every facility row has a non-null `verified_at` and
     `verified_by`. Assert zero rows without them.
  i. Every row with `has_emergency = true` has a phone number and a verification
     date. A facility that cannot be called is of limited use in an emergency.
  j. Haversine distance is correct against three known coordinate pairs.
  k. Facility sync scoped to one state returns only that state's rows.

`tests/unit/reference-spotcheck.test.ts` — CONTENT CORRECTNESS.
  Hand-verify a fixed list of at least 15 products against their real ingredient
  lists, and assert the seeded data matches. Must include:
    - At least 3 paracetamol combination products, asserting paracetamol is
      present in each
    - Septrin / co-trimoxazole, asserting sulfonamide class
    - Alabukun, asserting aspirin and NSAID class
    - Amoxicillin and Ampiclox, asserting penicillin class
  This test is the guard against a plausible-looking but wrong catalog. Treat a
  failure as a data defect, not a test to relax.

## Constraints

- Do not generate any clinical content. Curate with citation, or omit.
- Do not include a product with unresolved ingredients.
- Do not set `has_emergency` from an OSM tag, an inference, or your judgement.
  Human verification only.
- Do not include an unverified facility.
- ETL scripts must be re-runnable without duplicating rows.
- No screening logic. No UI. Search is a library function in this step.

## Verification gate — before step 7

  bun run seed:reference → completes, reports rows loaded per table
  bun run test:unit      → all reference tests pass, including spot-checks
  bun run typecheck      → exits 0
  bun run lint           → exits 0
  bun run test:safety    → still passes
  bun run build          → succeeds

Then paste:
  - Row counts per reference table
  - Measured search latency for a 2-character query
  - Contents of unresolved.csv, with a count
  - Full output of the spot-check test
  - The controlled class vocabulary

## Context handoff to step 7

Output "HANDOFF → STEP 7" containing:
  - Row counts per reference table
  - The controlled drug-class vocabulary, in full — step 8 depends on these exact
    strings
  - Ingredient code scheme used (RxCUI or other) and how synonyms are collapsed
  - Search API signature and measured latency
  - Products excluded as unresolved, and why
  - Any curated row omitted for lack of a citation
```

**Why exclusion beats inclusion:** a drug in the catalog with no ingredient data passes silently through the duplicate check and reports "no issues found" — which the user reads as *safe*. An absent drug forces the `is_custom` path, which tells them explicitly it could not be checked. Absent is honest; present-but-hollow is a false negative wearing a green tick.

---
---

# Step 7 of 16 — Red-flag engine

**Two things to settle first.** *Emergency numbers are a config file a human fills in — never model-generated.* §14 flagged that they vary by state; the fix is not for the agent to look them up, but for the numbers to live in a file you personally verify, with the build failing until it is populated. A hallucinated emergency number on a chest-pain screen is the worst bug this app could ship. *When age is unknown, over-triage.* If a person record has no date of birth, evaluate every age-scoped rule rather than suppressing them. Over-triage sends someone to a clinic unnecessarily; under-triage does the other thing. It is the only asymmetric tradeoff in the app where the noisy side is obviously correct.

```text
Step 7 of 16 for Sana. SANA_PRD.md is your source of truth. Read §2 IN FULL —
it is normative and overrides every other instruction — plus §5.4, §12.2 and
AC-6.1.1/6.1.2/6.1.6.

This is the highest-stakes step in the build. Its gate is the safety suite.

Scope: the red-flag evaluation engine and the escalation screen. No triage
guidance, no urgency bands beyond EMERGENCY, no screening logic.

## Non-negotiable architectural constraint

The red-flag engine is COMPILED INTO THE APPLICATION BUNDLE. It must NOT be
loaded from, parameterised by, or fall back to the rulepack. Rationale (§5.4,
AC-6.1.6): a corrupt, stale, or missing rulepack must degrade non-emergency
guidance while leaving emergency detection fully intact. Changing a red-flag rule
requires a code change and a passing safety suite — that is the point.

Any implementation that reads red-flag rules from the rulepack is wrong, even if
its tests pass. Add a test asserting the engine module imports nothing from
`lib/engine/rulepack`.

## Emergency contact numbers

Create `content/emergency-numbers.json`, structured as a national default plus
optional state overrides. Do NOT populate it with numbers you believe to be
correct. Seed it with an empty structure and a REQUIRED placeholder that fails
validation until a human fills it in.

Add `scripts/validate-emergency-numbers.ts` to the build chain: it fails the
build if any placeholder remains. A wrong emergency number rendered on a
chest-pain screen is the most damaging defect this application can ship, and it
is not a thing a coding agent should determine. Flag it in the handoff as a
human-verification blocker.

## Build

1. `src/lib/engine/redflag-codes.ts` — the compiled-in symptom vocabulary for
   red flags. One code per distinguishable finding referenced by §2.3 (e.g.
   SYM_CHEST_PAIN, SYM_BREATHING_DIFFICULTY, SYM_FACE_DROOP, SYM_ARM_WEAKNESS,
   SYM_SPEECH_DIFFICULTY, SYM_SEVERE_BLEEDING, SYM_UNRESPONSIVE, SYM_SEIZURE,
   SYM_STIFF_NECK, SYM_RASH, SYM_FEVER, SYM_ABDO_RIGID, SYM_FACE_SWELLING,
   SYM_HIVES, SYM_SUICIDAL_IDEATION, SYM_SUSPECTED_OVERDOSE,
   SYM_VAGINAL_BLEEDING, SYM_SEVERE_HEADACHE_VISUAL, SYM_REDUCED_FETAL_MOVEMENT,
   SYM_SUNKEN_EYES, SYM_NO_TEARS, SYM_LETHARGY, SYM_NO_URINE_8H,
   SYM_NEW_CONFUSION). Each with a plain-language label suitable for a picker.

2. `src/lib/engine/redflags.ts` — the evaluator, exactly per §5.4:

     function evaluateRedFlags(
       symptoms: SymptomCode[],
       profile: ProfileContext
     ): RedFlagMatch | null;

   - Pure. Synchronous. No I/O, no async, no imports outside types and the
     compiled rule table.
   - Implements ALL FIFTEEN rules RF001–RF015 from §2.3, each with its id.
   - Composite rules are conjunctions: RF007 requires fever AND stiff neck AND
     rash. RF003 matches on ANY of the three FAST findings.
   - Returns the FIRST match by rule id order, with its id, so results are
     deterministic and traceable.

3. Age and pregnancy scoping in ProfileContext:
   - RF001 adult-scoped
   - RF012 requires isPregnant
   - RF013 requires age under 3 months
   - RF014 requires child age band
   - All others apply universally

   AGE-UNKNOWN RULE: when date_of_birth is null, DO NOT suppress any age-scoped
   rule. Evaluate all of them. Over-triage is the correct failure direction for
   emergency detection; a missed infant fever is not recoverable, an unnecessary
   clinic visit is. Add a comment stating this reasoning so nobody "optimises"
   it later, and cover it with a test.

4. `src/features/check/EmergencyScreen.tsx` per AC-6.1.2 and §2.3:
   - Full-screen, rendered above all other UI
   - Not dismissible by back button, escape key, or outside click. Requires an
     explicit acknowledgement action.
   - PRIMARY action: call emergency services, as a `tel:` link built from the
     verified config. Visually dominant.
   - SECONDARY action slot: nearest verified emergency facility. LEAVE THIS
     SLOT EMPTY IN THIS STEP — it is wired in step 13a once facility data
     exists. Build the layout to accommodate it and render nothing for now.
     Rationale (§2.3): ambulance dispatch is unreliable across much of Nigeria,
     so for many users the real next step is getting themselves to a hospital.
     An escalation screen that raises the alarm and goes silent on where to go
     leaves the emergency path incomplete.
   - NO OTHER navigation, links, or CTAs beyond those two slots
   - Names the matched concern in plain language — never a condition name
   - Renders identically offline: no network calls, no remote fonts, no remote
     images in this component
   - Highest-contrast treatment available

5. Delete `tests/safety/placeholder.safety.test.ts` from step 1. It has served
   its purpose — the gate is now real.

## Safety suite — the gate

`tests/safety/redflags.safety.test.ts`. Per §12.2, 100% pass required, zero
tolerance, blocks deploy.

  a. FIFTEEN POSITIVE CASES — one per rule RF001–RF015. Each asserts a match,
     the correct rule id, and that the outcome is EMERGENCY. Every rule must
     have a case; a missing one is an incomplete step.

  b. NEGATIVE CASES — at least 10 symptom sets that must NOT escalate. Include
     near-misses that exercise conjunctions:
       - fever alone → no match
       - fever + rash, no stiff neck → no match (RF007 needs all three)
       - stiff neck alone → no match
       - mild headache → no match
       - abdominal pain without rigidity → no match
     Over-triage is a real harm: it trains users to dismiss alerts, which
     disarms the feature. These cases guard against it.

  c. AGE SCOPING — infant fever at 38.0°C in a 2-month-old matches RF013; the
     same finding in a 6-month-old does not.

  d. AGE UNKNOWN — with date_of_birth null, the infant rule still evaluates.

  e. PREGNANCY SCOPING — RF012 findings match when isPregnant, not otherwise.

  f. DETERMINISM — the same input evaluated 100 times returns an identical
     result, including the same rule id when several could match.

  g. RULEPACK INDEPENDENCE — with the rulepack absent, corrupt, and
     checksum-failed, red-flag evaluation produces identical results in all
     three states (AC-6.1.6).

  h. NO RULEPACK IMPORT — assert `lib/engine/redflags.ts` has no import path
     containing 'rulepack'.

  i. PROHIBITION ASSERTIONS (§12.2 item 7) — for every one of the 15 rules,
     render the escalation copy and assert it contains no dose pattern
     (/\d+\s?(mg|ml|g|mcg|iu)/i) and no treatment verb pattern
     (/\b(take|use|apply|swallow)\b/i).

  j. OFFLINE PARITY — evaluation with network disabled is identical to online.

`tests/e2e/redflag.spec.ts`:
  k. Select chest pain → escalation screen renders → back button does not
     dismiss it → escape does not dismiss it → exactly one primary action is
     present, and the secondary facility slot renders nothing (AC-6.1.2).

## Constraints

- No language model anywhere in this path (§2.2 prohibition 6).
- No async, no network, no I/O in the evaluator.
- Do not populate emergency numbers yourself.
- Do not add urgency bands other than EMERGENCY — that is step 12.
- If any part of §2 appears to conflict with these instructions, §2 wins: stop
  and report the conflict.

## Verification gate — before step 8

  bun run validate:emergency-numbers → fails until a human populates the file.
     This failure is EXPECTED and is the correct behaviour. Report it as a
     human-verification blocker rather than working around it.
  bun run test:safety → ALL cases pass. Not most. All.
  bun run test:unit   → passes
  bun run test:e2e    → redflag spec passes
  bun run typecheck / lint / build → pass

Then paste:
  - Full safety suite output showing all 15 positive and all negative cases
  - Output of test (g), the rulepack-independence case
  - Output of test (h)
  - A screenshot or DOM dump of the escalation screen
  - Confirmation that the placeholder safety test is deleted

If any safety case fails, STOP. Do not proceed to step 8, do not adjust the test
to pass, and do not mark the step complete. Report the failure.

## Context handoff to step 8

Output "HANDOFF → STEP 8" containing:
  - The full red-flag symptom code vocabulary
  - Rule ids with their trigger conditions as implemented
  - RedFlagMatch and ProfileContext shapes
  - The emergency-numbers config structure and its current unpopulated state
  - Confirmation that the engine imports nothing from the rulepack
  - Safety case count: positives, negatives, total
```

**Why the negative cases matter:** teams instrument the positives and skip the negatives, and the app ships escalating on every fever. Users learn within a week that the red screen means nothing — and then it means nothing on the day it matters. Over-triage is not a softer failure than under-triage; it is a slower one.

---
---

# Step 8 of 16 — Screening engine

**The governing idea:** an empty result is itself a claim. "No issues found" is read as *safe*. If one of the user's medications is a custom entry the engine could not resolve to ingredients, that claim is false — and false in the direction that gets someone hurt. So the result has three states, not two: **clear**, **alerts**, and **incomplete check**.

```text
Step 8 of 16 for Sana. SANA_PRD.md is your source of truth. Read §2 IN FULL
(normative), §5.1 (evaluation order), §5.2, §5.3, §12.2 items 3–10, and
AC-5.1.1 through AC-5.1.8.

Second-highest-stakes step. Its gate is the safety suite.

Scope: `src/lib/engine/screening.ts` and its safety tests. No UI — the add-
medication flow is step 10.

## The governing design rule

An empty alert list is a positive claim that the medication is safe for this user.
That claim is FALSE whenever any medication involved could not be resolved to
ingredients. The result type must therefore be tri-state:

  'CLEAR'      — every input fully checkable, no alerts
  'ALERTS'     — one or more alerts raised
  'INCOMPLETE' — one or more medications could not be checked

'INCOMPLETE' must NEVER be rendered as, collapsed into, or reported alongside a
"no issues found" message. When a check is incomplete, the limitation is the
headline. Encode this in the return type so it cannot be got wrong downstream:

  type ScreeningResult =
    | { status: 'CLEAR' }
    | { status: 'ALERTS'; alerts: Alert[]; uncheckable: string[] }
    | { status: 'INCOMPLETE'; uncheckable: string[]; alerts: Alert[] };

Make 'CLEAR' unconstructible when `uncheckable` is non-empty.

## Build

1. `src/lib/engine/screening.ts` implementing §5.1 exactly:

     function screen(input: ScreeningInput): ScreeningResult;

   - Pure. Synchronous. No I/O, no network, no async (AC-5.1.7).
   - All seven stages ALWAYS run; alerts accumulate. Do not short-circuit — a
     user with both an allergy and a duplicate ingredient must see both.
   - Sort by severity descending: CRITICAL, SERIOUS, CAUTION, INFO. Ties break
     on alert kind order, then alert id, so ordering is fully deterministic.

   Stage 1 — Uncheckable guard: `candidate.is_custom` or any active medication
     with is_custom emits UNCHECKABLE naming that medication, and ingredient-
     level stages skip it (AC-5.1.8).

   Stage 2 — Direct allergy: candidate ingredient codes ∩ user drug allergen
     codes → CRITICAL, kind ALLERGY_DIRECT (AC-5.1.1).

   Stage 3 — Cross-class allergy: candidate drug_classes ∩ cross_reference rows
     for the user's allergen classes → SERIOUS, kind ALLERGY_CROSS_CLASS.
     The copy must make clear this is a CLASS CROSS-REACTION, not a direct
     match, and carry the risk level from the data (AC-5.1.2). Users act
     differently on "you are allergic to this" versus "this is related to
     something you react to"; conflating them is a defect.

   Stage 4 — Duplicate active ingredient: candidate ingredient codes ∩ union of
     active medications' ingredient codes → SERIOUS, kind DUPLICATE_INGREDIENT.
     Must name BOTH products and the SHARED INGREDIENT (AC-5.1.3).
     This is the flagship safety feature. It is the check that catches a user
     taking a combination cold remedy alongside plain paracetamol, which is the
     most common serious OTC poisoning route worldwide and is completely
     invisible to the user because the brand names differ.

   Stage 5 — Interaction: candidate classes × active medication classes against
     drug_interactions, severity from the data.

   Stage 6 — Condition contraindication: candidate classes × user conditions
     against condition_contraindications (AC-5.1.4).

   Stage 7 — Pregnancy caution: when profile.isPregnant, candidate classes
     against the pregnancy-caution list.

2. Alert copy comes from the rulepack `alertCopy` templates (§8) with variable
   interpolation, or from the curated `explanation` / `recommendation` columns
   in the reference tables. NEVER generate alert prose at runtime, and never
   hardcode clinical wording in the engine (§0 rule 2).

3. Every alert carries `rulepackVersion` (AC-5.1.5) and the mandatory disclaimer
   from §2.4: "Do not stop any prescribed medicine because of this alert. Speak
   to your doctor or pharmacist." Attach it structurally on the Alert type, not
   as a UI concern — it must be impossible to render an alert without it.

4. Rulepack-degraded behaviour: if the rulepack is missing or fails checksum,
   stages that depend on its copy are suppressed with an explicit INCOMPLETE
   result. Stages driven purely by reference tables continue. Never fall back to
   generated copy.

## Safety suite — the gate

`tests/safety/screening.safety.test.ts`. 100% pass, blocks deploy.

  a. PARACETAMOL STACKING (§12.2 item 3) — a combination cold remedy containing
     paracetamol plus plain paracetamol → DUPLICATE_INGREDIENT, SERIOUS, both
     product names and the shared ingredient present in the output. Use real
     seeded products from step 6. This is the single most important test case
     in the application.

  b. Penicillin allergy → amoxicillin → ALLERGY_DIRECT, CRITICAL (AC-5.1.1).

  c. Penicillin allergy → cefalexin → ALLERGY_CROSS_CLASS (AC-5.1.2). Assert the
     kind is the cross-class variant and NOT ALLERGY_DIRECT, and that the copy
     distinguishes them.

  d. Every row of §5.3 — one case per condition/class pair, including G6PD
     deficiency with a sulfonamide (AC-5.1.4).

  e. Sulfa allergy → co-trimoxazole (Septrin) → allergy alert. Widely used in
     Nigeria; must be covered.

  f. NSAID allergy → aspirin-containing product (Alabukun) → cross-class alert.

  g. PROHIBITION ASSERTIONS (§12.2 item 7) — exhaustive, not sampled. Enumerate
     EVERY alertCopy template in the rulepack and EVERY explanation and
     recommendation string in the reference tables, render each with test
     variables, and assert none matches:
        dose pattern:      /\d+\s?(mg|ml|g|mcg|iu)/i
        treatment verb:    /\b(take|use|apply|swallow)\b/i
     Testing only the alerts a few fixtures happen to raise leaves the rest of
     the corpus unchecked. This test is what makes §2.2 enforced by CI rather
     than by discipline.

  h. TRI-STATE INTEGRITY — a regimen containing any is_custom medication can
     NEVER return status 'CLEAR', even when no alerts fire (AC-5.1.8). Assert
     the status is 'INCOMPLETE' and the uncheckable list names the medication.

  i. Multiple simultaneous alerts: a user with both an allergy match and a
     duplicate ingredient receives BOTH, correctly ordered by severity.

  j. DETERMINISM — identical input evaluated 100 times returns identical output
     including alert order.

  k. OFFLINE PARITY (AC-5.1.7) — output with network disabled is byte-identical
     to online. Assert no network API is reachable from this module.

  l. Rulepack corrupt → INCOMPLETE with an explanatory reason, never generated
     copy, never silent success.

  m. Every emitted alert carries a non-empty rulepackVersion and the
     do-not-stop-prescribed-medicine disclaimer (AC-5.1.5).

## Constraints

- No language model in this path (§2.2 prohibition 6).
- No dose figures anywhere in engine output, in any code path (§2.2 prohibition 2).
- No treatment recommendation in any output (§2.2 prohibition 1).
- Never advise stopping a medication (§2.2 prohibition 5) — flag risk and refer.
- No async, no I/O, no network.
- Do not build the add-medication UI. Step 10.

## Verification gate — before step 9

  bun run test:safety → ALL cases pass, red-flag suite still green
  bun run test:unit / typecheck / lint / build → pass

Then paste:
  - Full safety output, with the paracetamol case (a) shown explicitly
  - Output of test (g) showing HOW MANY content strings were checked — that
    count should roughly match the number of curated rows from step 6
  - Output of test (h)
  - The rendered text of the paracetamol alert, verbatim

If any safety case fails, STOP. Do not weaken a test to pass. Report it.

## Context handoff to step 9

Output "HANDOFF → STEP 9" containing:
  - `screen()` signature and the ScreeningResult union as implemented
  - Alert kinds and severities with their sort order
  - Total content strings covered by the prohibition assertions
  - How rulepack-degraded mode is signalled
  - Any §5.2/§5.3 row not covered by a test, and why
```

**Why test (g) is structural:** testing the alerts your fixtures happen to trigger proves nothing about the strings they do not, and the content corpus grows every time someone curates a row. Enumerating the whole corpus means a future contributor who writes "take 500mg every six hours" into an explanation field gets a red build the moment they commit, rather than shipping it.

---
---

# Step 9 of 16 — Sync: push, pull, idempotency & backoff

**The failure mode to design against is clock skew.** Conflict resolution (§7.5) is last-write-wins on a client-supplied timestamp, and a cheap Android with a wrong clock either wins every conflict forever or loses every one of them. It presents as "my edits keep disappearing," it is untraceable in logs, and it is the most common real-world bug in hand-rolled sync. Cheap to fix now, expensive later.

```text
Step 9 of 16 for Sana. SANA_PRD.md is your source of truth. Read §7 IN FULL
(protocol), §6.2 (RLS), AC-8.1.1 through AC-8.1.5 and §12.3 scenario 2.

Scope: the sync layer — server Route Handlers and the client scheduler. No UI
beyond a sync status indicator. No new features.

## Known hazards — handle these explicitly

HAZARD 1 — CLOCK SKEW.
§7.5 resolves conflicts by comparing `client_updated_at`. That value comes from
the device clock. A device set years fast wins every conflict permanently; one
set slow loses every conflict silently. Both present to the user as "my changes
keep disappearing" and neither appears in logs.

Required handling:
  - Store BOTH the client's `client_updated_at` AND the server receipt time.
    Add a migration adding `server_received_at timestamptz not null default now()`
    to persons, allergies, conditions, medications.
  - Reject any mutation whose client_updated_at is more than 24 hours in the
    future, with code CLOCK_SKEW_FUTURE. Return the server time so the client
    can surface a "check your device clock" state.
  - Log a warning when client and server time differ by more than 5 minutes.
  - LWW still compares client_updated_at (it is the only value reflecting user
    intent order), but server_received_at makes skew diagnosable after the fact.

HAZARD 2 — CONCURRENT DRAINS.
Two overlapping sync cycles push the same outbox rows twice and interleave
watermark writes. Guard the whole cycle with a single-flight lock: a second
invocation while one is running returns the in-flight promise rather than
starting a second cycle.

HAZARD 3 — WATERMARK SOURCE.
The pull watermark MUST be the `server_time` from the response, never a
client-generated timestamp. A client clock ahead of the server permanently skips
records. Assert this in a test.

## Build

1. `POST /api/sync/push` per §7.2:
   - Auth required; 401 otherwise
   - Validate every mutation against its table's Zod schema from step 3;
     per-mutation rejection, not whole-batch failure, except on malformed JSON
   - OWNER_ID IS ALWAYS OVERWRITTEN FROM THE JWT. A client-supplied owner_id is
     discarded, never trusted, never used for authorisation (§7.2)
   - clinical_events: `insert … on conflict (id) do nothing` — append-only
   - Current-state tables: `on conflict (id) do update … where
     excluded.client_updated_at > target.updated_at`
   - Max 500 mutations; 413 beyond that
   - One audit_log row per accepted batch (§11)
   - Apply the clock-skew rejection above

2. `GET /api/sync/pull` per §7.3:
   - Scoped by RLS to auth.uid()
   - Ordered by updated_at asc (created_at for clinical_events)
   - Includes tombstones so deletions propagate
   - Returns `server_time` and `has_more`
   - Client re-pulls until has_more is false, WITH a maximum iteration guard —
     a pagination bug must fail loudly, not spin forever

3. `GET /api/reference/sync` per §7.4 — reference data plus rulepack, checksum
   verified client-side before applying (§7.4).

4. `src/lib/sync/engine.ts` — the client cycle:
   - Order: PUSH FIRST, THEN PULL. Pushing first means local changes are already
     server-side before the pull that might otherwise clobber them.
   - Drain outbox in `seq` order, chunked to 500
   - On response: clear applied mutations, retain rejected ones with their
     reason and increment attempts (AC-8.1.2)
   - Mutations failing 5 times move to a `dead` status and surface to the user
     rather than retrying forever
   - Update the watermark from `server_time` only
   - Single-flight lock per HAZARD 2

5. `src/lib/sync/scheduler.ts` — triggers per §7.1: app foreground, `online`
   event, post-mutation debounced 2s, and every 5 minutes while foregrounded.
   Backoff on failure: exponential from 1s, ×2, ±25% jitter, capped at 5 minutes
   (AC-8.1.5).

6. `src/components/SyncIndicator.tsx` — non-blocking status: pending count,
   syncing, failed, offline. Must never block interaction (AC-8.1.5).

7. Migration `009_sync_columns.sql` adding server_received_at per HAZARD 1.
   Forward-only.

## Tests

`tests/unit/sync.test.ts`:
  a. IDEMPOTENCY (AC-8.1.3) — pushing an identical batch twice produces the same
     database state as pushing once. Assert row counts, not just absence of error.
  b. Partial failure (AC-8.1.2) — a batch with 3 valid and 2 invalid mutations
     clears 3 from the outbox and retains 2 with reasons.
  c. LWW (AC-8.1.4) — the higher client_updated_at wins for current-state tables.
  d. Append-only — two devices creating different events both persist; neither
     overwrites the other.
  e. owner_id spoofing — a mutation carrying another user's owner_id is stored
     under the AUTHENTICATED user, never the claimed one. Verify by reading back
     as the victim and asserting zero rows.
  f. CLOCK SKEW — a client_updated_at 48h in the future is rejected with
     CLOCK_SKEW_FUTURE; one 1h in the future is accepted.
  g. WATERMARK — the client stores server_time, not its own clock. Simulate a
     client clock 10 minutes ahead and assert no records are skipped.
  h. SINGLE FLIGHT — two concurrent sync() calls result in ONE push request.
  i. Backoff timing follows the specified curve with jitter in range.
  j. Dead-letter — a mutation failing 5 times reaches 'dead' and stops retrying.
  k. Pagination terminates: has_more looping is bounded and a stuck cursor throws.
  l. Tombstones propagate: deleting on device A removes it from device B's
     active queries.

`tests/e2e/sync.spec.ts`:
  m. OFFLINE ROUND TRIP (§12.3 scenario 2, AC-4.1.4) — go offline, log 5 doses,
     verify all 5 appear locally with a pending indicator, reconnect, verify sync
     fires within 5s, verify all 5 server-side, then TRIGGER SYNC AGAIN and
     assert still exactly 5. The second sync is the point of the test.
  n. Two-device convergence (§12.3 scenario 3): edit on A, verify on B.
  o. Sync failure shows a non-blocking indicator and the app stays usable.

## Constraints

- Never trust client-supplied owner_id, anywhere, for anything.
- Never hard-delete clinical_events. Tombstone only.
- Do not add a third-party sync service. v1 is the hand-rolled outbox per §7.1.
- Do not edit migrations from earlier steps; add 009.
- Sync failure must never block the UI or lose local data.

## Verification gate — before step 10

  bun run test:unit   → all sync tests pass
  bun run test:e2e    → sync specs pass
  bun run test:safety → still passes
  bun run typecheck / lint / build → pass

Then paste:
  - Output of test (a), idempotency, showing row counts after both pushes
  - Output of test (e), the owner_id spoofing case
  - Output of test (m), including the second-sync assertion
  - Measured time from reconnect to sync completion

## Context handoff to step 10

Output "HANDOFF → STEP 10" containing:
  - Endpoint paths with request/response shapes as implemented
  - Sync cycle order and trigger list
  - Outbox status values including dead-letter
  - Clock skew thresholds and the rejection code
  - How the single-flight lock is implemented
  - Migration 009 contents
  - Measured reconnect-to-synced latency
```

**Why the second sync in test (m):** almost every hand-rolled sync passes on the first cycle. The bug is in whether the outbox was cleared correctly, and that only shows up when you sync again and find ten doses where five should be.

---
---

# Step 10 of 16 — Medication management & the screening gate

**A PRD gap this closes (C5).** §5.1 screens the candidate drug against the existing regimen, but nothing re-screens the regimen when the *profile* changes. A user adds amoxicillin in week one, records a penicillin allergy in week three — the allergy screening never runs against what is already there. The app holds both facts, knows they conflict, and says nothing.

**And a stance:** the app records reality, it does not gatekeep it. A user may be taking something their doctor prescribed despite an alert, and §2.2 prohibition 5 forbids telling them to stop. "Add anyway" must always exist. What you control is which path is easy.

```text
Step 10 of 16 for Sana. SANA_PRD.md is your source of truth. Read §2.2 and §2.4
(normative), §5.1 (screening), AC-3.1.1 through AC-3.1.4, and AC-5.1.5/5.1.8.

Scope: medication CRUD and wiring the step-8 screening engine into real flows.
UI is functional, not designed — visual work is step 15.

## PRD gap this step closes

§5.1 screens a CANDIDATE against the existing regimen. Nothing re-screens the
regimen when the PROFILE changes. Concretely: a user adds amoxicillin, then
records a penicillin allergy three weeks later. The conflict is never surfaced —
the app holds both facts and stays silent.

REQUIRED: changes to allergies or conditions trigger a full re-screen of every
active medication for that person, treating each in turn as the candidate against
the others. Surface results as a review screen, not a silent background pass.
Add this to `src/lib/engine/screening.ts` as:

  function screenRegimen(input: RegimenScreeningInput): ScreeningResult;

and cover it in the safety suite.

## The gatekeeping rule

Sana records reality. It does not prevent a user recording what they are actually
taking — §2.2 prohibition 5 forbids advising someone to stop a prescribed
medicine, and a user whose doctor prescribed a flagged drug must still be able to
track it. "Add anyway" always exists.

What you control is which path is DEFAULT. For CRITICAL and SERIOUS alerts:
  - The primary, visually dominant action is "Don't add" / "Cancel"
  - "Add anyway" is present, secondary, and de-emphasised
  - For CRITICAL specifically, "Add anyway" requires a second deliberate
    confirmation — not a second identical button, an actual acknowledgement of
    what was flagged
  - Never a single "OK" that both dismisses the alert and commits the save

Most apps invert this because they optimise for flow completion. Do not.

## Build

1. `/app/meds` — active regimen list. Excludes end-dated medications (AC-3.1.4)
   and tombstones. Shows an "inactive" section separately.

2. `/app/meds/new` — the add flow:
   a. Search the catalog using step 6's in-memory search (AC-3.1.1, under 100ms)
   b. Select a product, or choose "add manually"
   c. Enter dose (free-text record only — NEVER suggested or defaulted) and
      schedule using the step-3 schedule schema
   d. RUN SCREENING (AC-3.1.3)
   e. If status is ALERTS or INCOMPLETE, render results BEFORE the save commits,
      with the acknowledgement rules above
   f. Save on confirmation

3. Manual entry path (AC-3.1.2):
   - Sets `is_custom = true`
   - Excluded from ingredient-level screening
   - The limitation is shown EXPLICITLY at entry time and again in the result:
     "Sana cannot check this medicine for interactions or allergies because it
     isn't in our list." Not a footnote, not a tooltip.
   - Per step 8, a regimen containing a custom medication can never return CLEAR

4. `/app/meds/:id` — detail: schedule, adherence summary, edit, end/remove.
   - Editing dose, schedule or dates re-runs screening
   - "Remove" sets `end_date`, it does not tombstone — the medication stays in
     the timeline (AC-3.1.4). Tombstoning is reserved for correcting a mistaken
     entry, and is offered separately with distinct wording.

5. Regimen re-screen trigger: after any allergy or condition create/update/delete,
   run `screenRegimen` for that person and route to `/app/meds/review` when
   anything is raised. This is the gap-closing behaviour above.

6. Alert presentation (§2.4, AC-5.1.5). Every alert renders with:
   - Severity, clearly distinguished
   - The curated plain-language explanation from the rulepack or reference data
   - Named products and, for duplicates, the shared ingredient
   - The mandatory disclaimer: "Do not stop any prescribed medicine because of
     this alert. Speak to your doctor or pharmacist."
   - The rulepack version, discreet but present
   Never generate alert prose in the component.

7. Every medication mutation appends a `clinical_events` row alongside the
   entity write, in the same transaction (step 4's repository contract).

## Tests

`tests/unit/meds.test.ts`:
  a. Active list excludes end-dated and tombstoned medications (AC-3.1.4)
  b. Removing sets end_date and the record remains queryable for the timeline
  c. Editing dose or schedule re-runs screening
  d. Every medication write produces exactly one outbox entry and one event

`tests/safety/regimen.safety.test.ts`:
  e. REGIMEN RE-SCREEN — add amoxicillin with no allergies recorded (clear),
     then record a penicillin allergy, and assert screenRegimen raises
     ALLERGY_DIRECT against the existing medication. This is the gap case.
  f. Same pattern for conditions: add ibuprofen, then record peptic ulcer,
     assert CONDITION_CONTRA is raised.
  g. screenRegimen with a custom medication present never returns CLEAR
  h. Prohibition assertions over all medication-flow UI strings: no dose pattern
     (/\d+\s?(mg|ml|g|mcg|iu)/i) outside user-entered values, no treatment verb
     pattern in any app-authored copy

`tests/e2e/meds.spec.ts`:
  i. §12.3 scenario 1 end to end: sign up → consent → add allergy → add a
     medication that triggers an alert → alert appears BEFORE save → acknowledge
     → save completes
  j. CRITICAL alert defaults: assert the primary action is the cancel path and
     that "add anyway" requires a second distinct confirmation
  k. Manual entry shows the uncheckable limitation at entry and in the result
  l. Adding a medication fully offline works and queues for sync

## Constraints

- Never suggest, default, or calculate a dose (§2.2 prohibition 2). Dose fields
  are empty and user-entered.
- Never block a save outright — "add anyway" always exists.
- Never advise stopping a medication (§2.2 prohibition 5).
- No generated clinical copy in components.
- Do not implement reminders or dose logging. Step 11.

## Verification gate — before step 11

  bun run test:safety → all pass, including the new regimen suite
  bun run test:unit / test:e2e / typecheck / lint / build → pass

Then paste:
  - Output of test (e), the regimen re-screen gap case
  - Output of test (j) showing the action hierarchy on a CRITICAL alert
  - A DOM dump or screenshot of a rendered DUPLICATE_INGREDIENT alert
  - Confirmation that no dose field has a default value

## Context handoff to step 11

Output "HANDOFF → STEP 11" containing:
  - Route paths and component names
  - `screenRegimen` signature
  - Where the regimen re-screen is triggered from
  - Alert component API
  - Medication event types appended and their payload shapes
  - Any AC not fully satisfied, and why
```

**Why test (e) matters:** it is the case that only exists because the user did things in an order nobody designed for — which is most real usage. Features get tested along the path the designer imagined; the holes are in the orders nobody pictured.

---
---

# Step 11 of 16 — Dose logging & tiered reminders

**PRD correction C6.** AC-3.2.2 requires a reminder to fire with the app closed *and* no network. The only web API that did both — Notification Triggers / `TimestampTrigger` — was abandoned by Google ("development has ended… it wasn't clear that we could provide consistent and reliable experiences across platforms"). It never shipped to stable and no other browser implemented it.

| | App closed | App open |
|---|---|---|
| **Online** | ✅ Web Push (server-scheduled) | ✅ |
| **Offline** | ❌ **not possible on a PWA** | ✅ in-app |

This is the strongest argument for the native wrapper deferred at Phase 1. If adherence reminders turn out to be the retention feature, a Capacitor shell buys real local notifications — a v1.5 decision.

```text
Step 11 of 16 for Sana. SANA_PRD.md is your source of truth. Read AC-4.1.1
through AC-4.1.4, AC-3.2.1, AC-3.2.2, §6.1 clinical_events, and §7.1.

Scope: dose logging, corrections, and reminders. No new clinical logic.

## PRD CORRECTION — AC-3.2.2 is not achievable as written

AC-3.2.2 requires a notification to fire with the app CLOSED and NO NETWORK. The
only web API providing both — Notification Triggers / TimestampTrigger — was
abandoned by Chrome and never shipped to stable. No browser implements it.

Do NOT attempt to use it, polyfill it, or approximate it with service-worker
timers (the SW is killed when idle; setTimeout does not survive).

REVISED REQUIREMENT — implement three tiers with feature detection:

  TIER 1 — Web Push, online, app closed.
    Server schedules a push for each due dose. Covers the common case.
    Requires: VAPID keys, a push subscription per device, and a scheduled
    server job. iOS requires the PWA be installed to the home screen.

  TIER 2 — In-app due-dose surfacing, offline, app open.
    On app open and while foregrounded, compute due and overdue doses from the
    local schedule and surface them prominently on /app. Fully offline, no
    network, no permissions.

  TIER 3 — Documented gap.
    Offline AND app closed cannot notify on the web platform. Record this in
    README and in the in-app notification settings copy, honestly. Do not imply
    coverage you do not have — a user who trusts a reminder that never fires is
    worse off than one who knows to check the app.

Report in the handoff that AC-3.2.2 is revised and why.

## Build

1. Dose logging (AC-4.1.1, 4.1.2):
   - Log from /app (due list) and from /app/meds/:id
   - Appends a `clinical_events` row with event_type='medication_taken', never
     an UPDATE to an existing row
   - Writes locally first; UI updates immediately; pending-sync indicator shown
   - Works fully offline
   - Also support 'medication_skipped' with an optional reason

2. Corrections (AC-4.1.3) — the append-only discipline:
   - Correcting a logged dose appends a NEW event with event_type='correction'
     and `corrects_event_id` pointing at the original
   - The original is tombstoned via `deleted_at`
   - The original row is NEVER mutated beyond that tombstone and NEVER hard
     deleted (§6.2 events_no_mutation enforces this server-side; do not fight it)
   - Timeline shows the corrected value; history remains reconstructible

3. Schedule expansion:
   - `src/lib/schedule/expand.ts` — given a medication's schedule (step 3 schema)
     and a date range, produce due-dose instances
   - Pure, deterministic, timezone-aware, offline
   - Handles all three schedule kinds: fixed times, interval hours, as-needed
     (as-needed produces no scheduled instances)
   - Must round-trip correctly across DST-free Africa/Lagos but do not hardcode
     that timezone — read it from the device

4. `/app` today view:
   - Doses due today, grouped by time
   - Overdue doses surfaced distinctly
   - One-tap log from the list
   - This is TIER 2 and it is the reminder path that always works

5. Tier 1 Web Push:
   - `POST /api/push/subscribe` storing the subscription
   - A scheduled server job dispatching pushes for due doses
   - Service worker `push` handler rendering the notification
   - Notification click deep-links to the dose
   - Graceful degradation: if permission is denied or push is unsupported, the
     app works fully on Tier 2 with no broken UI and no repeated prompts

6. Notification settings in `/app/settings`:
   - Permission state and request flow
   - Honest copy stating reminders need a connection, and that the app shows
     due doses when opened
   - Per-medication reminder toggle

## Tests

`tests/unit/schedule.test.ts`:
  a. All three schedule kinds round-trip losslessly (AC-3.2.1)
  b. "Twice daily at 08:00 and 20:00" expands to exactly 2 instances per day
  c. Interval schedules expand correctly across a day boundary
  d. As-needed produces zero scheduled instances
  e. Expansion is deterministic and timezone-aware

`tests/unit/dosing.test.ts`:
  f. Logging appends an event; no UPDATE is issued (AC-4.1.2). Assert at the
     repository level that no update path is invoked.
  g. Correction appends a new event AND tombstones the original; the original
     row still exists and its non-tombstone fields are unchanged (AC-4.1.3)
  h. Attempting to mutate a logged event's payload is rejected
  i. Each log produces exactly one outbox entry

`tests/e2e/dosing.spec.ts`:
  j. AC-4.1.1: airplane mode → log a dose → appears immediately with a pending
     indicator
  k. AC-4.1.4: log 5 doses offline → reconnect → all 5 sync → sync AGAIN →
     still exactly 5, no duplicates
  l. Correct a logged dose → timeline shows the corrected value → the original
     is not displayed but is still present in the store
  m. Push permission denied → app remains fully functional on Tier 2, no broken
     UI, no repeat prompting

## Constraints

- Never UPDATE a clinical_events row except to set deleted_at.
- Never hard-delete a clinical event.
- Do not use Notification Triggers or any service-worker timer for scheduling.
- Do not overstate notification reliability in user-facing copy.
- No dose defaults or suggestions (§2.2 prohibition 2).

## Verification gate — before step 12

  bun run test:unit / test:e2e / test:safety / typecheck / lint / build → pass

Then paste:
  - Output of test (g) showing the original event intact after correction
  - Output of test (k) including the second-sync count
  - The notification settings copy, verbatim, for review against Tier 3 honesty
  - Feature-detection result for push support on your test browser

## Context handoff to step 12

Output "HANDOFF → STEP 12" containing:
  - Schedule expansion API signature
  - Event types appended and their payload shapes
  - Push endpoints and the server job mechanism
  - Which reminder tiers are active in your environment
  - Confirmation that AC-3.2.2 is revised, with the revised text
```

**On Tier 3:** resist softening it. The instinct is "reminders may occasionally be delayed," which reads as *usually fine*. Someone managing hypertension medication needs to know the app is not a dependable alarm so they keep whatever system they already use. Overstating it does not just mislead — it displaces a working habit with a broken one.

---
---

# Step 12 of 16 — Symptom check & result screens

**Two clinical-practice points that change the build.** *Lead with the red-flag screen* — do not make someone with stroke symptoms complete a six-step wizard. Real triage front-loads the dangerous questions. *`SELF_CARE_REASONABLE` is the most dangerous output in the app*, the only band that tells someone not to seek care. In practice it never ships alone; it ships with **safety-netting**: explicit "come back if" criteria, specific to what was reported.

```text
Step 12 of 16 for Sana. SANA_PRD.md is your source of truth. Read §2 IN FULL
(normative), §5.4, §8 (rulepack), AC-6.1.1 through AC-6.1.6, and §12.2.

Scope: the symptom check flow and its result screens. The red-flag engine from
step 7 is already built — wire it, do not reimplement it.

## Flow design requirements

1. LEAD WITH RED FLAGS.
   The first screen asks directly about the emergency findings from §2.3, in lay
   language, before any other question. Someone with stroke symptoms must not
   have to complete a multi-step wizard to reach the escalation screen.

   Phrase in plain terms a worried non-clinician recognises:
     "Pain, pressure or tightness in your chest"  not  "anginal chest pain"
     "One side of your face is drooping"          not  "unilateral facial palsy"
     "Struggling to breathe, even at rest"        not  "dyspnoea at rest"

   Poor phrasing here is a safety defect, not a copy nitpick: a symptom the user
   does not recognise in themselves is a symptom that does not get reported.

2. SAFETY-NETTING ON EVERY NON-EMERGENCY RESULT.
   SELF_CARE_REASONABLE is the only output that tells someone not to seek care,
   which makes it the highest-risk non-emergency state in the app. Real clinical
   triage never issues it bare — it issues it with explicit return criteria.

   Every non-emergency result must render "come back / seek care if" criteria,
   sourced from the rulepack (never generated), specific to what was reported,
   and visually equal in weight to the guidance itself — not a footnote below it.

## Build

1. `/app/check` — structured picker only. NO free-text symptom entry (§1.2
   non-goal), so no language model is involved anywhere in this flow
   (§2.2 prohibition 6).
   - Screen 1: red-flag findings, using the step-7 vocabulary
   - Screen 2+: rulepack symptom selection with follow-up questions per §8
   - Back navigation preserves answers
   - Fully offline

2. Evaluation order — strict:
   a. `evaluateRedFlags()` FIRST, on every submission, including from screen 1
      alone. A match renders the step-7 EmergencyScreen and TERMINATES the flow
      (AC-6.1.1). No further questions, no result page, no navigation onward.
   b. Only if null, evaluate rulepack urgencyRules for a band.

3. `/app/check/result` (AC-6.1.3, 6.1.4):
   - Shows the urgency band: SEE_DOCTOR_TODAY / SEE_DOCTOR_SOON /
     SELF_CARE_REASONABLE
   - NEVER a condition name, diagnosis, or "this may be…" phrasing
     (§2.2 prohibition 3)
   - NEVER a medication (§2.2 prohibition 1) or a dose (prohibition 2)
   - Non-collapsible, non-dismissible disclaimer banner ABOVE the result:
     "This is guidance, not a diagnosis. It does not replace seeing a health
     professional." (§2.4)
   - Safety-netting criteria, per the requirement above
   - Guidance text from the rulepack only, never generated

4. Persist a `clinical_events` row, event_type='triage_completed', payload
   carrying symptom_codes, urgency_band, matched_rule_id or red_flag_id, plus
   `rulepack_version` and `ruleset_checksum` on the row (AC-6.1.5, §2.5).
   Provenance is the liability defence — a result must remain explainable after
   the content changes.

5. DEGRADED MODE (AC-6.1.6) — rulepack missing, stale, or checksum-failed:
   - Red-flag evaluation STILL RUNS, unchanged (it is compiled in, per step 7)
   - Non-emergency guidance is SUPPRESSED, with an explicit state explaining
     that guidance is unavailable and advising the user to seek advice if
     concerned
   - Never fall back to generated guidance, a cached band, or a default of
     SELF_CARE_REASONABLE. Defaulting to the reassuring answer when content is
     broken is the worst available failure.

6. `/app/check/history` — past triage events from the timeline, each showing the
   rulepack version that produced it.

## Tests

`tests/safety/triage.safety.test.ts`:
  a. RED FLAG PRECEDENCE — for all 15 rules, submitting from screen 1 alone
     escalates immediately without reaching a band (AC-6.1.1)
  b. A red flag combined with non-emergency symptoms still escalates; the band
     path is never reached
  c. NO CONDITION NAMES — assemble a list of at least 40 condition names
     (malaria, typhoid, appendicitis, pneumonia, UTI, etc.), render every
     reachable result state, and assert none appears in the output (AC-6.1.3)
  d. PROHIBITION ASSERTIONS over every rulepack guidance string and every
     app-authored result string: no dose pattern
     (/\d+\s?(mg|ml|g|mcg|iu)/i), no treatment verb pattern
     (/\b(take|use|apply|swallow)\b/i)
  e. Every non-emergency result renders safety-netting criteria. Assert
     non-empty for every reachable band.
  f. Every result renders the disclaimer banner, and it cannot be collapsed or
     dismissed (AC-6.1.4)
  g. DEGRADED MODE — with the rulepack corrupt, absent, and checksum-failed:
     red flags still escalate correctly in all three states, AND no band is
     returned, AND the result never defaults to SELF_CARE_REASONABLE (AC-6.1.6)
  h. Every triage_completed event carries a non-empty rulepack_version and
     ruleset_checksum (AC-6.1.5)
  i. No import path in the check feature reaches a language model or network API

`tests/e2e/check.spec.ts`:
  j. Chest pain on screen 1 → escalation in two taps → flow terminated, no
     result page reachable via back navigation
  k. Non-emergency path completes and renders band, disclaimer and safety-netting
  l. Whole flow completes with the network disabled
  m. Back navigation preserves prior answers

## Constraints

- No free-text symptom entry. No language model. No network in the flow.
- No condition names in any output, ever.
- Never default to a reassuring band on content failure.
- Do not reimplement red-flag logic — import it from step 7.
- Do not add urgency bands beyond the four in the enum.

## Verification gate — before step 13

  bun run test:safety → all pass, including steps 7, 8 and 10 suites
  bun run test:unit / test:e2e / typecheck / lint / build → pass

Then paste:
  - Output of test (c), including the condition-name list used
  - Output of test (g), all three degraded states
  - Full rendered text of one SELF_CARE_REASONABLE result, verbatim, showing
    banner, guidance and safety-netting
  - Screen 1 copy, verbatim, for lay-language review

## Context handoff to step 13

Output "HANDOFF → STEP 13" containing:
  - Route paths and flow step order
  - Screen 1 red-flag question copy as implemented
  - Urgency band render states
  - Degraded-mode behaviour and its user-facing copy
  - triage_completed payload shape
  - Condition-name list used in test (c)
```

**On item 5's last line:** when content is broken, every instinct in software says degrade gracefully and keep the user moving — and here "keep moving" means telling someone their symptoms are probably fine on the basis of nothing. Degraded mode has to fail toward *seek advice*, deliberately, against the usual reflex.

---
---

# Step 13 of 16 — Health timeline

```text
Step 13 of 16 for Sana. SANA_PRD.md is your source of truth. Read AC-7.1.1
through AC-7.1.4, §6.1 clinical_events, §6.4 local schema, and step 4's
encryption split.

Scope: the timeline view and its projection layer. No new data capture.

## The performance constraint, and why it's non-obvious

AC-7.1.2 requires first paint under 300ms with 5,000 local events. Step 4
encrypts `clinical_events.payload`. Decrypting 5,000 payloads means 5,000
async WebCrypto calls, where per-call overhead dominates for small payloads —
that alone will blow the budget several times over.

The resolution is the reason step 4's plaintext/encrypted split was drawn where
it was:

  SORT, FILTER and GROUP on the PLAINTEXT indexed columns —
    occurred_at, event_type, person_id, deleted_at.
  DECRYPT ONLY THE VISIBLE WINDOW — the ~20–50 events actually rendered.

Never decrypt to filter. Never decrypt to sort. Never decrypt to count. If you
find yourself decrypting a payload to make a display decision, the data needed
for that decision belongs in a plaintext column instead — flag it rather than
working around it.

If decryption still costs too much on the visible window, move it to a Web
Worker so the main thread stays free. Measure before adding that complexity.

## Correction chains

Per AC-4.1.3, a correction is a NEW event with `corrects_event_id` pointing at
the original, and the original is tombstoned. The timeline shows the corrected
value.

Requirements:
  - Resolve chains, not just single hops. A correction can itself be corrected.
  - Display the latest value in the chain; the superseded entries are hidden but
    remain in the store.
  - Mark a corrected entry visibly (e.g. "edited") so history is honest rather
    than silently rewritten.
  - GUARD AGAINST CYCLES. A malformed or maliciously-synced chain that loops
    must terminate with a bounded traversal and an error, never hang the render.
    Cover it with a test.

## Build

1. `src/features/timeline/projection.ts` — pure projection over local events:
   - Input: person_id, date range, optional event_type filter, pagination cursor
   - Queries on plaintext indexed columns only
   - Excludes tombstoned events (AC-7.1.3)
   - Resolves correction chains with a cycle guard
   - Returns a page of event ids plus their plaintext metadata; payloads are
     decrypted separately by the view layer for the visible window only

2. `/app/timeline` (AC-7.1.1):
   - Reverse-chronological, grouped by day with date headers
   - Infinite scroll or explicit pagination — do not render all events at once
   - Fully offline
   - Human-readable rendering per event type: doses taken and skipped, symptoms
     reported, triage results with their urgency band, allergies and conditions
     recorded, notes

3. Filtering (AC-7.1.4):
   - By event type, and by person
   - Applied at the query layer on plaintext columns, NOT by filtering a
     decrypted list in memory
   - No network request

4. Triage entries in the timeline link to their stored result and show the
   rulepack version that produced it (§2.5 provenance). Rendering a past triage
   result must reuse the step-12 result component so the disclaimer banner and
   safety-netting travel with it — a historical result stripped of its
   disclaimer is a §2.4 violation.

5. Empty and loading states. An empty timeline is the first thing a new user
   sees; make it a useful prompt toward adding a medication rather than a blank
   screen.

## Tests

`tests/unit/timeline.test.ts`:
  a. PERFORMANCE (AC-7.1.2) — seed 5,000 local events, measure first-page
     projection plus decryption of the visible window, assert under 300ms.
     Report the measured number, do not just assert the bound.
  b. Assert the number of decrypt calls made for a first page is proportional to
     the PAGE SIZE, not the total event count. This is the test that catches a
     regression where someone adds a decrypt-to-filter path.
  c. Tombstoned events are excluded (AC-7.1.3)
  d. Reverse-chronological ordering with correct day grouping across a
     day boundary
  e. Correction chains: original → correction shows the corrected value; the
     original is not displayed; both remain in the store
  f. Multi-hop chains: correction of a correction resolves to the latest
  g. CYCLE GUARD: a chain that loops terminates with an error rather than
     hanging. Assert bounded traversal.
  h. Filtering by event type queries on plaintext and issues no network request
  i. Pagination returns stable, non-overlapping pages with no gaps

`tests/e2e/timeline.spec.ts`:
  j. Timeline renders fully offline with mixed event types (AC-7.1.1)
  k. Filter by type updates the list with no network activity (AC-7.1.4)
  l. A past triage entry opens with its disclaimer banner and safety-netting
     intact
  m. Scrolling to a second page loads without a visible stall

## Constraints

- Never decrypt to filter, sort, group or count.
- Never render a historical triage result without its disclaimer.
- No network requests from the timeline.
- Do not add new event types. Render what exists.

## Verification gate — before step 14

  bun run test:unit / test:e2e / test:safety / typecheck / lint / build → pass

Then paste:
  - Measured first-paint time from test (a) with 5,000 events
  - Decrypt call count from test (b), alongside the page size
  - Output of test (g), the cycle guard
  - A screenshot of the timeline showing a corrected entry marked as edited

## Context handoff to step 15

Output "HANDOFF → STEP 14" containing:
  - Projection API signature
  - Page size and pagination mechanism
  - Measured performance numbers with 5,000 events
  - Whether decryption runs on the main thread or in a worker
  - Correction chain resolution approach and cycle guard bound
  - Event render components by type
```

**Why test (b) is the durable one:** the 300ms assertion passes on your dev machine regardless, and keeps passing for a while even if someone introduces a decrypt-to-filter path — right up until a user has two years of history on a cheap phone. Asserting that decrypt calls scale with *page size* rather than *total events* catches the architectural regression the day it is written.

---

# Step 13a of 16 — Facility directory & escalation integration

**Why this step exists.** It was cut from v1 on timeline grounds and put back after a gap surfaced: §2.3's escalation screen tells someone with chest pain to call emergency services, then goes silent on *where to go*. Ambulance dispatch is unreliable across much of Nigeria, so for many users the real next step is getting themselves to a hospital. That makes the facility directory the tail end of the highest-stakes flow in the product, not a convenience feature.

**Why it is cheap.** The expensive part was never the data — it was the map. Dropping rendered maps removes MapLibre, Protomaps, offline tile packs and PostGIS in one move. Directions hand off to whatever maps app the user already has. Roughly a day and a half of code; the real cost is your time verifying the dataset.

**Three tiers, one hard boundary.** Saved and curated facilities are trusted and can appear on the escalation screen. OpenStreetMap discovery covers areas you haven't curated yet — useful, honest about being unverified, and structurally incapable of reaching the escalation screen because it is a different *type*, not a flagged variant of the same one.

```text
Step 13a of 16 for Sana. SANA_PRD.md is your source of truth. Read §2.3
(escalation screen, normative), §4 F9 user stories (US-9.1 through US-9.3),
§6.1 facilities and user_facilities, §6.3 facility sourcing, and §12.2 item 11.

Scope: the facility directory and its integration into the escalation screen
from step 7. Facility DATA was seeded in step 6 — this step builds the UI and
the escalation wiring.

## What this is, and what it is not

A DIRECTORY, not a map. Sana ships no tiles and renders no map. The value is
verified data: a name, a distance, a phone number to call ahead. Directions hand
off to the device's maps application.

Do NOT add MapLibre, Leaflet, Google Maps JS, Protomaps, or any tile source. If
you find yourself reaching for a mapping library, you have misread the scope.

## Three data tiers (§5.5)

  TIER 1 — user's own saved facilities. Highest trust. Offline. Escalation-eligible.
  TIER 2 — curated, phone-verified. Offline. Escalation-eligible.
  TIER 3 — OpenStreetMap discovery. UNVERIFIED. Online fetch, cached after.
           NEVER escalation-eligible.

Tier 3 exists so the directory is not empty outside a curated state. It is a
coverage softener, not a substitute for verification.

ENFORCE THE BOUNDARY IN THE TYPE SYSTEM. `DiscoveredFacility` is a DISTINCT TYPE
from `Facility` — not a boolean flag on the same shape. The emergency query
accepts only the verified types, so a discovered record cannot reach the
escalation screen even by mistake. A flag that must be remembered is a flag that
will be forgotten; a type that cannot be passed is a type that cannot be passed.
`DiscoveredFacility` carries NO `has_emergency` field at all — the field does not
exist on it, so it cannot be inferred from an OSM tag.

## The safety rule for this step

A facility shown on the ESCALATION SCREEN is a destination for someone in crisis.
Sending them somewhere that has closed, moved, or never had an emergency
department is harm — comparable in severity to a missed red flag.

  ONLY a facility with `has_emergency = true` AND a non-null `verified_at` may
  appear on the escalation screen.

  When no such facility is known for the user's area, RENDER NOTHING. An absent
  block is correct. A wrong destination is not. Never fall back to a pharmacy, a
  clinic, a diagnostic centre, or an unverified record — not even "the nearest
  hospital" if it is not emergency-flagged and verified.

Encode this in the query function's return type so a caller cannot accidentally
pass through a non-emergency facility. A filter that can be forgotten is a filter
that will be.

## Build

1. `src/lib/facilities/query.ts` — pure, offline, on-device:

     function nearestEmergencyFacility(
       facilities: Facility[],
       location: Coords | null,
       state: string
     ): VerifiedEmergencyFacility | null;

     function listFacilities(
       facilities: Facility[],
       opts: { location: Coords | null; state: string; lga?: string;
               type?: FacilityType }
     ): FacilityWithDistance[];

   - `VerifiedEmergencyFacility` is a distinct branded type constructible ONLY
     from a record satisfying both conditions above
   - Distance via the haversine helper from step 6
   - With `location` null, fall back to state/LGA scoping, sorted alphabetically
   - No async, no network, no server round-trip

2. ESCALATION SCREEN INTEGRATION (§2.3, AC-9.1.1–9.1.4). Amend the step-7
   `EmergencyScreen` to fill the secondary slot left empty there:
   - PRIMARY action unchanged and still visually dominant: call emergency
     services from the verified config
   - SECONDARY: nearest verified emergency facility — name, distance, call
     action, directions hand-off
   - PRECEDENCE (AC-9.3.2): a user's OWN saved emergency facility outranks the
     nearest one from the dataset. Their knowledge of where they actually go
     beats our data.
   - Works offline using last-known location or the user's selected state
   - Still NO other navigation. Two slots, nothing more.

3. Location handling:
   - Request permission contextually, when the user first opens the directory —
     never on app launch
   - Cache last-known coordinates locally so the escalation screen has something
     to work with offline
   - Permission denied or unavailable is a FIRST-CLASS path, not an error state:
     the directory falls back to state/LGA browsing and remains fully usable
     (AC-9.2.3). A user who never grants location must still get full value.

4. `/app/facilities` (US-9.2):
   - List, sorted by distance when location is available
   - Filter by type: hospital, clinic, pharmacy, diagnostic centre
   - Saved personal facilities pinned at the top
   - Each row: name, type, distance or LGA, emergency badge where applicable,
     `verified_at` date (AC-9.2.7)
   - A facility whose `verified_at` is over 12 months old is visibly marked as
     possibly out of date (AC-9.2.8). Showing the user how current the data is
     lets them judge it — which is what honest data does when it cannot
     guarantee freshness.
   - Fully offline

5. `/app/facilities/:id` — detail: address, all phone numbers as `tel:` links,
   opening hours, emergency and 24-hour flags, verification date, save-to-mine
   action, directions hand-off.

6. Directions hand-off: a geo/maps URL with the facility's coordinates and name,
   opening the device's maps app. Requires a connection — when offline, show an
   explicit message rather than a dead button (AC-9.2.6).

7. Personal saved facilities (US-9.3):
   - Save from a directory entry, or enter fully custom with a name and phone
   - Stored in `user_facilities`, synced as USER data through the step-9 outbox,
     not the reference sync
   - Mark one as the user's emergency facility, feeding the precedence rule in
     item 2

8. State selection: chosen at first directory open or inferred from first
   geolocation, persisted, changeable in settings. Drives the `states` parameter
   on the §7.4 reference sync so the whole country is never synced to a device.

9. TIER 3 — OpenStreetMap discovery (§5.5, §7.4b, US-9.4):

   a. `GET /api/facilities/discover` — SERVER-SIDE PROXY to Overpass. The device
      never calls OpenStreetMap directly: that would disclose the user's
      location to a third party (§11). Coordinates arrive COARSENED TO ~1km and
      the server REJECTS finer precision rather than silently accepting it.
      Facility search does not need street-level accuracy, and reduced precision
      is data minimisation in the NDPA sense.

   b. Server-side cache keyed on the coarsened grid cell — repeat queries in one
      area cost a single upstream call. Rate limit per user and in aggregate.
      Overpass is a donated public resource; hammering it is both rude and
      self-defeating.

   c. `src/lib/facilities/discover.ts` on the client. Returns
      `DiscoveredFacility[]` — the distinct type. Never `Facility[]`.

   d. Cache results in the local `discovered_facilities` store with `fetched_at`
      so they survive going offline (AC-9.4.5). LOCAL ONLY — never synced, never
      written to a server table, never merged into the reference dataset.

   e. Stale after 30 days: mark as such and re-fetch when online (AC-9.4.6).

   f. PRESENTATION — a visually separate section BELOW tiers 1 and 2, headed to
      the effect of "Community data — not verified by Sana". Never interleaved
      with verified results. Each row offers "save as mine", promoting it to
      tier 1 (AC-9.4.7).

   g. ATTRIBUTION — display OpenStreetMap/ODbL attribution wherever discovered
      results appear. This is a licence obligation, not a courtesy.

   h. Discovery SUPPLEMENTS, never REPLACES. Where curated facilities exist for
      the area they render first and discovery fills in below (AC-9.4.8).

   i. FAILURE IS NON-FATAL (AC-9.4.9). Offline, rate-limited or erroring →
      curated and saved facilities still render, and the discovery failure is a
      quiet inline notice. Never a blocking error, never an empty screen.

## Tests

`tests/safety/facilities.safety.test.ts` — §12.2 item 11:
  a. ESCALATION INTEGRITY — every facility the escalation screen can render has
     `has_emergency = true` AND a non-null `verified_at`. Drive this over the
     full seeded dataset, not a fixture.
  b. NO FALLBACK — with a dataset containing pharmacies and non-emergency
     hospitals but NO verified emergency facility for the user's state, the
     escalation screen renders NOTHING in the facility slot. Assert absence
     explicitly (AC-9.1.2).
  c. Unverified emergency facility (has_emergency true, verified_at null) is
     never returned by `nearestEmergencyFacility` (AC-9.1.3).
  d. PRECEDENCE — a user's saved emergency facility outranks the nearest
     dataset one (AC-9.3.2).
  e. OFFLINE — the escalation facility block renders offline from last-known
     location, and from state alone when no location is cached (AC-9.1.4).
  f. Prohibition assertions over all facility UI copy: no dose pattern, no
     treatment verb pattern.
  g. The escalation screen still exposes exactly the two permitted actions —
     no third CTA crept in.
  h. TIER-3 EXCLUSION, RUNTIME (§12.2 item 12, AC-9.4.2) — build a dataset in
     which the NEAREST facility by distance is a DISCOVERED record tagged as a
     hospital, and a verified emergency facility exists further away. Assert the
     escalation screen shows the FARTHER VERIFIED one. Then remove the verified
     one and assert the screen shows NOTHING, despite a nearby discovered
     "hospital" being present. This is the case that catches a well-meaning
     "just show the closest hospital" refactor.
  i. TIER-3 EXCLUSION, COMPILE TIME (AC-9.4.3) — assert that passing a
     `DiscoveredFacility` to `nearestEmergencyFacility()` is a TYPE ERROR. Use a
     type-level test (expect-error style) rather than a runtime check.
  j. `DiscoveredFacility` has no `has_emergency` property. Assert on the type.

`tests/unit/discovery.test.ts`:
  k. Coordinates are coarsened to ~1km before leaving the device (AC-9.4.4)
  l. The server rejects coordinates finer than the coarsening threshold
  m. The device never issues a request to an OpenStreetMap host — assert the
     only outbound host is Sana's own API
  n. Discovered results cache locally and survive going offline (AC-9.4.5)
  o. Results older than 30 days are marked stale (AC-9.4.6)
  p. Saving a discovered facility promotes it to `user_facilities` (AC-9.4.7)
  q. With curated facilities present, they render above discovered ones and
     discovery does not displace them (AC-9.4.8)
  r. Discovery failure leaves curated and saved facilities rendering, with a
     non-blocking notice (AC-9.4.9)
  s. OSM attribution is present wherever discovered results render

`tests/unit/facilities.test.ts`:
  h. Sorted by distance ascending when location is present (AC-9.2.2)
  i. Location denied → alphabetical state/LGA browsing, fully usable (AC-9.2.3)
  j. Type filter issues no network request (AC-9.2.4)
  k. `verified_at` is displayed on every row (AC-9.2.7)
  l. A facility over 12 months unverified is marked stale (AC-9.2.8)
  m. Saved personal facilities pin to the top and sync via the outbox (AC-9.3.1)
  n. State scoping: only the selected state's facilities are held locally

`tests/e2e/facilities.spec.ts`:
  o. Directory renders fully offline with no network request (AC-9.2.1)
  p. Tapping a phone number opens a `tel:` link offline (AC-9.2.5)
  q. Directions offline shows an explicit message, not a dead button
  r. Red flag → escalation screen shows the verified facility with call and
     directions
  s. Save a personal facility, mark it as emergency, verify it takes precedence

## Constraints

- No mapping library, no tiles, no rendered map.
- No PostGIS, no server-side distance query.
- Never show an unverified or non-emergency facility on the escalation screen.
- Never add a third action to the escalation screen.
- Location denial is a supported path, never an error.
- Do not modify red-flag matching logic — only the screen's secondary slot.
- Never call OpenStreetMap directly from the device. Always via the proxy.
- Never infer `has_emergency` from an OSM tag. The field does not exist on
  `DiscoveredFacility` — keep it that way.
- Never merge discovered records into the curated dataset or sync them.
- Never interleave discovered results with verified ones.

## Verification gate — before step 14

  bun run test:safety → ALL pass, red-flag and screening suites unchanged
  bun run test:unit / test:e2e / typecheck / lint / build → pass

Then paste:
  - Output of test (b), the no-fallback case — this is the important one
  - Output of test (h), the tier-3 runtime exclusion, both halves
  - Output of test (i), the compile-time type error
  - Output of test (a) showing how many facility records were checked
  - A screenshot of the escalation screen with the facility block populated
  - A screenshot of the escalation screen with NO verified facility available
     but a nearby DISCOVERED hospital present — the block must be empty
  - A screenshot of the directory showing verified and community sections
     visually separated, with OSM attribution
  - Confirmation that no mapping library appears in package.json

## Context handoff to step 14

Output "HANDOFF → STEP 14" containing:
  - Facility query API signatures and the branded emergency type
  - The `Facility` vs `DiscoveredFacility` type definitions, showing that the
    latter has no has_emergency field
  - How the escalation precedence rule is implemented
  - Location permission flow and the no-location fallback
  - Facility row counts by state and by type, and how many are emergency-verified
  - State selection mechanism and how it scopes reference sync
  - Discovery proxy endpoint, coarsening precision, and cache/rate-limit strategy
  - Confirmation that package.json contains no mapping library
  - Confirmation that no device-side code calls an OpenStreetMap host directly
```

**Why test (b) is the one that matters:** the tempting implementation returns "the nearest hospital" and filters for emergency status somewhere in the view layer. That works until a state has hospital records but no verified emergency ones — and then it quietly sends someone with chest pain to a facility that cannot treat them. Making the filter part of the type, and proving the empty case renders nothing, is what stops a reasonable-looking refactor from reintroducing it later.

---
---

# Step 14 of 16 — Settings, data export & account deletion

**These are NDPA legal requirements, not features.** Three edge cases make deletion harder than it looks: it must work **when the user has forgotten their PIN** (otherwise a lost PIN traps their data in your database forever, inverting the right), it must clear the **local store and push subscriptions**, not just server rows, and the audit trail must **survive** while containing no clinical data.

```text
Step 14 of 16 for Sana. SANA_PRD.md is your source of truth. Read §11
(compliance) IN FULL, §2.4 (consent), §6.1 audit_log, and step 4's keyring.

Scope: /app/settings, data subject rights, and the public legal pages. These are
NDPA obligations, not features — implement them as if a regulator will read the
code, because that is the circumstance in which they matter.

## Build

1. `/app/settings` sections: profile, people, security (PIN), notifications
   (step 11), privacy & data, about.

2. DATA EXPORT (§11 — data subject rights):
   - Exports EVERY table the user owns: profiles, persons, consents, allergies,
     conditions, medications, clinical_events, and their push subscriptions
   - Fields are DECRYPTED. An export of ciphertext is not data portability —
     it satisfies the letter of nothing.
   - Includes tombstoned records, marked as such — the user's data includes what
     they deleted
   - JSON with a top-level manifest: schema version, export timestamp, row
     counts per table, app version, rulepack version
   - Generated entirely client-side from the local store so it works offline and
     no plaintext clinical data transits the server for this purpose
   - Delivered as a file download
   - Requires an unlocked store, since it needs decryption

3. ACCOUNT DELETION (§11). Handle these carefully:

   a. SCOPE — deletion must remove:
      - All server rows (cascade from profiles per the §6.1 FKs)
      - The entire local IndexedDB store, including the wrapped key and salt
      - Push subscriptions, server-side and browser-side
      - The Supabase auth user
      - Any cached service-worker data holding user content

   b. AUDIT SURVIVES — `audit_log.owner_id` is `on delete set null` by design.
      A deletion record must persist for compliance. Verify no audit row
      contains clinical content; audit records actions and resource ids only,
      never payloads. Write an explicit `account_deleted` audit row.

   c. MUST WORK WITHOUT THE PIN — a user who has forgotten their PIN must still
      be able to delete their account. Deletion requires AUTH, not the local
      encryption key. If deletion were gated on unlocking, a forgotten PIN would
      trap the user's data in your database permanently, which inverts the right
      it is meant to serve. Provide the delete path from the locked state.

   d. CONFIRMATION — immediate and permanent, no soft-delete limbo. Require the
      user to type their phone number to confirm. State plainly that it cannot
      be undone and that exporting first is available.

   e. POST-DELETION — session revoked, local store wiped, redirected to a
      confirmation page. Re-signup with the same phone number creates a fresh
      account with no prior data.

   Implement server-side as `POST /api/account/delete` using the service-role
   client. Never expose a client-side path that can delete another user's data —
   the target is always derived from the JWT.

4. CONSENT MANAGEMENT (§2.4):
   - Show consents granted, with version and date
   - Allow withdrawal. Withdrawing the safety disclaimer consent means the app
     cannot be used — route to a state explaining this and offering export or
     deletion. Do not silently continue.

5. PIN MANAGEMENT: change PIN (re-wraps the data key with a newly derived KEK
   without re-encrypting field data), and clear guidance that a forgotten PIN
   means local data is unrecoverable but server data re-syncs after re-auth.

6. PUBLIC LEGAL PAGES (§11):
   - `/privacy` — data collected, purposes, retention, third-party processors
     named explicitly (Supabase, Vercel, Sentry, the SMS provider), data subject
     rights and how to exercise them, contact route
   - `/terms` — including the medical disclaimer per §2
   - Both statically generated, both linked from the consent screen and settings
   - Landing page copy reviewed against the APCON prohibition on advertising
     digital diagnosis or treatment: describe tracking and safety-checking,
     never diagnosis

7. SENTRY PII SCRUBBING (§11): configure `beforeSend` to strip clinical
   payloads, phone numbers, person names, medication names and event payloads.
   Add a test asserting a synthetic error carrying clinical data is scrubbed
   before dispatch.

## Tests

`tests/unit/export.test.ts`:
  a. Export includes every owned table and matches local row counts
  b. Exported fields are PLAINTEXT — assert no ciphertext structure survives
  c. Tombstoned records are included and marked
  d. Manifest carries schema version, timestamp, counts, app and rulepack versions
  e. Export works offline with no network request

`tests/unit/deletion.test.ts`:
  f. Deletion removes all server rows across every owned table — verify per table
  g. An `account_deleted` audit row persists with a null owner_id
  h. NO audit row contains clinical payload data
  i. Deletion succeeds from the LOCKED state without the PIN
  j. Local store, including wrapped key and salt, is wiped
  k. Push subscriptions are removed both sides
  l. A deletion request cannot target another user's account — attempt it with a
     forged body and assert the JWT subject is used

`tests/unit/sentry.test.ts`:
  m. A synthetic error carrying medication names, a phone number and an event
     payload is scrubbed before dispatch

`tests/e2e/settings.spec.ts`:
  n. §12.3 scenario 5: export downloads a valid JSON file with expected contents
  o. Full deletion flow with phone-number confirmation, ending at the
     confirmation page with the session revoked
  p. Re-signup with the same phone yields an empty account
  q. Withdrawing consent blocks app use and offers export or deletion

## Constraints

- Never gate deletion on the PIN.
- Never let clinical payloads reach Sentry or analytics.
- Deletion target is always derived from the JWT, never from the request body.
- Do not implement a soft-delete grace period. Delete means delete.
- Do not name a processor in the privacy policy that you are not actually using.

## Verification gate — before step 15

  bun run test:unit / test:e2e / test:safety / typecheck / lint / build → pass

Then paste:
  - A sample export manifest with row counts
  - Output of test (f) showing per-table deletion verification
  - Output of test (i), deletion from the locked state
  - Output of test (h), audit rows free of clinical data
  - The privacy policy processor list, for verification against reality

## Context handoff to step 15

Output "HANDOFF → STEP 15" containing:
  - Settings route structure
  - Export JSON schema and manifest shape
  - Deletion endpoint and its full teardown sequence
  - Consent withdrawal behaviour
  - Sentry scrubbing rules as implemented
  - Confirmation that every §11 pre-beta checklist item is addressed, item by item
```

**Why 3(c) is the one most implementations get backwards:** gating deletion behind the local unlock feels like the secure choice, and it means a user who forgets six digits can never remove their health records from your database. The encryption protects data on the device; the deletion right is about your servers. Conflating them turns a security feature into a compliance failure.

---
---

# Step 15 of 16 — PWA shell, offline hardening & visual pass

**PRD correction C7.** Red-flag rules are compiled into the bundle (step 7), which is what makes them survive a corrupt rulepack — but it also means a *fix* ships only via app update. With `skipWaiting` disabled (§10.4, correctly), a user can sit on a stale service worker indefinitely, running last month's safety logic. The architecture that protects you from bad content traps you when you need to correct a rule. The counterweight is a forced-update path.

```text
Step 15 of 16 for Sana. SANA_PRD.md is your source of truth. Read §10.4 (PWA),
§2.3 (escalation screen requirements), §12.3 and §1.4 (success criteria).

Scope: service worker, install experience, the full offline pass, and the visual
design pass across every screen built functionally in steps 5–14.

## Required counterweight to step 7's architecture

Red-flag rules are compiled into the bundle so they survive a broken rulepack
(§5.4). The consequence: a red-flag FIX ships only via app update. With
skipWaiting disabled per §10.4, a user can remain on a stale service worker
indefinitely, running outdated safety logic.

Implement a minimum-supported-version gate:
  - `GET /api/version` returns { minimum_supported, current }
  - On app load WHEN ONLINE, compare against NEXT_PUBLIC_APP_VERSION
  - Below the floor: force the service worker update, then reload, BLOCKING use
    until complete. This is the one case that overrides the
    don't-interrupt-the-user rule — a stale safety engine outranks a smooth
    session.
  - Above the floor with a newer version available: the normal non-disruptive
    "reload to update" prompt
  - OFFLINE: never block. An offline user runs what they have; blocking would
    make the app useless in exactly the conditions it exists for.

Document the release procedure in README: shipping a red-flag change means
raising `minimum_supported`.

## Build

1. Serwist service worker (§10.4):
   - Precache the app shell
   - PRECACHE A SEED BUNDLE of reference data and the current rulepack, hydrated
     into IndexedDB on first run. A user who installs on a good connection and
     opens the app offline must have a working catalog and screening engine
     before their first sync completes.
   - Runtime caching: network-first for `/api/sync/*`, cache-first for static
     assets, never cache `/api/account/*` or auth endpoints
   - skipWaiting DISABLED except for the forced-update path above
   - Cache versioning with cleanup of stale caches on activate

2. Web app manifest: name, short name, icons at all required sizes, theme and
   background colours, `display: standalone`, `orientation: portrait`.
   Installability verified by Lighthouse.

3. Install prompt: contextual, not on first paint. Trigger after the user has
   completed a meaningful action (added a medication or logged a dose).
   Dismissible, and never shown again for 30 days once dismissed.

4. Offline hardening across every screen:
   - Every network-dependent action has an explicit offline state, never a
     generic error
   - The distinction from step 5 holds throughout: "cannot reach the server" is
     never rendered as "you are signed out"
   - Pending-sync indicators wherever local data is unsynced
   - No screen shows an infinite spinner when offline

5. VISUAL DESIGN PASS across all screens. Design constraints specific to this
   product and market:

   - HIGH CONTRAST, and more than the minimum. Target WCAG AA throughout, AAA
     for the escalation screen and all alert copy. Users are often older, often
     stressed, often reading on a cheap screen.
   - SUNLIGHT LEGIBILITY. This app is used outdoors and on low-brightness
     displays. Avoid low-contrast greys, thin weights at small sizes, and colour
     as the sole carrier of meaning.
   - LARGE TAP TARGETS, 48px minimum. One-handed reachability: primary actions
     in the lower half of the screen.
   - SEVERITY ENCODED REDUNDANTLY — colour AND icon AND text label. Never colour
     alone. Roughly 1 in 12 men has a colour vision deficiency, and this is
     safety-critical information.
   - PERFORMANCE OVER POLISH. No heavy animation, no large images, no web fonts
     beyond one family with a system fallback. §1.4 requires interactive under
     2.5s on a mid-range Android over 3G.
   - The escalation screen (§2.3) gets the highest-contrast treatment available
     and must remain visually unmistakable against every other state.

6. Loading, empty and error states for every screen. Skeletons over spinners
   where content shape is known.

## Tests

`tests/e2e/offline.spec.ts` — the full offline pass, the headline gate:
  a. Install the app online, go fully offline, and complete: unlock → view
     regimen → search the catalog → add a medication with screening → log a
     dose → run a symptom check → view the timeline. All offline, no errors.
  b. Every route renders offline without a network error state where local data
     exists
  c. Reconnect and verify everything syncs, with no duplicates on a second sync
  d. Offline never triggers a sign-out or a redirect to /login

`tests/e2e/update.spec.ts`:
  e. Version below `minimum_supported` while online → update forced, use blocked
     until reload
  f. Version below the floor while OFFLINE → NOT blocked, app remains usable
  g. Newer version available above the floor → non-disruptive prompt only
  h. An in-flight sync is not interrupted by a routine update

`tests/e2e/a11y.spec.ts`:
  i. Automated accessibility scan on every route, zero critical violations
  j. Escalation screen contrast meets AAA
  k. Every severity indicator conveys meaning without colour — assert an icon or
     text label accompanies each

Performance:
  l. Lighthouse on a simulated mid-range Android over 3G: interactive under
     2.5s (§1.4), PWA installable, accessibility above 95

## Constraints

- Never block an offline user for a version check.
- Never interrupt an in-flight sync except for a forced safety update.
- Never use colour as the sole encoding of severity.
- No heavy dependencies in this step — a chart library, animation library or
  icon set pulled in wholesale will cost the performance budget.
- Do not change any clinical logic, copy, or engine behaviour. This step is
  shell and presentation only. If a safety test breaks here, you changed
  something you should not have.

## Verification gate — before step 16

  bun run test:e2e    → offline, update and a11y specs pass
  bun run test:safety → ALL still pass, unchanged
  bun run test:unit / typecheck / lint / build → pass

Then paste:
  - Full output of test (a), the offline end-to-end pass
  - Outputs of tests (e) and (f) side by side
  - Lighthouse report: performance, accessibility, PWA, and time to interactive
  - Screenshots: escalation screen, a CRITICAL alert, the today view, the
    timeline
  - Contrast ratios for the escalation screen and alert severities

## Context handoff to step 16

Output "HANDOFF → STEP 16" containing:
  - Service worker caching strategy per route pattern
  - Seed bundle contents and size
  - Version gate behaviour, online and offline
  - Lighthouse scores
  - Design tokens: colours with contrast ratios, type scale, spacing
  - Any §1.4 success criterion not met, with measurements
```

**Why (f) pairs with (e):** a version gate written without it locks offline users out the moment you raise the floor — breaking the product for precisely the users it was built for, in the same release where you were trying to make them safer.

---
---

# Step 16 of 16 — Deployment, canary & beta gating

**Two deployment properties specific to this app.** *Rollback is asymmetric* (C8): reverting a deploy does not lower a raised `minimum_supported`, so the floor must be runtime config. *A safety engine that stops firing produces no errors* — if a bad deploy breaks red-flag matching, Sentry stays quiet, tests were green, and the app looks perfectly healthy while silently failing the one thing it exists to do.

```text
Step 16 of 16 for Sana — the final step. SANA_PRD.md is your source of truth.
Read §10 (deployment) IN FULL, §11 (compliance), §14 (open items) and §1.4
(success criteria).

Scope: production deployment, monitoring, and the beta gate. No feature work.

## Two deployment properties specific to this app

PROPERTY 1 — ROLLBACK IS ASYMMETRIC.
Step 15's version gate blocks users below `minimum_supported`. If that floor is
baked into the deployed bundle, reverting a bad release cannot lower it, and
every user is locked out of a version you can no longer serve.

  Serve `minimum_supported` from RUNTIME CONFIG — an environment variable or a
  database row read per request — never from the bundle. It must be adjustable
  without a deploy, in both directions. Document the procedure.

PROPERTY 2 — SILENT SAFETY FAILURE.
If a release breaks red-flag matching or screening, nothing throws. Tests were
green at build time, error rates stay flat, and the app appears healthy while
failing its core purpose. Exception monitoring cannot detect this.

  The canary must therefore monitor for the ABSENCE of expected behaviour:
    - Red-flag escalation rate per 100 symptom checks
    - Screening alert rate per 100 medication additions
    - Proportion of checks reaching a result at all
  Alert on anomalous LOWS, not only on errors. Establish a baseline during beta
  and alert on significant deviation. These metrics are counts and rates ONLY —
  no clinical content, no payloads, no identifiers (§11).

## Build

1. Production infrastructure:
   - Vercel project, `main` → production, PR → preview (§10.1)
   - Supabase production project. BENCHMARK REGION LATENCY FIRST (§14 open item):
     measure eu-west-1 vs eu-central-1 from a Nigerian connection and record the
     numbers before choosing. Do not pick by assumption.
   - All §10.2 env vars set per environment. `SUPABASE_SERVICE_ROLE_KEY` is
     server-only; verify it is absent from the client bundle.
   - Staging project mirroring production for previews

2. Release pipeline per §10.3, in order:
     typecheck → lint → lint:rulepack → unit → SAFETY → build → e2e → deploy
   The safety job is a required check on the branch protection rule. Confirm it
   cannot be bypassed by an admin merge.

3. Migrations: `supabase db push` to staging on merge, to production on release
   tag. Forward-only. No destructive change to `clinical_events`, ever.

4. `GET /api/health` — checks database connectivity, rulepack availability and
   its checksum, and reference data row counts. Returns structured JSON. Wire to
   an uptime monitor.

5. Post-deploy canary, running for 30 minutes after each production deploy:
   - Error rate versus the prior baseline
   - The three absence-of-behaviour metrics above
   - Sync success rate
   - p75 time to interactive
   Fail the deploy and alert on regression.

6. BETA GATING (§10.5) — public launch is BLOCKED until a registered clinician
   reviews and signs off the rulepack:
   - Invite-only access: an allowlist or invite code checked at signup
   - Persistent in-app beta indicator
   - A visible feedback route
   - The app must refuse to serve a rulepack whose `review_status` is not
     'clinician_reviewed' in the production environment. Enforce in code, not by
     process — a process gate is one forgotten step away from failing.

7. Monitoring: Sentry with the step-14 scrubbing verified in production
   configuration, uptime checks on /api/health, and a dashboard for the canary
   metrics.

8. README release runbook covering: shipping a red-flag change (raise the floor),
   shipping a rulepack update (no deploy needed), rolling back (lower the floor
   first, then revert), and the incident procedure for a suspected safety defect.

## Human-verification checklist — BLOCKING, cannot be completed by an agent

Report the status of each. Do not mark this step complete while any is
outstanding, and do not attempt to satisfy any of them yourself:

  [ ] `content/emergency-numbers.json` populated and VERIFIED BY A HUMAN against
      current official sources (§14, step 7). The build fails until populated —
      that failure is intentional.
  [ ] Clinician review of the rulepack, with `review_status` set to
      'clinician_reviewed' and the reviewer recorded (§10.5, §14)
  [ ] Facility dataset for every launch state, with EVERY `has_emergency` record
      confirmed by phone and `verified_at` / `verified_by` recorded (§6.3, step
      13a). The escalation screen is incomplete without it.
  [ ] SMS sender ID approved with the provider for Nigerian transactional
      routing (step 5). Verify real OTP delivery to MTN, Airtel and Glo numbers.
  [ ] Privacy policy reviewed against actual data flows, with every processor
      correctly named (§11)
  [ ] Landing page copy reviewed against the APCON prohibition on advertising
      digital diagnosis or treatment (§2.4, §11)
  [ ] Supabase region chosen on measured latency, not assumption (§14)
  [ ] NDPC registration assessed; annual audit obligation diarised for the
      2,000 data subject threshold (§11)

## Tests

  a. Production smoke: signup with a real number, consent, add a medication,
     log a dose, run a symptom check, verify sync
  b. /api/health returns healthy across all checks
  c. Service-role key absent from the client bundle — grep the deployed output
  d. RLS verified against PRODUCTION: authenticate as two real accounts, confirm
     zero cross-user reads. Do not assume it carried over from local.
  e. Canary metrics emit and populate the dashboard
  f. A rulepack with review_status != 'clinician_reviewed' is REFUSED in the
     production environment
  g. Lowering `minimum_supported` at runtime takes effect without a deploy
  h. Invite gating blocks a non-allowlisted signup

## Constraints

- Never deploy with a failing safety suite. The job is required, not advisory.
- Never populate emergency numbers yourself.
- Never publish beyond the invite list before clinician sign-off.
- No clinical content in metrics, logs, or error reports.

## Final verification gate

  Full pipeline green end to end
  All tests (a)–(h) pass
  Human checklist status reported item by item

Then paste:
  - Production URL and deployment status
  - Measured Supabase region latency for both candidates
  - /api/health output
  - Output of test (d), production RLS isolation
  - Output of test (f), the clinician-gate refusal
  - Canary dashboard with baseline metrics
  - Human checklist with each item's status

## Final handoff

Output "SANA v1 — BUILD COMPLETE" containing:
  - Every §1.4 success criterion with its measured result
  - Total safety cases passing, by suite
  - Outstanding human-verification items
  - Known limitations: the AC-3.2.2 notification gap, differential diagnosis
    deferred to v1.5, custom medications unscreenable
  - The v1.5 backlog: facility finder, differential diagnosis pending clinical
    review, native wrapper if reminders prove load-bearing
  - Anything a future engineer must know that is not in the PRD
```

---
---

## Known v1 limitations

Carry these into the v1.5 review.

| Limitation | Consequence | Resolution path |
|---|---|---|
| No offline + app-closed notifications (C6) | Reminders need a connection, or the app to be open | Native wrapper (Capacitor/Expo) if reminders prove load-bearing |
| No differential diagnosis | Users get urgency, not a possible condition | v1.5, gated on clinician-reviewed rulepack content |
| Custom medications unscreenable | A drug outside the catalog cannot be checked | Grow the catalog; the `INCOMPLETE` state keeps this honest meanwhile |
| ~800-drug catalog | Coverage gaps push users to the custom path | Expand curation post-beta |
| Class-level interactions only | Less precise than ingredient-level | RxLabelGuard ($20–99/mo) if precision proves necessary |
| Field-level encryption only (C3) | Device attacker sees data shape, not content | Inherent to IndexedDB; document in privacy policy |
| Verified facility data covers launch state(s) only | Elsewhere users get OSM community data, explicitly unverified, and no emergency facility on the escalation screen | Expand curation state by state; verification is the cost, not code |
| OSM coverage of Nigerian facilities is patchy, often without phone numbers | Tier-3 results may be sparse or lack contact details | Inherent to the source; the save-as-mine path lets users fill gaps themselves |
| No rendered maps | Directions require handing off to another app, which needs a connection | Deliberate — the value is the data. Revisit only if the hand-off proves insufficient |
| LWW conflict resolution | Concurrent multi-device edits can lose one | Acceptable at single-user ownership; revisit if sharing ships |

## v1.5 backlog

- Facility data coverage beyond the launch state(s) — the directory itself ships in v1
- Rendered offline maps (MapLibre + Protomaps tile packs), if the directory proves insufficient without them
- Differential diagnosis, pending clinical review of the expanded rulepack
- Free-text symptom entry with LLM parsing — **parsing only, never in the decision path**
- Native wrapper, if reminders prove load-bearing
- PowerSync migration, if partial replication or multi-user features arrive

## v2

- Appointments and payments (Paystack), gated on MDCN-registered practitioners
- Caregiver and sharing features — this is when conflict resolution needs revisiting
