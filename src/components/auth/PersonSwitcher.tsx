'use client';

import {
  getActivePersonId,
  resolveActivePersonId,
  setActivePersonId,
} from '@/lib/person/active-person';
import { useEffect, useState } from 'react';

/**
 * Person switcher (US-1.3).
 *
 * The selection persists in IndexedDB rather than component state so it survives
 * a reload (AC-1.3.1) — and so every clinical screen reads the same active
 * person (AC-1.3.3). A switcher whose choice lived only in React would reset on
 * navigation and could leave one screen showing a different family member's
 * record than the next.
 */

type PersonSummary = { id: string; display_name: string; relationship: string };

export function PersonSwitcher({ persons }: { persons: PersonSummary[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fallback =
        persons.find((person) => person.relationship === 'self') ?? persons[0];
      const resolved = fallback
        ? await resolveActivePersonId(fallback.id)
        : await getActivePersonId();
      if (!cancelled) setActiveId(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [persons]);

  async function switchTo(personId: string) {
    await setActivePersonId(personId);
    setActiveId(personId);
  }

  if (persons.length === 0) return <p>No profiles yet.</p>;

  return (
    <section aria-label="Person switcher">
      <h2>Whose record</h2>
      <ul>
        {persons.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              onClick={() => switchTo(person.id)}
              aria-pressed={activeId === person.id}
              data-testid={`person-${person.id}`}
            >
              {person.display_name}
              {person.relationship === 'self' ? ' (you)' : ''}
              {activeId === person.id ? ' — active' : ''}
            </button>
          </li>
        ))}
      </ul>
      <p data-testid="active-person-id">{activeId ?? ''}</p>
    </section>
  );
}
