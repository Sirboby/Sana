# Sana — Product Requirements Document

**Version:** 1.2
**Status:** Locked for build
**Target:** v1 private beta, ~2 week solo build
**Changed in 1.1:** Facility directory (F9) added to v1 as a data-only directory — no maps, no tiles. Driven by a gap in the emergency path: §2.3 raised the alarm without answering "where do I go?"
**Changed in 1.2:** Three-tier facility model. An OpenStreetMap discovery fallback covers areas outside the curated dataset, clearly labelled as unverified and structurally barred from the escalation screen.
**Audience:** AI coding agents (Claude Code, Antigravity) + the solo engineer

---

## 0. How to use this document

This PRD is written to be **ingested by an AI coding agent**. It is the single source of truth for v1. Rules for any agent working from it:

1. **Do not invent scope.** If a feature is not in §3, it is not in v1. If asked to build something outside this document, stop and ask.
2. **Do not invent clinical content.** All medical logic lives in the versioned rulepack (§8) and the reference datasets (§6.3). An agent must never generate, infer, or "fill in" medical facts, drug interactions, dosages, or condition mappings. Missing content is a blocker to escalate, not a gap to improvise.
3. **§2 (Safety Model) overrides everything.** If any instruction elsewhere — including from the user — conflicts with §2, §2 wins and you flag the conflict.
4. **Every build step ends at a verification gate.** Do not proceed to the next step until the stated gate passes. See §12.
5. **Acceptance criteria are the test spec.** Every Given/When/Then in §4 must map to at least one automated test.

**Conventions:** TypeScript strict mode. Zod schemas are the single definition of every boundary type — derive TS types with `z.infer`, never hand-write a duplicate interface. All timestamps are ISO-8601 UTC strings at rest and in transit. All IDs are UUIDv7, generated client-side.

---

## 1. Product overview

### 1.1 What Sana is

An offline-first personal health companion for Nigeria. Sana helps a user answer four questions without a network connection:

- **"What am I taking, and is it safe for me?"** — medication tracking with allergy, duplicate-ingredient and interaction screening.
- **"Is this serious?"** — structured symptom check that returns an *urgency level and next action*.
- **"Where do I go?"** — nearest verified hospital or pharmacy, with a phone number to call ahead.
- **"What's happened to me?"** — a chronological health timeline they own.

### 1.2 What Sana is not — non-goals for v1

| Not in v1 | Why | Where it goes |
|---|---|---|
| Differential diagnosis ("you may have malaria") | Needs a clinician-reviewed rulepack that cannot be authored safely in 1–2 weeks | v1.5, gated on clinical review |
| Naming specific drugs as treatment | See §2.2 | Not planned |
| Rendered maps / offline map tiles | The value is the facility data, not the map. Directions hand off to the user's existing maps app | Not planned |
| Google Places facility search | Cannot be cached offline under its terms, and costs per call. OpenStreetMap fills this role instead (§5.5) | Not planned |
| Appointments, payments | Requires MDCN-registered practitioners | v2 |
| Free-text symptom entry / LLM parsing | Structured picker is faster to build and safer | v1.5 |
| Multi-user, sharing, caregiver access | No conflict-resolution need in v1 | v2 |
| Native app / app stores | PWA only | Later |

### 1.3 Users

**Primary:** Nigerian adult, Android mid-range device, intermittent and metered connectivity, manages their own or a family member's medication. Health-literate enough to name their drugs, not clinically trained.

**Secondary (v1 scope only as a data subject):** a dependent — child or elderly parent — whose meds the primary user tracks. v1 supports this as *additional profiles owned by one account*, not as separate logins.

### 1.4 Success criteria for the beta

- A user can complete a full medication log cycle with the device in airplane mode, and see it synced on a second device after reconnecting.
- The duplicate-ingredient check correctly catches paracetamol stacking in 100% of the golden test cases.
- Every red-flag golden case (§2.3) produces an emergency escalation. **No exceptions — this gates release.**
- The escalation screen shows a verified emergency facility for every launch state, offline, and shows nothing rather than something wrong where none is known.
- Cold start to interactive under 2.5s on a mid-range Android over 3G.

---

## 2. Safety model

> **This section is normative and takes precedence over all others.**

### 2.1 The core stance

Sana provides **triage and safety screening**, never treatment. The distinction in one line:

- ✅ *"This combination is unsafe for you"* — screening what the user has already chosen.
- ❌ *"Take this for your symptoms"* — prescribing.

### 2.2 Hard prohibitions

The application must **never**, in any code path, UI string, or content record:

1. Name a specific medication as a treatment for a symptom or suspected condition.
2. Provide, calculate, or suggest a dose.
3. State or imply a diagnosis. Permitted framing is urgency and next action only.
4. Advise a user to delay, avoid, or stop professional care.
5. Recommend stopping or changing a prescribed medication. (Sana may *flag a risk* and say "discuss this with your doctor or pharmacist." It may never say "stop taking it.")
6. Route any clinical decision through a language model. LLMs are prohibited in the decision path for v1 — the structured picker means there is no parsing step, so no model is used at all.

### 2.3 Red-flag rules — blocking

Red flags are evaluated **first**, before any other logic, on every symptom check. A match immediately renders the emergency escalation screen and terminates the flow. Red-flag evaluation is pure, synchronous, offline, and has no dependency on the rulepack version being current.

| ID | Trigger | Applies to |
|---|---|---|
| `RF001` | Chest pain, pressure or tightness | Adult |
| `RF002` | Difficulty breathing / shortness of breath at rest | All |
| `RF003` | FAST stroke signs — face droop, arm weakness, speech difficulty | All |
| `RF004` | Severe bleeding that will not stop | All |
| `RF005` | Loss of consciousness, fainting, unresponsiveness | All |
| `RF006` | Seizure (first, or unusual for this person) | All |
| `RF007` | Fever + stiff neck + rash | All |
| `RF008` | Severe abdominal pain with a rigid or board-like abdomen | All |
| `RF009` | Signs of anaphylaxis — facial/throat swelling, widespread hives with breathing difficulty | All |
| `RF010` | Suicidal ideation or intent to self-harm | All |
| `RF011` | Suspected poisoning or medication overdose | All |
| `RF012` | Pregnancy: vaginal bleeding, severe headache with visual changes, or reduced fetal movement | Pregnant users |
| `RF013` | Infant under 3 months with temperature ≥ 38.0 °C | Infant profile |
| `RF014` | Child with signs of severe dehydration — sunken eyes, no tears, lethargy, no urine 8h+ | Child profile |
| `RF015` | New confusion or altered mental state | All |

**Escalation screen requirements:** full-screen, non-dismissible without explicit acknowledgement, highest-contrast treatment in the design system. Must render identically offline.

Actions, in strict priority order:

1. **Primary — call emergency services.** Number from the human-verified config (§14). Visually dominant.
2. **Secondary — nearest verified emergency facility** (§3 F9): name, distance, call button, directions hand-off. Shown only when a facility with `has_emergency = true` is known for the user's area.

Rationale for the second action: ambulance dispatch is unreliable across much of Nigeria, so for many users the real next step is *getting themselves to a hospital*. An escalation screen that raises the alarm and then goes silent on where to go leaves the emergency path incomplete.

**Constraints on the secondary action:**

- Only facilities with `has_emergency = true` AND a `verified_at` date may appear here. Never fall back to a pharmacy, a clinic, or an unverified record — sending someone in crisis to a facility with no emergency department is harm.
- When no verified emergency facility is known for the user's area, show **nothing**. An absent block is correct; a wrong destination is not.
- No other navigation. These two actions and nothing else.
- Must work offline, using last-known location or the user's selected state.

### 2.4 Disclaimer placement

Not a footer. Contextual and unavoidable at the moment of risk:

- **First run:** a consent screen the user must actively accept. Records `consents` row (§6.1). Version-tracked — a changed disclaimer requires re-consent.
- **Every triage result:** persistent banner, above the result, not collapsible. *"This is guidance, not a diagnosis. It does not replace seeing a health professional."*
- **Every interaction/allergy warning:** *"Do not stop any prescribed medicine because of this alert. Speak to your doctor or pharmacist."*
- **Marketing/public pages:** must comply with the APCON prohibition on advertising that offers to diagnose or treat illness through digital channels. Public copy describes tracking and safety-checking, never diagnosis.

### 2.5 Provenance

Every triage result and every safety alert persists the `rulepack_version` and `ruleset_checksum` that produced it. Content changes must never make historical results unexplainable.

---

## 3. Feature scope — v1

| # | Feature | Priority | Offline |
|---|---|---|---|
| F1 | Account + profile management | P0 | Auth online; profile edits offline |
| F2 | Allergy & condition profile | P0 | Full |
| F3 | Medication regimen management | P0 | Full |
| F4 | Dose logging + reminders | P0 | Full |
| F5 | Safety screening engine | P0 | Full |
| F6 | Red-flag symptom check | P0 | Full |
| F7 | Health timeline | P1 | Full |
| F8 | Sync | P0 | N/A |
| F9 | Facility directory | P0 | Full (list, phone); directions need a connection |

---

## 4. User stories & acceptance criteria

> Format: every AC is directly testable. `[UNIT]`, `[E2E]`, `[SAFETY]` indicate the suite that must cover it.

### F1 — Account & profile

**US-1.1** — *As a new user, I want to sign up with my phone number, so I don't need an email address.*

- **AC-1.1.1** `[E2E]` Given I am on `/signup`, When I enter a valid Nigerian phone number (`+234` or `0` prefixed, 11 digits normalised to E.164), Then I receive an OTP and am shown the code entry screen.
- **AC-1.1.2** `[E2E]` Given I entered a valid OTP, When it is verified, Then a `profiles` row is created, and I am routed to the consent screen.
- **AC-1.1.3** `[UNIT]` Given an invalid phone format, When I submit, Then a field-level error appears and no network request is made.
- **AC-1.1.4** `[E2E]` Given I am offline, When I open `/signup`, Then I see an explicit "You need a connection to create an account" state — not a generic failure.

**US-1.2** — *As a new user, I must accept the safety disclaimer before using the app.*

- **AC-1.2.1** `[SAFETY]` Given a profile with no accepted consent of the current version, When I attempt to reach any authenticated route, Then I am redirected to `/consent`.
- **AC-1.2.2** `[SAFETY]` Given I am on `/consent`, When I have not checked the acknowledgement box, Then the continue action is disabled.
- **AC-1.2.3** `[UNIT]` Given I accept, When the consent is recorded, Then a `consents` row exists with `consent_type='safety_disclaimer'`, the current `version`, and `granted_at`.
- **AC-1.2.4** `[SAFETY]` Given the disclaimer version increments, When I next open the app, Then I must re-consent before continuing.

**US-1.3** — *As a user, I want to add profiles for family members whose medication I manage.*

- **AC-1.3.1** `[E2E]` Given I am authenticated, When I create a dependent profile with name, date of birth and sex, Then it appears in the profile switcher and syncs.
- **AC-1.3.2** `[UNIT]` Given a dependent profile with DOB under 3 months, When a symptom check runs, Then infant red-flag rules (`RF013`) are in scope.
- **AC-1.3.3** `[UNIT]` Given I switch active profile, When I view any clinical screen, Then only that profile's data is shown.

### F2 — Allergy & condition profile

**US-2.1** — *As a user, I want to record my drug allergies so Sana can warn me.*

- **AC-2.1.1** `[E2E]` Given I am on `/profile/allergies`, When I search for an allergen, Then results come from the **local** catalog and appear with no network request.
- **AC-2.1.2** `[UNIT]` Given I select a drug allergen, When I save it with a severity, Then an `allergies` row is written locally and queued in the outbox.
- **AC-2.1.3** `[UNIT]` Given I record an allergy to a drug in the penicillin class, When the record is saved, Then the derived `drug_class` field is populated from the catalog, not from free text.
- **AC-2.1.4** `[E2E]` Given I record an allergy while offline, When I reconnect, Then it appears on a second device within one sync cycle.

**US-2.2** — *As a user, I want to record chronic conditions so contraindications are caught.*

- **AC-2.2.1** `[UNIT]` Given I record "peptic ulcer", When I later add an NSAID to my regimen, Then a contraindication alert is raised (§5.3).
- **AC-2.2.2** `[UNIT]` Given I mark my profile as pregnant, When a symptom check runs, Then pregnancy red-flag rules (`RF012`) are in scope.

### F3 — Medication regimen

**US-3.1** — *As a user, I want to add a medication I'm taking.*

- **AC-3.1.1** `[E2E]` Given I search the drug catalog offline, When I type at least 2 characters, Then matching generic and brand names appear within 100ms.
- **AC-3.1.2** `[E2E]` Given my drug is not in the catalog, When I choose "add manually", Then I can save a custom name — and the record is flagged `is_custom=true` and **excluded from ingredient-level screening**, with that limitation shown to me explicitly.
- **AC-3.1.3** `[UNIT]` Given I save a medication, When the screening engine runs, Then any alerts are shown **before** the save is confirmed, with an explicit acknowledge step.
- **AC-3.1.4** `[UNIT]` Given a medication with an end date in the past, When I view my active list, Then it is excluded but remains in the timeline.

**US-3.2** — *As a user, I want a schedule so I get reminders.*

- **AC-3.2.1** `[UNIT]` Given I set "twice daily at 08:00 and 20:00", When the schedule is stored, Then it serialises to the `schedule` JSONB shape in §6.1 and round-trips losslessly.
- **AC-3.2.2** `[E2E]` Given a scheduled dose is due and notification permission is granted, When the time arrives with the app closed, Then a local notification fires — **with no network connection**.

### F4 — Dose logging

**US-4.1** — *As a user, I want to log that I took a dose.*

- **AC-4.1.1** `[E2E]` Given the device is in airplane mode, When I log a dose, Then it is written locally, appears immediately in the UI, and shows a pending-sync indicator.
- **AC-4.1.2** `[UNIT]` Given I log a dose, When the event is created, Then a `clinical_events` row with `event_type='medication_taken'` is appended — never an update to an existing row.
- **AC-4.1.3** `[UNIT]` Given I made a mistake, When I correct a logged dose, Then a **new** correcting event is appended and the original is tombstoned via `deleted_at` — the original row is never mutated or hard-deleted.
- **AC-4.1.4** `[E2E]` Given I logged 5 doses offline, When I reconnect, Then all 5 sync in a single push, and re-running sync does not duplicate them.

### F5 — Safety screening engine

**US-5.1** — *As a user, I want to be warned if a medicine could harm me.* **This is the highest-value feature in v1.**

- **AC-5.1.1** `[SAFETY]` Given I am allergic to penicillin, When I add amoxicillin, Then a **severe** allergy alert is raised before save.
- **AC-5.1.2** `[SAFETY]` Given I am allergic to penicillin, When I add cefalexin, Then a **cross-reactivity** alert is raised, correctly labelled as a class cross-reaction rather than a direct match.
- **AC-5.1.3** `[SAFETY]` Given I am taking a combination cold remedy containing paracetamol, When I add plain paracetamol, Then a **duplicate active ingredient** alert is raised naming both products and the shared ingredient.
- **AC-5.1.4** `[SAFETY]` Given I have peptic ulcer recorded, When I add ibuprofen, Then a condition-contraindication alert is raised.
- **AC-5.1.5** `[SAFETY]` Given any alert is raised, When it renders, Then it includes severity, the plain-language reason, the "do not stop prescribed medicine" disclaimer, and the `rulepack_version`.
- **AC-5.1.6** `[SAFETY]` Given the screening engine runs, When it produces any output, Then that output contains **no dose figure and no treatment recommendation**. Asserted by a string-level test against the rendered result.
- **AC-5.1.7** `[UNIT]` Given the device is offline, When screening runs, Then results are identical to online. No network call exists in this code path.
- **AC-5.1.8** `[UNIT]` Given a custom (non-catalog) medication is in the regimen, When screening runs, Then the result explicitly states that this medicine could not be checked.

### F6 — Red-flag symptom check

**US-6.1** — *As a worried user, I want to know whether this is an emergency.*

- **AC-6.1.1** `[SAFETY]` Given I select any symptom combination matching a rule in §2.3, When evaluation completes, Then the emergency escalation screen renders and the flow terminates. **All 15 rules must be covered by golden cases.**
- **AC-6.1.2** `[SAFETY]` Given a red flag matched, When the screen renders, Then it is non-dismissible without explicit acknowledgement and offers exactly one primary action.
- **AC-6.1.3** `[SAFETY]` Given no red flag matched, When the result renders, Then it shows an urgency band — `SEE_DOCTOR_TODAY` / `SEE_DOCTOR_SOON` / `SELF_CARE_REASONABLE` — and **never a condition name**.
- **AC-6.1.4** `[SAFETY]` Given any triage result renders, When inspected, Then the non-collapsible disclaimer banner is present above the result.
- **AC-6.1.5** `[UNIT]` Given a completed check, When it is stored, Then a `clinical_events` row with `event_type='triage_completed'` records selected symptoms, outcome, `rulepack_version` and `ruleset_checksum`.
- **AC-6.1.6** `[SAFETY]` Given the rulepack fails its checksum or is missing, When a check is attempted, Then red-flag evaluation **still runs** (it is compiled into the app, not the rulepack) and non-emergency guidance is suppressed with an explanatory state.

### F7 — Health timeline

**US-7.1** — *As a user, I want to see my health history.*

- **AC-7.1.1** `[E2E]` Given I have events, When I open `/timeline`, Then they render reverse-chronologically, grouped by day, offline.
- **AC-7.1.2** `[UNIT]` Given 5,000 local events, When the timeline renders, Then it paginates and first paint is under 300ms.
- **AC-7.1.3** `[UNIT]` Given tombstoned events, When the timeline renders, Then they are excluded.
- **AC-7.1.4** `[E2E]` Given I filter by event type, When the filter applies, Then only matching events show, with no network request.

### F9 — Facility directory

> **Design stance:** this is a *directory*, not a map. The value is verified data — a name, a distance, a phone number to call ahead. Directions hand off to whatever maps app the user already has, so Sana ships no tiles and renders no map.

**US-9.1** — *As a user in an emergency, I want to know which hospital to go to.*

- **AC-9.1.1** `[SAFETY]` Given a red flag has matched and a verified emergency facility is known for my area, When the escalation screen renders, Then it shows that facility's name, distance, a call action and a directions action, below the primary emergency-services action (§2.3).
- **AC-9.1.2** `[SAFETY]` Given NO verified emergency facility is known for my area, When the escalation screen renders, Then the facility block is absent entirely. It must never fall back to a pharmacy, a clinic, or a facility with `has_emergency = false`.
- **AC-9.1.3** `[SAFETY]` Given facilities are available, When one is shown on the escalation screen, Then it has `has_emergency = true` AND a non-null `verified_at`. Assert both.
- **AC-9.1.4** `[E2E]` Given the device is offline, When the escalation screen renders, Then the facility block still appears using last-known location or my selected state.

**US-9.2** — *As a user, I want to find a pharmacy or hospital near me.*

- **AC-9.2.1** `[E2E]` Given I open `/app/facilities` offline, When the list renders, Then facilities for my selected state appear with no network request.
- **AC-9.2.2** `[UNIT]` Given location permission is granted, When the list renders, Then it is sorted by distance ascending, computed on-device.
- **AC-9.2.3** `[UNIT]` Given location permission is DENIED or unavailable, When the list renders, Then it falls back to browsing by state and LGA, sorted alphabetically. The directory must be fully usable with no location access at all.
- **AC-9.2.4** `[UNIT]` Given I filter by type, When the filter applies, Then only facilities of that type show, with no network request.
- **AC-9.2.5** `[E2E]` Given I tap a phone number, When the action fires, Then a `tel:` link opens. Works offline.
- **AC-9.2.6** `[E2E]` Given I tap directions, When the action fires, Then it hands off to the device's maps application with the facility's coordinates. Requires a connection; degrade with an explicit message when offline.
- **AC-9.2.7** `[UNIT]` Given a facility record, When it renders, Then its `verified_at` date is displayed so I can judge how current it is.
- **AC-9.2.8** `[UNIT]` Given a facility whose `verified_at` is older than 12 months, When it renders, Then it is visibly marked as possibly out of date.

**US-9.4** — *As a user outside a covered area, I want to see what's nearby anyway.*

- **AC-9.4.1** `[E2E]` Given no curated facilities exist for my location and I am online, When I open the directory, Then OpenStreetMap results appear in a separate section labelled as unverified community data (§5.5).
- **AC-9.4.2** `[SAFETY]` Given discovered facilities are present, When the escalation screen renders, Then NO discovered facility appears, regardless of proximity or emergency tagging. Assert structurally, not just visually.
- **AC-9.4.3** `[UNIT]` Given a discovered facility, When passed to `nearestEmergencyFacility()`, Then it is a **compile-time type error**, not a runtime filter.
- **AC-9.4.4** `[UNIT]` Given coordinates are sent for discovery, When the request is built, Then they are coarsened to ~1km precision and proxied through Sana's API — never sent to OpenStreetMap directly from the device (§5.5, §11).
- **AC-9.4.5** `[E2E]` Given I fetched discovered facilities while online, When I go offline, Then they remain available from cache with their `fetched_at` shown.
- **AC-9.4.6** `[UNIT]` Given a discovered facility older than 30 days, When it renders, Then it is marked stale and re-fetched when connectivity allows.
- **AC-9.4.7** `[E2E]` Given a discovered facility, When I save it as mine, Then it becomes a tier-1 `user_facilities` record and leaves the unverified section.
- **AC-9.4.8** `[UNIT]` Given curated facilities DO exist for my area, When the directory renders, Then curated results appear first and discovery is only used to supplement, never to replace them.
- **AC-9.4.9** `[UNIT]` Given discovery is unavailable — offline, rate-limited, or erroring — When the directory renders, Then curated and saved facilities still show and the failure is a quiet inline notice, never a blocking error.

**US-9.3** — *As a user, I want to save my own hospital and pharmacy.*

- **AC-9.3.1** `[UNIT]` Given I save a personal facility with a name and phone number, When it is stored, Then it syncs as user data (not reference data) and appears pinned at the top of the directory.
- **AC-9.3.2** `[SAFETY]` Given I have saved a personal emergency facility, When the escalation screen renders, Then MY saved facility takes precedence over the nearest verified one. A user's own knowledge of where they go outranks our dataset.

### F8 — Sync

**US-8.1** — *As a user, my data should follow me across devices.*

- **AC-8.1.1** `[E2E]` Given queued outbox mutations, When connectivity returns, Then sync fires automatically within 5 seconds.
- **AC-8.1.2** `[UNIT]` Given a push partially fails, When the response is processed, Then applied mutations are cleared from the outbox and rejected ones are retained with the failure reason.
- **AC-8.1.3** `[UNIT]` Given the same mutation is pushed twice, When the server processes it, Then the result is identical to pushing once. **Idempotency is mandatory.**
- **AC-8.1.4** `[UNIT]` Given the same record was edited on two devices, When both sync, Then the higher `updated_at` wins for current-state tables, and **both events are retained** for append-only tables.
- **AC-8.1.5** `[E2E]` Given sync fails 3 times, When the 4th attempt is scheduled, Then exponential backoff with jitter is applied and the user sees a non-blocking indicator.

---

## 5. Domain logic specifications

### 5.1 Screening engine — evaluation order

Pure function. No I/O. Deterministic. Same input always yields the same output.

```ts
type ScreeningInput = {
  profile: { dateOfBirth: string; sexAtBirth: Sex; isPregnant: boolean };
  allergies: Allergy[];
  conditions: Condition[];
  currentMedications: Medication[];
  candidate: Medication;          // the drug being added or checked
  rulepack: Rulepack;
};

type Alert = {
  id: string;
  kind: 'ALLERGY_DIRECT' | 'ALLERGY_CROSS_CLASS' | 'DUPLICATE_INGREDIENT'
      | 'INTERACTION' | 'CONDITION_CONTRA' | 'PREGNANCY_CAUTION' | 'UNCHECKABLE';
  severity: 'INFO' | 'CAUTION' | 'SERIOUS' | 'CRITICAL';
  title: string;
  explanation: string;            // plain language, from rulepack — never generated
  involvedDrugs: { id: string; label: string }[];
  source: string;
  rulepackVersion: string;
};

function screen(input: ScreeningInput): Alert[];
```

**Order (all stages always run; alerts accumulate and sort by severity descending):**

1. **Uncheckable guard** — if `candidate.is_custom`, emit `UNCHECKABLE` and skip ingredient-level stages for it.
2. **Direct allergy** — candidate's active ingredients ∩ user's drug allergen codes → `CRITICAL`.
3. **Cross-class allergy** — candidate's `drug_classes` ∩ cross-reference table for the user's allergen classes → `SERIOUS`.
4. **Duplicate active ingredient** — candidate's ingredients ∩ union of active medications' ingredients → `SERIOUS`. *Highest-value check in the product: this is the paracetamol-stacking case.*
5. **Interaction** — curated class-level pairs against active medications.
6. **Condition contraindication** — candidate's classes against user conditions.
7. **Pregnancy caution** — if `isPregnant`, candidate classes against the pregnancy-caution list.

### 5.2 Cross-reactivity classes — v1 minimum

| Allergen class | Cross-reactive with | Risk |
|---|---|---|
| Penicillins | Cephalosporins | Low–moderate |
| Penicillins | Carbapenems | Low |
| Sulfonamide antibiotics | Other sulfonamide antibiotics | Moderate |
| NSAIDs | Other NSAIDs incl. aspirin | Moderate–high |
| Macrolides | Other macrolides | Moderate |

### 5.3 Condition contraindications — v1 minimum

| Condition | Contraindicated class | Severity |
|---|---|---|
| Peptic ulcer / GI bleed | NSAIDs | SERIOUS |
| Chronic kidney disease | NSAIDs | SERIOUS |
| Asthma (NSAID-sensitive) | NSAIDs | SERIOUS |
| Liver disease | Paracetamol (cumulative) | SERIOUS |
| Hypertension | NSAIDs, decongestants | CAUTION |
| G6PD deficiency | Sulfonamides, some antimalarials | SERIOUS |

> **Note for content authoring:** G6PD deficiency is materially prevalent in Nigeria and belongs in v1.

### 5.5 Facility data tiers

Three sources, ranked. The ranking is not a display preference — it is a trust hierarchy, and the type system enforces it.

| Tier | Source | Trust | Offline | Escalation screen |
|---|---|---|---|---|
| **1** | User's own saved facilities (`user_facilities`) | Highest — they know where they go | ✅ | ✅ eligible |
| **2** | Curated, phone-verified (`facilities`) | Verified, with a date | ✅ | ✅ eligible |
| **3** | OpenStreetMap discovery (`discovered_facilities`) | **Unverified community data** | Cached only after a first online fetch | ❌ **never eligible** |

**Tier 3 exists to soften coverage gaps, not to substitute for verification.** Outside a curated state the directory would otherwise be empty; OSM gives the user *something* — a name, a rough location, sometimes a phone number — while being honest that nobody checked it.

**Enforcement.** `DiscoveredFacility` is a distinct type from `Facility`, not a flag on the same one. `nearestEmergencyFacility()` accepts only the verified types, so a discovered record cannot reach the escalation screen even by mistake. A boolean that must be remembered is a boolean that will be forgotten; a type that cannot be passed is a type that cannot be passed.

**Presentation.** Tier 3 results render in a visually separate section headed to the effect of *"Community data — not verified by Sana"*, below tiers 1 and 2, never interleaved with them. Each carries a prompt to save it as a personal facility, which promotes it to tier 1.

**Caching.** Discovered results persist locally with a `fetched_at` so they remain available offline. Local-only — they never sync to the server and never enter the reference dataset. Stale after 30 days, at which point they are re-fetched when online or marked accordingly.

**Privacy (§11).** Querying OpenStreetMap directly from the device would disclose the user's location to a third party. Instead the query is proxied through Sana's own API, and coordinates are **coarsened to roughly 1km** before leaving the device — facility search does not need street-level precision, and reduced precision is data minimisation in the NDPA sense.

### 5.4 Red-flag evaluation

```ts
function evaluateRedFlags(
  symptoms: SymptomCode[],
  profile: ProfileContext
): RedFlagMatch | null;
```

**Compiled into the application bundle — not loaded from the rulepack.** Rationale: red-flag detection must survive a corrupt, stale, or missing rulepack (AC-6.1.6). Changing it requires a deploy and a passing safety suite.

---

## 6. Data model

### 6.1 Postgres schema (Supabase)

```sql
-- ─────────────── ENUMS ───────────────
create type sex_at_birth   as enum ('male','female','intersex','undisclosed');
create type allergen_type  as enum ('drug','food','environmental');
create type severity_level as enum ('mild','moderate','severe','anaphylaxis');
create type event_type     as enum (
  'medication_taken','medication_skipped','symptom_reported',
  'triage_completed','allergy_recorded','condition_recorded',
  'vital_recorded','note_added','correction'
);
create type urgency_band   as enum (
  'EMERGENCY','SEE_DOCTOR_TODAY','SEE_DOCTOR_SOON','SELF_CARE_REASONABLE'
);
create type facility_type  as enum (
  'hospital','clinic','pharmacy','diagnostic_centre'
);

-- ─────────────── ACCOUNTS ───────────────
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  phone         text unique not null,
  display_name  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- A person whose health is tracked. Every account has one 'self' person.
create table persons (
  id             uuid primary key,
  owner_id       uuid not null references profiles(id) on delete cascade,
  display_name   text not null,
  relationship   text not null default 'self',
  date_of_birth  date,
  sex_at_birth   sex_at_birth not null default 'undisclosed',
  is_pregnant    boolean not null default false,
  weight_kg      numeric(5,2),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index persons_owner_idx on persons(owner_id) where deleted_at is null;

create table consents (
  id            uuid primary key,
  owner_id      uuid not null references profiles(id) on delete cascade,
  consent_type  text not null,
  version       text not null,
  granted_at    timestamptz not null,
  revoked_at    timestamptz,
  unique (owner_id, consent_type, version)
);

-- ─────────────── CLINICAL PROFILE (current state) ───────────────
create table allergies (
  id              uuid primary key,
  person_id       uuid not null references persons(id) on delete cascade,
  owner_id        uuid not null references profiles(id) on delete cascade,
  allergen_type   allergen_type not null,
  allergen_code   text,               -- catalog reference; null if custom
  allergen_label  text not null,
  drug_classes    text[] not null default '{}',
  severity        severity_level not null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index allergies_person_idx on allergies(person_id) where deleted_at is null;

create table conditions (
  id              uuid primary key,
  person_id       uuid not null references persons(id) on delete cascade,
  owner_id        uuid not null references profiles(id) on delete cascade,
  condition_code  text,
  condition_label text not null,
  onset_date      date,
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index conditions_person_idx on conditions(person_id) where deleted_at is null;

create table medications (
  id            uuid primary key,
  person_id     uuid not null references persons(id) on delete cascade,
  owner_id      uuid not null references profiles(id) on delete cascade,
  drug_id       uuid references drug_catalog(id),
  is_custom     boolean not null default false,
  display_name  text not null,
  dose_amount   numeric(10,3),        -- user-entered record only, never suggested
  dose_unit     text,
  schedule      jsonb not null default '{}'::jsonb,
  start_date    date not null,
  end_date      date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index medications_person_idx on medications(person_id) where deleted_at is null;
create index medications_active_idx on medications(person_id)
  where deleted_at is null and end_date is null;

-- ─────────────── CLINICAL EVENT LOG (append-only) ───────────────
create table clinical_events (
  id                uuid primary key,          -- client-generated UUIDv7
  person_id         uuid not null references persons(id) on delete cascade,
  owner_id          uuid not null references profiles(id) on delete cascade,
  event_type        event_type not null,
  occurred_at       timestamptz not null,      -- when it happened
  recorded_at       timestamptz not null default now(),
  payload           jsonb not null,
  rulepack_version  text,
  ruleset_checksum  text,
  client_id         text not null,
  corrects_event_id uuid references clinical_events(id),
  deleted_at        timestamptz,               -- tombstone only; rows are never updated otherwise
  created_at        timestamptz not null default now()
);
create index events_person_time_idx on clinical_events(person_id, occurred_at desc)
  where deleted_at is null;
create index events_type_idx on clinical_events(person_id, event_type, occurred_at desc);
create index events_sync_idx on clinical_events(owner_id, created_at);

-- ─────────────── REFERENCE DATA (public read, no user writes) ───────────────
create table drug_catalog (
  id                 uuid primary key,
  rxnorm_cui         text,
  nafdac_reg_no      text,
  generic_name       text not null,
  brand_names        text[] not null default '{}',
  active_ingredients jsonb not null,   -- [{code, name, strength, unit}]
  drug_classes       text[] not null default '{}',
  dosage_form        text,
  is_otc             boolean not null default false,
  region             text not null default 'NG',
  updated_at         timestamptz not null default now()
);
create index drug_generic_trgm on drug_catalog using gin (generic_name gin_trgm_ops);
create index drug_brands_idx    on drug_catalog using gin (brand_names);
create index drug_classes_idx   on drug_catalog using gin (drug_classes);

create table drug_interactions (
  id             uuid primary key,
  class_a        text not null,
  class_b        text not null,
  severity       text not null,
  mechanism      text not null,
  recommendation text not null,       -- curated content; never generated
  source         text not null,
  evidence_url   text,
  updated_at     timestamptz not null default now(),
  unique (class_a, class_b)
);

create table allergy_cross_reference (
  id               uuid primary key,
  allergen_class   text not null,
  reactive_class   text not null,
  risk_level       text not null,
  note             text not null,
  source           text not null,
  unique (allergen_class, reactive_class)
);

create table condition_contraindications (
  id              uuid primary key,
  condition_code  text not null,
  drug_class      text not null,
  severity        text not null,
  explanation     text not null,
  source          text not null,
  unique (condition_code, drug_class)
);

-- Facility directory. Reference data: public read, no user writes.
-- NOT a map layer — a verified directory. No PostGIS: distance is computed
-- on-device in JS, which is ample for a few thousand rows and removes an
-- entire server-side query path.
create table facilities (
  id             uuid primary key,
  facility_type  facility_type not null,
  name           text not null,
  address        text not null,
  state          text not null,
  lga            text not null,          -- Local Government Area
  latitude       numeric(9,6) not null,
  longitude      numeric(9,6) not null,
  phone_numbers  text[] not null default '{}',
  has_emergency  boolean not null default false,
  is_24_hours    boolean not null default false,
  opening_hours  jsonb,
  verified_at    date not null,          -- human verification date — REQUIRED
  verified_by    text not null,
  source         text not null,
  region         text not null default 'NG',
  updated_at     timestamptz not null default now()
);
create index facilities_state_idx on facilities(state, lga);
create index facilities_type_idx  on facilities(facility_type);
create index facilities_emerg_idx on facilities(state) where has_emergency = true;

-- A user's own saved hospital/pharmacy. USER data, not reference data.
create table user_facilities (
  id             uuid primary key,
  owner_id       uuid not null references profiles(id) on delete cascade,
  facility_id    uuid references facilities(id),   -- null when fully custom
  label          text not null,
  phone_number   text,
  address        text,
  is_emergency   boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index user_facilities_owner_idx on user_facilities(owner_id)
  where deleted_at is null;

create table rulepacks (
  id            uuid primary key,
  version       text unique not null,   -- semver
  checksum      text not null,          -- sha256 of content
  content       jsonb not null,
  review_status text not null default 'draft',  -- draft | clinician_reviewed | published
  reviewed_by   text,
  reviewed_at   timestamptz,
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- ─────────────── AUDIT (NDPA) ───────────────
create table audit_log (
  id          bigserial primary key,
  owner_id    uuid references profiles(id) on delete set null,
  action      text not null,
  resource    text not null,
  resource_id uuid,
  ip_address  inet,
  user_agent  text,
  occurred_at timestamptz not null default now()
);
create index audit_owner_time_idx on audit_log(owner_id, occurred_at desc);
```

### 6.2 Row Level Security

```sql
alter table profiles        enable row level security;
alter table persons         enable row level security;
alter table consents        enable row level security;
alter table allergies       enable row level security;
alter table conditions      enable row level security;
alter table medications     enable row level security;
alter table clinical_events enable row level security;
alter table user_facilities enable row level security;
alter table audit_log       enable row level security;

-- Owner-scoped policy, applied identically to every user table.
create policy owner_all on persons
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- Repeat verbatim for: consents, allergies, conditions, medications,
-- clinical_events, user_facilities.

create policy self_profile on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- Append-only enforcement: no updates except setting a tombstone.
create policy events_no_mutation on clinical_events
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and deleted_at is not null);

-- Audit log is insert-only from the client's perspective.
create policy audit_insert on audit_log for insert with check (owner_id = auth.uid());
create policy audit_read   on audit_log for select using (owner_id = auth.uid());

-- Reference tables: readable by any authenticated user, writable by no one.
alter table drug_catalog                enable row level security;
alter table drug_interactions           enable row level security;
alter table allergy_cross_reference     enable row level security;
alter table condition_contraindications enable row level security;
alter table facilities                  enable row level security;
alter table rulepacks                   enable row level security;

create policy ref_read on drug_catalog
  for select to authenticated using (true);
-- Repeat for the other five reference tables, facilities included.
```

> **Verification requirement:** RLS must be proven, not assumed. The test suite includes a case that authenticates as user A and attempts to read user B's `clinical_events`, asserting zero rows. This gates the sync step.

### 6.3 Reference data sourcing

| Dataset | Source | Licence | v1 target size |
|---|---|---|---|
| Drug catalog | RxNorm (free) + openFDA labels (free) + NAFDAC greenbook subset | Public / open | ~800 entries covering common Nigerian OTC + prescription |
| Active ingredients | openFDA structured label fields | Open | Derived from catalog |
| Interactions | Curated class-level set, cited to openFDA labels | Curated | 50–80 pairs |
| Cross-reactivity | Curated from §5.2 | Curated | 5 classes |
| Contraindications | Curated from §5.3 | Curated | 6 conditions |
| Facilities | OpenStreetMap/Overpass + any accessible Federal or State health facility registry, then **human-verified by phone** | Open + curated | Launch state(s) only; every `has_emergency` record verified |

> **Facility verification is a safety requirement, not data hygiene.** A record with `has_emergency = true` appears on the escalation screen, so an inaccurate one sends a person in crisis to a hospital that may have closed, moved, or never had an emergency department. Every emergency-flagged facility must be confirmed by phone before it ships, with the date and verifier recorded. `verified_at` is `not null` for exactly this reason. Pharmacy records carry lower stakes and can rely on a lighter check.

> **Do not** integrate the NLM/RxNav drug interaction API — retired January 2024. **Do not** depend on DrugBank's free DDI endpoint — retired March 2026. If richer structured interaction data is needed post-beta, RxLabelGuard ($20–99/mo) is the evaluated commercial option.

### 6.4 Local schema (Dexie / IndexedDB)

```ts
db.version(1).stores({
  persons:         'id, owner_id, deleted_at',
  allergies:       'id, person_id, deleted_at',
  conditions:      'id, person_id, deleted_at',
  medications:     'id, person_id, deleted_at, end_date',
  clinical_events: 'id, person_id, [person_id+occurred_at], event_type, deleted_at',
  drug_catalog:    'id, generic_name, *brand_names, *drug_classes',
  interactions:    'id, [class_a+class_b]',
  cross_reference: 'id, allergen_class',
  contraindications: 'id, [condition_code+drug_class]',
  facilities:      'id, [state+lga], facility_type, has_emergency',
  user_facilities: 'id, owner_id, deleted_at',
  // Tier 3 (§5.5). LOCAL ONLY — never synced, never a server table,
  // never eligible for the escalation screen.
  discovered_facilities: 'id, [grid_lat+grid_lon], facility_type, fetched_at',
  rulepack:        'version',
  outbox:          '++seq, mutation_id, status, created_at',
  sync_meta:       'key',
});
```

**Encryption at rest:** the local store is a health record. Encrypt sensitive fields with a key derived from the session via WebCrypto, held in memory and re-derived on unlock. Reference tables need not be encrypted.

---

## 7. Sync protocol

### 7.1 Design

Single-user ownership + append-only events means sync is an **outbox push and a watermark pull**. No CRDTs, no sync-rule DSL, no third-party sync service in v1.

```
┌── Device ──────────────┐         ┌── Server ────────────┐
│ Dexie  ──write──> outbox│ ──push──> │ /api/sync/push     │
│                         │           │  idempotent upsert  │
│ Dexie  <──apply── pull  │ <──pull── │ /api/sync/pull      │
│        watermark: last_ │           │  since=<watermark>  │
│        synced_at        │           │                     │
└─────────────────────────┘         └─────────────────────┘
```

**Triggers:** on app foreground; on `online` event; after any local mutation (debounced 2s); every 5 minutes while foregrounded.

**Backoff:** exponential from 1s, ×2, jittered ±25%, capped at 5 minutes.

### 7.2 `POST /api/sync/push`

```ts
// Request
{
  client_id: string;
  mutations: Array<{
    mutation_id: string;              // UUIDv7, client-generated, idempotency key
    table: 'persons'|'allergies'|'conditions'|'medications'|'clinical_events'
         |'consents'|'user_facilities';
    op: 'upsert' | 'tombstone';
    row: Record<string, unknown>;     // validated by the table's Zod schema
    client_updated_at: string;        // ISO-8601
  }>;
}

// Response 200
{
  applied:  string[];                 // mutation_ids
  rejected: Array<{ mutation_id: string; reason: string; code: string }>;
  server_time: string;
}
```

**Server rules:**
- Reject the batch with `400` if any row fails Zod validation. Report per-mutation.
- `owner_id` is **always** overwritten server-side from the JWT. A client-supplied `owner_id` is ignored — never trusted.
- `clinical_events`: `insert … on conflict (id) do nothing`. Append-only is enforced here and by RLS.
- Current-state tables: `on conflict (id) do update … where excluded.client_updated_at > target.updated_at`.
- Max 500 mutations per batch; client chunks larger sets.
- Every accepted batch writes one `audit_log` row.

### 7.3 `GET /api/sync/pull`

```ts
// Query:  ?since=<ISO-8601>&limit=1000
// Response 200
{
  changes: {
    persons: Row[]; allergies: Row[]; conditions: Row[];
    medications: Row[]; clinical_events: Row[]; consents: Row[];
    user_facilities: Row[];
  };
  server_time: string;                // becomes the client's new watermark
  has_more: boolean;                  // client re-pulls until false
}
```

Scoped by RLS to `auth.uid()`. Ordered by `updated_at` (or `created_at` for events) ascending. Tombstones are included so deletions propagate.

### 7.4 `GET /api/reference/sync`

```ts
// Query:  ?since=<ISO-8601>&rulepack_version=<semver>&states=LA,OG
// Response 200
{
  drug_catalog: Row[]; interactions: Row[];
  cross_reference: Row[]; contraindications: Row[];
  facilities: Row[];                               // scoped to `states`
  rulepack: { version, checksum, content } | null;  // null if client is current
  server_time: string;
}
```

Client verifies the rulepack SHA-256 against `checksum` before applying. **On mismatch: reject, keep the previous pack, log, and continue with red-flag evaluation intact (AC-6.1.6).**

### 7.4b `GET /api/facilities/discover`

Server-side proxy to OpenStreetMap Overpass (§5.5). Exists so the user's location never reaches a third party directly, and so rate limiting is controlled centrally rather than per device.

```ts
// Query:  ?lat=<coarsened>&lon=<coarsened>&radius_m=5000&type=hospital|pharmacy
// Response 200
{
  discovered: Array<{
    osm_id: string; name: string; facility_type: FacilityType;
    latitude: number; longitude: number;
    phone_numbers: string[];        // often empty — OSM coverage is patchy
    address: string | null;
  }>;
  fetched_at: string;
  attribution: string;              // OSM/ODbL attribution — must be displayed
}
```

- Coordinates arrive already coarsened to ~1km; the server rejects finer precision rather than silently accepting it.
- Server-side cache keyed on the coarsened grid cell, so repeat queries in the same area cost one upstream call.
- Rate limit per user and in aggregate; Overpass is a donated public resource and hammering it is both rude and self-defeating.
- `has_emergency` is **never** inferred from OSM tags. Discovered records carry no emergency flag at all — the field does not exist on the type.
- Attribution must be displayed wherever discovered results appear (ODbL requirement).
- Failure is non-fatal: return an empty list and let the client fall back to tiers 1 and 2 (AC-9.4.9).

### 7.5 Conflict resolution

| Table | Strategy | Rationale |
|---|---|---|
| `clinical_events` | Insert-only, no conflict possible | Append-only by construction |
| `persons`, `allergies`, `conditions`, `medications` | Last-write-wins on `client_updated_at` | Single-user ownership makes concurrent edits rare and low-stakes |
| `consents` | Insert-only, unique on `(owner, type, version)` | Immutable record |
| `user_facilities` | Last-write-wins on `client_updated_at` | Single-user ownership |

---

## 8. Rulepack specification

A signed, versioned JSON document containing all non-red-flag clinical content. Synced to device; never generated at runtime.

```jsonc
{
  "version": "1.0.0",
  "checksum": "sha256:…",
  "locale": "en-NG",
  "reviewStatus": "clinician_reviewed",
  "symptoms": [
    { "code": "SYM_FEVER", "label": "Fever", "bodySystem": "general",
      "questions": [{ "code": "Q_DURATION", "type": "single",
                      "options": ["<1 day", "1–3 days", ">3 days"] }] }
  ],
  "urgencyRules": [
    { "id": "UR_001",
      "when": { "all": ["SYM_FEVER"], "any": ["SYM_DURATION_GT_3D"] },
      "band": "SEE_DOCTOR_TODAY",
      "guidance": "A fever lasting more than three days should be assessed…",
      "source": "…" }
  ],
  "alertCopy": {
    "DUPLICATE_INGREDIENT": {
      "title": "Two medicines contain the same ingredient",
      "body": "{{drugA}} and {{drugB}} both contain {{ingredient}}…"
    }
  },
  "disclaimerVersion": "1.0.0"
}
```

**Hard constraints on rulepack content:**
- No `guidance` or `alertCopy` string may name a specific medication as treatment.
- No string may contain a dose figure.
- No `band` value other than the four in the `urgency_band` enum.
- **A lint step in CI validates all three rules against the JSON and fails the build on violation.**

---

## 9. Application structure

### 9.1 Routes

```
/                       public   landing (APCON-compliant copy)
/privacy  /terms        public   NDPA-required notices
/signup  /login         public   phone OTP
/consent                auth     blocking safety disclaimer
/app                    auth     today view — due doses, quick actions
/app/meds               auth     regimen list
/app/meds/new           auth     add flow, screening gate before save
/app/meds/:id           auth     detail, adherence, edit
/app/check              auth     symptom check (structured picker)
/app/check/result       auth     urgency + guidance (or escalation)
/app/facilities         auth     directory — hospitals, pharmacies, saved
/app/facilities/:id     auth     detail, call, directions hand-off
/app/timeline           auth     event history
/app/profile            auth     person switcher, allergies, conditions
/app/settings           auth     notifications, data export, delete account
```

**Rendering split:** public routes are statically generated for SEO and fast first paint. **Everything under `/app` is a client-rendered island** driven entirely by the local store — no server round-trip on navigation. Do not add server components under `/app`; SSR and offline-first fight each other.

### 9.2 Module layout

```
src/
  app/                    # Next.js routes
  lib/
    db/                   # Dexie schema, migrations, encryption
    sync/                 # outbox, push, pull, backoff, scheduler
    engine/
      screening.ts        # §5.1 — pure, no I/O
      redflags.ts         # §5.4 — compiled in, NOT rulepack-loaded
      rulepack.ts         # load, verify checksum, query
    schemas/              # Zod — single source of truth for all types
  components/ui/          # shadcn
  features/
    meds/ check/ timeline/ profile/ facilities/
tests/
  unit/  safety/  e2e/
supabase/
  migrations/  seed/
content/
  rulepack/               # authored JSON + lint script
```

---

## 10. Deployment

**Platform:** Vercel. **Database:** Supabase (choose the region with lowest Nigerian latency — benchmark `eu-west-1` vs `eu-central-1` before committing).

### 10.1 Environments

| Env | Branch | Supabase project | Purpose |
|---|---|---|---|
| Production | `main` | `sana-prod` | Private beta users |
| Preview | any PR | `sana-staging` | Per-PR preview |
| Local | — | local Supabase via CLI | Development |

### 10.2 Environment variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY        # server-only — never NEXT_PUBLIC_
NEXT_PUBLIC_APP_VERSION
NEXT_PUBLIC_RULEPACK_MIN_VERSION
SENTRY_DSN
```

### 10.3 Pipeline

```
push → typecheck → lint → rulepack-lint → unit → SAFETY SUITE → build → e2e → deploy
                                              ↑
                                    hard gate: any failure blocks deploy
```

Migrations run via `supabase db push` against staging on PR merge, and against production on release tag. **Forward-only migrations — no destructive changes to `clinical_events`, ever.**

### 10.4 PWA

Serwist service worker. App shell, reference data and rulepack precached. Runtime caching: network-first for `/api/sync/*`, cache-first for static assets. `skipWaiting` disabled — prompt the user to reload so a sync in flight is never interrupted.

### 10.5 Beta gating

Public launch is **blocked** until a registered clinician reviews and signs off the rulepack (`review_status = 'clinician_reviewed'`). Until then: invite-only, explicit beta labelling in-app, and a documented feedback path.

---

## 11. Compliance checklist — NDPA 2023

Health data is **sensitive personal data**. Required before beta:

- [ ] Privacy policy published at `/privacy`, covering data collected, purpose, retention, third-party processors (Supabase, Vercel, Sentry, the SMS provider)
- [ ] Location handling disclosed: coordinates coarsened to ~1km and proxied through Sana's own API for facility discovery, never sent to OpenStreetMap directly (§5.5)
- [ ] OpenStreetMap/ODbL attribution displayed wherever discovered facilities appear
- [ ] Explicit, granular, version-tracked consent captured at first run (§4 US-1.2)
- [ ] Data minimisation reviewed — no field collected without a stated purpose
- [ ] Encryption in transit (TLS) and at rest (Supabase default + local field encryption)
- [ ] Data subject rights implemented: **export** (JSON, all tables) and **delete account** (cascade + audit record) in `/app/settings`
- [ ] Audit logging active on all clinical data access
- [ ] Sentry configured with PII scrubbing — **no clinical payloads in error reports**
- [ ] Analytics carries no clinical data; anonymous, aggregate only

Required as you scale:

- [ ] NDPC registration as a Data Controller of Major Importance
- [ ] Annual data protection audit once processing exceeds 2,000 data subjects/year
- [ ] Data Protection Officer designated
- [ ] Public marketing copy reviewed against the APCON prohibition on advertising digital diagnosis or treatment
- [ ] MDCN registration verified for any practitioner — blocks v2 appointments

---

## 12. Test strategy

### 12.1 Suites

| Suite | Tool | Gate |
|---|---|---|
| Unit | Vitest | 80% coverage on `lib/engine` and `lib/sync` |
| **Safety** | Vitest | **100% pass, zero tolerance — blocks deploy** |
| Rulepack lint | Node script | Blocks build |
| E2E | Playwright | Blocks deploy |
| RLS | Vitest + service-role client | Blocks deploy |

### 12.2 The safety suite

Golden cases in `tests/safety/`. Every case is a fixed input with a fixed expected output. **A failure is a release blocker, not a warning.**

Required coverage:

1. **All 15 red-flag rules** (§2.3) — each produces `EMERGENCY` and terminates the flow.
2. **Negative red-flag cases** — symptom sets that must *not* escalate, guarding against over-triage that trains users to dismiss alerts.
3. **Paracetamol stacking** — combination remedy + plain paracetamol → `DUPLICATE_INGREDIENT`, `SERIOUS`, both products named.
4. **Penicillin allergy → amoxicillin** → `ALLERGY_DIRECT`, `CRITICAL`.
5. **Penicillin allergy → cefalexin** → `ALLERGY_CROSS_CLASS`, correctly labelled as cross-reaction.
6. **Every row of §5.3** — condition contraindications.
7. **Prohibition assertions** — for every alert and triage result the engine can emit, assert the rendered string contains no dose pattern (`/\d+\s?(mg|ml|g|mcg|iu)/i`) and no treatment verb pattern (`/\b(take|use|apply|swallow)\b/i`).
8. **Rulepack failure mode** — corrupt checksum → red flags still evaluate, non-emergency guidance suppressed.
9. **Uncheckable medication** — custom drug present → result explicitly states it could not be checked.
10. **Offline parity** — screening output with network disabled is byte-identical to online.
11. **Escalation facility integrity** (§2.3, AC-9.1.2/9.1.3) — a facility shown on the escalation screen always has `has_emergency = true` and a non-null `verified_at`; when no such facility exists for the user's area the block is absent, and the code can never fall back to a pharmacy, clinic, or unverified record.
12. **Tier-3 exclusion** (§5.5, AC-9.4.2/9.4.3) — no discovered OpenStreetMap facility can reach the escalation screen. Prove it twice: a runtime assertion over a dataset where the *nearest* facility is a discovered one tagged as a hospital, and a compile-time assertion that `DiscoveredFacility` is not assignable to the emergency query's parameter type.

### 12.3 E2E scenarios

1. Sign up → consent → add person → add allergy → add medication that triggers an alert → acknowledge → save.
2. **Offline round trip:** go offline → log 5 doses → verify local UI → reconnect → verify sync → verify no duplicates on a second sync.
3. Two-device convergence: edit on device A, verify on device B.
4. Red-flag flow: select chest pain → escalation screen → verify non-dismissible.
5. Data export and account deletion.

---

## 13. Build sequence

Phase 3 delivers each of these as a self-contained prompt with its own verification gate.

| # | Step | Gate |
|---|---|---|
| 1 | Scaffold, tooling, CI skeleton | Typecheck + lint pass on empty app |
| 2 | Supabase schema + RLS + migrations | RLS suite passes; cross-user read returns zero rows |
| 3 | Zod schemas + shared types | Types derive; no hand-written duplicates |
| 4 | Dexie local store + encryption | Round-trip test passes |
| 5 | Auth: phone OTP + consent gate | E2E signup passes; consent redirect enforced |
| 6 | Reference data pipeline + seed | Catalog seeded; offline search under 100ms |
| 7 | **Red-flag engine** | **All 15 safety cases pass** |
| 8 | **Screening engine** | **All screening safety cases pass, incl. prohibition assertions** |
| 9 | Sync: outbox, push, pull, backoff | Idempotency + offline round-trip E2E pass |
| 10 | Medication CRUD + screening gate | AC-3.1.\* pass |
| 11 | Dose logging + local notifications | Offline logging E2E passes |
| 12 | Symptom check UI + result screens | AC-6.1.\* pass |
| 13 | Timeline | AC-7.1.\* pass, 5k-event perf budget met |
| 13a | **Facility directory + escalation integration** | **AC-9.\* pass, incl. escalation facility integrity** |
| 14 | Settings: export, delete account | NDPA rights verified |
| 15 | PWA shell, Serwist, offline polish | Full offline E2E passes |
| 16 | Deploy, canary, beta gating | Production health check green |

---

## 14. Open items

| Item | Owner | Blocks |
|---|---|---|
| Clinician review of rulepack | Eniola to source | Public launch (not beta) |
| **Facility dataset for the launch state(s)** — every `has_emergency` record confirmed by phone, with `verified_at` and `verified_by` recorded | Eniola | Build step 13a; escalation screen is incomplete without it |
| Launch state(s) decision — which states ship with facility data | Eniola | Facility data gathering scope |
| NAFDAC greenbook extraction into catalog | Build step 6 | Screening accuracy |
| Supabase region latency benchmark | Build step 1 | Deployment config |
| Emergency number handling — 112/767 vary by state | Build step 7 | Red-flag screen copy |
| Decision: encrypt full local DB vs. sensitive fields only | Build step 4 | Local store design |

---

*End of PRD v1.0. Phase 3 — the sequential prompt pack — builds from §13.*
