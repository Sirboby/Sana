import { z } from 'zod';

/**
 * The `medications.schedule` JSONB shape (AC-3.2.1).
 *
 * Discriminated on `kind`, so a schedule cannot be half fixed-times and half
 * interval. Every variant must round-trip losslessly: what is parsed out is
 * byte-identical to what went in, because this value is written to Dexie,
 * pushed through sync, and read back by the reminder scheduler in step 11. A
 * schema that quietly supplies defaults would make those three copies diverge.
 *
 * That is why no field here carries `.default()`.
 */

/** Wall-clock time of day, `HH:MM` on a 24-hour clock. */
export const TimeOfDaySchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d$/,
    'Expected a time of day as HH:MM, e.g. 08:00',
  );
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;

/**
 * Specific times each day — "8am and 8pm".
 *
 * Times are wall-clock local, deliberately not instants: a person taking a
 * tablet at 08:00 means 08:00 where they are, and storing a UTC instant would
 * shift their morning dose if they travelled.
 */
export const FixedTimesScheduleSchema = z.object({
  kind: z.literal('fixed_times'),
  times: z
    .array(TimeOfDaySchema)
    .min(1, 'A fixed-times schedule needs at least one time'),
  /** IANA zone the times are interpreted in, e.g. 'Africa/Lagos'. */
  timezone: z.string().optional(),
});

/** Every N hours — "one every 6 hours". */
export const IntervalScheduleSchema = z.object({
  kind: z.literal('interval_hours'),
  every_hours: z
    .number()
    .int()
    .positive()
    .max(
      24 * 7,
      'An interval longer than a week should be modelled as fixed times',
    ),
  /** When the interval is measured from, if the user pinned it. */
  anchor_time: TimeOfDaySchema.optional(),
});

/**
 * As needed — "when the pain is bad".
 *
 * `max_per_day` is a ceiling the USER recorded, never one Sana suggests. §2.2
 * prohibits the app proposing doses, and this field is a record of what someone
 * was told elsewhere.
 */
export const AsNeededScheduleSchema = z.object({
  kind: z.literal('as_needed'),
  max_per_day: z.number().int().positive().optional(),
  note: z.string().optional(),
});

export const MedicationScheduleSchema = z.discriminatedUnion('kind', [
  FixedTimesScheduleSchema,
  IntervalScheduleSchema,
  AsNeededScheduleSchema,
]);
export type MedicationSchedule = z.infer<typeof MedicationScheduleSchema>;

export type FixedTimesSchedule = z.infer<typeof FixedTimesScheduleSchema>;
export type IntervalSchedule = z.infer<typeof IntervalScheduleSchema>;
export type AsNeededSchedule = z.infer<typeof AsNeededScheduleSchema>;

/** The discriminant values, for exhaustive handling at call sites. */
export const MEDICATION_SCHEDULE_KINDS = [
  'fixed_times',
  'interval_hours',
  'as_needed',
] as const;
export type MedicationScheduleKind = (typeof MEDICATION_SCHEDULE_KINDS)[number];

/**
 * An active ingredient entry in `drug_catalog.active_ingredients`.
 *
 * `strength` and `unit` are catalog facts, not dosing advice. The duplicate
 * ingredient check in §5.1 stage 4 — the paracetamol-stacking case — matches on
 * `code`, which is why it is required.
 */
export const ActiveIngredientSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  strength: z.string().optional(),
  unit: z.string().optional(),
});
export type ActiveIngredient = z.infer<typeof ActiveIngredientSchema>;
