/**
 * Barrel export for the Zod schema layer.
 *
 * PRD §0: Zod schemas are the single definition of every boundary type. Types
 * are derived with `z.infer` — a hand-written `interface` or `type` duplicating
 * a schema's shape is a defect, and `tests/unit/schemas.test.ts` asserts that
 * no file in this directory declares one.
 */

export * from './enums';
export * from './events';
export * from './facilities';
export * from './identity';
export * from './ids';
export * from './medication';
export * from './parse';
export * from './primitives';
export * from './rulepack';
export * from './screening';
export * from './sync';
export * from './tables';
