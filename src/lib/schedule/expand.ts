import type { MedicationSchedule } from '../schemas';

/**
 * Expand a medication schedule into due-dose instances (AC-3.2.1).
 *
 * Pure, synchronous, deterministic and offline. This is the engine behind the
 * Tier 2 reminder path — the one that always works — so it must never need a
 * network, a permission, or a running service worker.
 *
 * TIMEZONE. Fixed times are WALL-CLOCK local, not instants. Someone taking a
 * tablet at 08:00 means 08:00 where they are; storing a UTC instant would shift
 * their morning dose if they travelled or if the offset changed. The zone is
 * read from the device rather than hardcoded — Africa/Lagos happens to be
 * DST-free, but a hardcoded zone would silently break for anyone outside it.
 */

export type DueDose = {
  medicationId: string;
  /** The instant this dose is due, as an ISO string. */
  dueAt: string;
  /** Wall-clock time of day it was scheduled for, e.g. "08:00". */
  scheduledTime: string;
};

export type ExpandOptions = {
  medicationId: string;
  schedule: MedicationSchedule;
  /** Inclusive start of the window. */
  from: Date;
  /** Exclusive end of the window. */
  to: Date;
  /** IANA zone. Defaults to the device's own. */
  timeZone?: string;
  /** Medication start date, YYYY-MM-DD. No dose is due before it. */
  startDate?: string;
  /** Medication end date, YYYY-MM-DD, inclusive. */
  endDate?: string | null;
};

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The UTC offset of a zone at a given instant, in minutes.
 *
 * Computed by formatting the instant in the target zone and comparing, because
 * there is no direct API for it. Doing it per-instant rather than once means a
 * DST transition inside the window is handled correctly for zones that have one.
 */
function offsetMinutes(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') === 24 ? 0 : get('hour'),
    get('minute'),
    get('second'),
  );
  return (asUtc - instant.getTime()) / 60000;
}

/** The instant corresponding to a wall-clock date and time in a zone. */
function zonedInstant(dateIso: string, time: string, timeZone: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const [year, month, day] = dateIso.split('-').map(Number);

  // First guess treats the wall clock as UTC, then corrects by the zone's
  // offset at that approximate instant. One correction pass is enough for every
  // real zone; the offset does not change within the correction window.
  const guess = new Date(
    Date.UTC(
      year as number,
      (month as number) - 1,
      day as number,
      hours ?? 0,
      minutes ?? 0,
    ),
  );
  const offset = offsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60000);
}

/** Wall-clock calendar date in a zone, as YYYY-MM-DD. */
function zonedDateIso(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return parts;
}

function addDays(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  const next = new Date(
    Date.UTC(year as number, (month as number) - 1, (day as number) + days),
  );
  return next.toISOString().slice(0, 10);
}

/**
 * Expand one medication's schedule over a window.
 *
 * AS-NEEDED PRODUCES NOTHING. It is not a schedule, it is the absence of one,
 * and generating instances for it would put doses on the today view that the
 * person was never meant to take at a particular time — training them to
 * dismiss the list.
 */
export function expandSchedule(options: ExpandOptions): DueDose[] {
  const timeZone = options.timeZone ?? deviceTimeZone();
  const { schedule, medicationId, from, to } = options;

  if (schedule.kind === 'as_needed') return [];

  const instances: DueDose[] = [];

  // Walk one day either side so an instance whose wall-clock day differs from
  // its UTC day is not missed at the window edges.
  const firstDay = addDays(zonedDateIso(from, timeZone), -1);
  const lastDay = addDays(zonedDateIso(to, timeZone), 1);

  if (schedule.kind === 'fixed_times') {
    for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
      if (options.startDate && day < options.startDate) continue;
      if (options.endDate && day > options.endDate) continue;

      for (const time of schedule.times) {
        const dueAt = zonedInstant(day, time, timeZone);
        if (dueAt >= from && dueAt < to) {
          instances.push({
            medicationId,
            dueAt: dueAt.toISOString(),
            scheduledTime: time,
          });
        }
      }
    }
  }

  if (schedule.kind === 'interval_hours') {
    // Anchored to a wall-clock time when one is given, otherwise to midnight, so
    // "every 6 hours" lands at predictable times rather than drifting from
    // whenever the medication happened to be created.
    const anchorTime = schedule.anchor_time ?? '00:00';
    const intervalMs = schedule.every_hours * 60 * 60 * 1000;

    let cursor = zonedInstant(firstDay, anchorTime, timeZone);
    while (cursor < to) {
      if (cursor >= from) {
        const day = zonedDateIso(cursor, timeZone);
        const withinStart = !options.startDate || day >= options.startDate;
        const withinEnd = !options.endDate || day <= options.endDate;
        if (withinStart && withinEnd) {
          instances.push({
            medicationId,
            dueAt: cursor.toISOString(),
            scheduledTime: new Intl.DateTimeFormat('en-GB', {
              timeZone,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).format(cursor),
          });
        }
      }
      cursor = new Date(cursor.getTime() + intervalMs);
    }
  }

  // Sorted so the today view and any test see the same order every time.
  return instances.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/** Expand several medications at once, merged and sorted. */
export function expandAll(
  medications: {
    id: string;
    schedule: MedicationSchedule;
    start_date: string;
    end_date: string | null;
  }[],
  window: { from: Date; to: Date; timeZone?: string },
): DueDose[] {
  return medications
    .flatMap((medication) =>
      expandSchedule({
        medicationId: medication.id,
        schedule: medication.schedule,
        from: window.from,
        to: window.to,
        ...(window.timeZone === undefined ? {} : { timeZone: window.timeZone }),
        startDate: medication.start_date,
        endDate: medication.end_date,
      }),
    )
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/**
 * Split due doses into overdue and upcoming relative to now.
 *
 * A dose is overdue rather than merely due once its time has passed, and the
 * today view distinguishes them: an overdue dose is the one a person actually
 * needs prompting about.
 */
export function partitionDue(
  doses: DueDose[],
  now: Date,
  loggedDueTimes: Set<string> = new Set(),
): { overdue: DueDose[]; upcoming: DueDose[] } {
  const overdue: DueDose[] = [];
  const upcoming: DueDose[] = [];

  for (const dose of doses) {
    if (loggedDueTimes.has(`${dose.medicationId}:${dose.dueAt}`)) continue;
    if (new Date(dose.dueAt) <= now) overdue.push(dose);
    else upcoming.push(dose);
  }

  return { overdue, upcoming };
}
