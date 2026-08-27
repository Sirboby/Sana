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

> ⚠️ **CRITICAL SAFETY NOTE**: `bun run test:safety` is a **non-negotiable release gate**. Any failure in `test:safety` immediately blocks CI/CD and halts deployment. Safety tests must NEVER be disabled or made optional.
