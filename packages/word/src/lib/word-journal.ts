/* global Word */

/**
 * Undo journal for Word edits: before the agent's code mutates the
 * document, the whole body OOXML is captured. Rollback replaces the body
 * with the OLDEST snapshot - the state before the agent's first edit.
 */

const MAX_SNAPSHOTS = 10;

export interface WordJournal {
  pop(): string | null;
  push(xml: string): void;
  size(): number;
  clear(): number;
}

export function createWordJournal(): WordJournal {
  const snaps: string[] = [];
  return {
    pop: () => snaps.pop() ?? null,
    push: (xml) => {
      snaps.push(xml);
      if (snaps.length > MAX_SNAPSHOTS) snaps.shift();
    },
    size: () => snaps.length,
    clear: () => snaps.splice(0, snaps.length).length,
  };
}

const journal = createWordJournal();

export function recordBodySnapshot(j: WordJournal, bodyOoxml: string) {
  j.push(bodyOoxml);
}

/**
 * Full rollback: replace the body with the oldest recorded snapshot and
 * drop the journal.
 */
export async function restoreAllBodySnapshots(
  j: WordJournal,
): Promise<{ restored: boolean }> {
  if (j.size() === 0) return { restored: false };

  // oldest snapshot = state before the agent's first edit in this session
  const all: string[] = [];
  while (j.size() > 0) all.push(j.pop()!);
  const oldest = all[all.length - 1];

  await Word.run(async (context) => {
    // InsertLocation.replace is the string enum value "Replace"
    context.document.body.insertOoxml(oldest, "Replace" as never);
    await context.sync();
  });
  return { restored: true };
}

export function getSessionWordJournal(): WordJournal {
  return journal;
}
