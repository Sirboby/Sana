import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Fail the build while any emergency number is unverified (PRD §2.3, §14).
 *
 * This is a build gate rather than a runtime check on purpose. A runtime check
 * would surface the problem to a user in an emergency, which is far too late; a
 * build gate surfaces it to whoever is shipping, which is the only useful time.
 *
 * The placeholder is a poison value, not an empty string, so that a partially
 * filled file cannot pass by looking plausible.
 */

const PLACEHOLDER = 'REQUIRES_HUMAN_VERIFICATION';
const CONFIG = path.resolve(
  import.meta.dirname,
  '..',
  'content',
  'emergency-numbers.json',
);

type EmergencyEntry = {
  primary?: string;
  label?: string;
  verifiedBy?: string;
  verifiedAt?: string;
};

type EmergencyConfig = {
  national?: EmergencyEntry & { countryCode?: string };
  stateOverrides?: Record<string, EmergencyEntry>;
};

function problemsFor(
  scope: string,
  entry: EmergencyEntry | undefined,
): string[] {
  if (!entry) return [`${scope}: missing entirely`];

  const problems: string[] = [];
  for (const field of [
    'primary',
    'label',
    'verifiedBy',
    'verifiedAt',
  ] as const) {
    const value = entry[field];
    if (!value || value.trim() === '') {
      problems.push(`${scope}.${field} is empty`);
    } else if (value === PLACEHOLDER) {
      problems.push(`${scope}.${field} is still ${PLACEHOLDER}`);
    }
  }

  // A "number" that contains no digits would render a dead tel: link.
  if (
    entry.primary &&
    entry.primary !== PLACEHOLDER &&
    !/\d/.test(entry.primary)
  ) {
    problems.push(`${scope}.primary contains no digits`);
  }

  return problems;
}

function main(): void {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8')) as EmergencyConfig;

  const problems = [
    ...problemsFor('national', config.national),
    ...Object.entries(config.stateOverrides ?? {}).flatMap(([state, entry]) =>
      problemsFor(`stateOverrides.${state}`, entry),
    ),
  ];

  if (problems.length === 0) {
    console.log('Emergency numbers: all entries verified.');
    return;
  }

  console.error('\nEMERGENCY NUMBERS ARE NOT VERIFIED. Build blocked.\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    [
      '',
      'This is expected until a human populates content/emergency-numbers.json.',
      '',
      'The number here becomes the primary action on a screen shown to someone',
      'who may be having a heart attack. It must be confirmed by a person who has',
      'dialled it, per state, with the verifier and date recorded. PRD §14 lists',
      'this as an open item for exactly this reason.',
      '',
      'Do not work around this check.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

main();
