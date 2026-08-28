import { describe, expect, it } from 'vitest';
import {
  expandAll,
  expandSchedule,
  partitionDue,
} from '../../src/lib/schedule/expand';
import { MedicationScheduleSchema } from '../../src/lib/schemas';

/**
 * Schedule expansion (AC-3.2.1).
 *
 * A fixed zone is passed explicitly rather than relying on the machine's, so the
 * assertions mean the same thing on a CI runner in UTC as on a laptop in Lagos.
 * The production default reads the device zone; hardcoding one would break for
 * anyone outside it.
 */

const LAGOS = 'Africa/Lagos'; // UTC+1, no DST
const NEW_YORK = 'America/New_York'; // has DST, so it exercises the offset path

const MED = 'med-1';

function window(fromIso: string, toIso: string) {
  return { from: new Date(fromIso), to: new Date(toIso) };
}

// ═══════════════ (a) round-trip ═══════════════

describe('(a) all three schedule kinds round-trip losslessly (AC-3.2.1)', () => {
  const schedules = [
    { kind: 'fixed_times', times: ['08:00', '20:00'], timezone: LAGOS },
    { kind: 'interval_hours', every_hours: 6, anchor_time: '07:30' },
    { kind: 'as_needed', max_per_day: 4, note: 'for pain' },
  ];

  it.each(schedules)('$kind survives a parse and re-serialise', (schedule) => {
    const parsed = MedicationScheduleSchema.parse(schedule);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(schedule);
  });
});

// ═══════════════ (b) twice daily ═══════════════

describe('(b) twice daily at 08:00 and 20:00', () => {
  const schedule = MedicationScheduleSchema.parse({
    kind: 'fixed_times',
    times: ['08:00', '20:00'],
  });

  it('expands to exactly 2 instances per day', () => {
    const doses = expandSchedule({
      medicationId: MED,
      schedule,
      ...window('2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z'),
      timeZone: LAGOS,
    });
    expect(doses).toHaveLength(2);
    expect(doses.map((d) => d.scheduledTime)).toEqual(['08:00', '20:00']);
  });

  it('expands to 14 instances over a week', () => {
    const doses = expandSchedule({
      medicationId: MED,
      schedule,
      ...window('2026-06-01T00:00:00.000Z', '2026-06-08T00:00:00.000Z'),
      timeZone: LAGOS,
    });
    expect(doses).toHaveLength(14);
  });

  it('places 08:00 Lagos at 07:00 UTC', () => {
    // Lagos is UTC+1, so the wall clock and the instant differ — which is the
    // whole reason fixed times are stored as wall clock rather than instants.
    const [first] = expandSchedule({
      medicationId: MED,
      schedule,
      ...window('2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z'),
      timeZone: LAGOS,
    });
    expect(first?.dueAt).toBe('2026-06-01T07:00:00.000Z');
  });

  it('respects the start and end dates', () => {
    const doses = expandSchedule({
      medicationId: MED,
      schedule,
      ...window('2026-06-01T00:00:00.000Z', '2026-06-08T00:00:00.000Z'),
      timeZone: LAGOS,
      startDate: '2026-06-03',
      endDate: '2026-06-04',
    });
    expect(doses).toHaveLength(4);
  });
});

// ═══════════════ (c) interval across a day boundary ═══════════════

describe('(c) interval schedules cross a day boundary correctly', () => {
  const schedule = MedicationScheduleSchema.parse({
    kind: 'interval_hours',
    every_hours: 6,
    anchor_time: '00:00',
  });

  it('every 6 hours gives 4 instances per day', () => {
    const doses = expandSchedule({
      medicationId: MED,
      schedule,
      ...window('2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z'),
      timeZone: 'UTC',
    });
    expect(doses).toHaveLength(4);
    expect(doses.map((d) => d.scheduledTime)).toEqual([
      '00:00',
      '06:00',
      '12:00',
      '18:00',
    ]);
  });

  it('continues across midnight without gaps or duplicates', () => {
    const doses = expandSchedule({
      medicationId: MED,
      schedule,
      ...window('2026-06-01T18:00:00.000Z', '2026-06-02T12:00:00.000Z'),
      timeZone: 'UTC',
    });
    // 18:00, 00:00, 06:00 — the boundary is not a special case.
    expect(doses.map((d) => d.dueAt)).toEqual([
      '2026-06-01T18:00:00.000Z',
      '2026-06-02T00:00:00.000Z',
      '2026-06-02T06:00:00.000Z',
    ]);
  });

  it('anchors to the given time rather than drifting', () => {
    const anchored = MedicationScheduleSchema.parse({
      kind: 'interval_hours',
      every_hours: 8,
      anchor_time: '07:30',
    });
    const doses = expandSchedule({
      medicationId: MED,
      schedule: anchored,
      ...window('2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z'),
      timeZone: 'UTC',
    });
    expect(doses.map((d) => d.scheduledTime)).toEqual([
      '07:30',
      '15:30',
      '23:30',
    ]);
  });
});

// ═══════════════ (d) as-needed ═══════════════

describe('(d) as-needed produces zero scheduled instances', () => {
  it('generates nothing', () => {
    const schedule = MedicationScheduleSchema.parse({ kind: 'as_needed' });
    expect(
      expandSchedule({
        medicationId: MED,
        schedule,
        ...window('2026-06-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z'),
        timeZone: LAGOS,
      }),
    ).toEqual([]);
  });

  it('is not a schedule, so it never reaches the due list', () => {
    // Surfacing as-needed doses at invented times would train the user to
    // dismiss the list, which disarms the reminders that do matter.
    const merged = expandAll(
      [
        {
          id: 'med-prn',
          schedule: MedicationScheduleSchema.parse({
            kind: 'as_needed',
            max_per_day: 4,
          }),
          start_date: '2026-01-01',
          end_date: null,
        },
      ],
      window('2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z'),
    );
    expect(merged).toEqual([]);
  });
});

// ═══════════════ (e) determinism and timezone awareness ═══════════════

describe('(e) expansion is deterministic and timezone-aware', () => {
  const schedule = MedicationScheduleSchema.parse({
    kind: 'fixed_times',
    times: ['08:00', '20:00'],
  });

  it('100 expansions of the same input are identical', () => {
    const run = () =>
      JSON.stringify(
        expandSchedule({
          medicationId: MED,
          schedule,
          ...window('2026-06-01T00:00:00.000Z', '2026-06-05T00:00:00.000Z'),
          timeZone: LAGOS,
        }),
      );
    const first = run();
    for (let i = 0; i < 100; i += 1) expect(run()).toBe(first);
  });

  it('the same wall-clock time yields different instants in different zones', () => {
    const lagos = expandSchedule({
      medicationId: MED,
      schedule,
      ...window('2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z'),
      timeZone: LAGOS,
    });
    const utc = expandSchedule({
      medicationId: MED,
      schedule,
      ...window('2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z'),
      timeZone: 'UTC',
    });
    expect(lagos[0]?.dueAt).not.toBe(utc[0]?.dueAt);
    // But the wall clock the user set is preserved in both.
    expect(lagos[0]?.scheduledTime).toBe(utc[0]?.scheduledTime);
  });

  it('handles a zone WITH daylight saving, so the zone is not assumed DST-free', () => {
    // Africa/Lagos happens to have no DST. Hardcoding that assumption would
    // break silently for anyone elsewhere, so a DST zone is exercised too.
    const doses = expandSchedule({
      medicationId: MED,
      schedule: MedicationScheduleSchema.parse({
        kind: 'fixed_times',
        times: ['08:00'],
      }),
      ...window('2026-03-07T00:00:00.000Z', '2026-03-10T00:00:00.000Z'),
      timeZone: NEW_YORK,
    });
    // One 08:00 local dose per day regardless of the transition on 8 March.
    expect(doses).toHaveLength(3);
    expect(new Set(doses.map((d) => d.scheduledTime))).toEqual(
      new Set(['08:00']),
    );
  });

  it('output is sorted chronologically', () => {
    const doses = expandAll(
      [
        {
          id: 'med-a',
          schedule: MedicationScheduleSchema.parse({
            kind: 'fixed_times',
            times: ['20:00'],
          }),
          start_date: '2026-01-01',
          end_date: null,
        },
        {
          id: 'med-b',
          schedule: MedicationScheduleSchema.parse({
            kind: 'fixed_times',
            times: ['08:00'],
          }),
          start_date: '2026-01-01',
          end_date: null,
        },
      ],
      {
        ...window('2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z'),
        timeZone: LAGOS,
      },
    );
    expect(doses.map((d) => d.medicationId)).toEqual(['med-b', 'med-a']);
  });
});

// ═══════════════ overdue partitioning ═══════════════

describe('overdue and upcoming are distinguished', () => {
  const doses = expandSchedule({
    medicationId: MED,
    schedule: MedicationScheduleSchema.parse({
      kind: 'fixed_times',
      times: ['08:00', '20:00'],
    }),
    ...window('2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z'),
    timeZone: LAGOS,
  });

  it('splits on the current instant', () => {
    // Midday Lagos: the 08:00 dose has passed, the 20:00 one has not.
    const { overdue, upcoming } = partitionDue(
      doses,
      new Date('2026-06-01T11:00:00.000Z'),
    );
    expect(overdue).toHaveLength(1);
    expect(upcoming).toHaveLength(1);
    expect(overdue[0]?.scheduledTime).toBe('08:00');
  });

  it('excludes a slot already logged, so the list shrinks as the day goes on', () => {
    const logged = new Set([`${MED}:2026-06-01T07:00:00.000Z`]);
    const { overdue } = partitionDue(
      doses,
      new Date('2026-06-01T11:00:00.000Z'),
      logged,
    );
    expect(overdue).toHaveLength(0);
  });
});
