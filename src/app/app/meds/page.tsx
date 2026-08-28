'use client';

import { listActive, listInactive } from '@/lib/meds/service';
import { getActivePersonId } from '@/lib/person/active-person';
import type { Medication } from '@/lib/schemas';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * The active regimen (AC-3.1.4).
 *
 * Active EXCLUDES end-dated and tombstoned medicines. A course that finished
 * last week is not something the person is taking, and listing it here would
 * make the screening picture look wrong to the user reading it.
 *
 * Inactive medicines are still shown, in a separate section, because they
 * happened and the record should say so.
 */
export default function MedsPage() {
  const [active, setActive] = useState<Medication[] | null>(null);
  const [inactive, setInactive] = useState<Medication[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const personId = await getActivePersonId();
      if (personId === null) {
        if (!cancelled) setActive([]);
        return;
      }
      const [a, i] = await Promise.all([
        listActive(personId),
        listInactive(personId),
      ]);
      if (!cancelled) {
        setActive(a);
        setInactive(i);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (active === null) return <main>Loading…</main>;

  return (
    <main>
      <h1>Your medicines</h1>
      <Link href="/app/meds/new" data-testid="add-medication">
        Add a medicine
      </Link>

      <section aria-label="Active medicines">
        <h2>Currently taking</h2>
        {active.length === 0 ? (
          <p data-testid="no-active">
            You have not recorded any medicines yet.
          </p>
        ) : (
          <ul data-testid="active-list">
            {active.map((medication) => (
              <li key={medication.id} data-testid={`med-${medication.id}`}>
                <Link href={`/app/meds/${medication.id}`}>
                  {medication.display_name}
                </Link>
                {medication.is_custom && (
                  <span data-testid="custom-badge">
                    {' '}
                    · added manually, not checkable
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {inactive.length > 0 && (
        <section aria-label="Past medicines">
          <h2>No longer taking</h2>
          <ul data-testid="inactive-list">
            {inactive.map((medication) => (
              <li key={medication.id}>
                <Link href={`/app/meds/${medication.id}`}>
                  {medication.display_name}
                </Link>{' '}
                · ended {medication.end_date}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
