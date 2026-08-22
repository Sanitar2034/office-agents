/* global PowerPoint */

/**
 * Undo journal for slide edits: before a slide is replaced via
 * insertSlidesFromBase64+delete, its ORIGINAL exported base64 is recorded.
 * Undo replays the same replacement with the snapshot.
 */

export interface SlideSnapshot {
  slideIndex: number;
  originalBase64: string;
}

const MAX_SNAPSHOTS = 20;

export interface SlideJournal {
  pop(): SlideSnapshot | null;
  push(snap: SlideSnapshot): void;
  size(): number;
  clear(): void;
}

export function createSlideJournal(): SlideJournal {
  const snaps: SlideSnapshot[] = [];
  return {
    pop: () => snaps.pop() ?? null,
    push: (snap) => {
      snaps.push(snap);
      if (snaps.length > MAX_SNAPSHOTS) snaps.shift();
    },
    size: () => snaps.length,
    clear: () => {
      snaps.length = 0;
    },
  };
}

// module-level journal: one per taskpane session (same pattern as excel)
const journal = createSlideJournal();

export function recordSlideSnapshot(
  j: SlideJournal,
  slideIndex: number,
  originalBase64: string,
) {
  j.push({ slideIndex, originalBase64 });
}

/** Replace an edited slide with its recorded snapshot (same replace path). */
async function restoreSnapshot(j: SlideJournal, snap: SlideSnapshot) {
  await PowerPoint.run(async (context) => {
    const slides = context.presentation.slides;
    slides.load("items/id");
    await context.sync();

    if (snap.slideIndex >= slides.items.length) {
      throw new Error(
        `Cannot undo slide ${snap.slideIndex}: only ${slides.items.length} slides remain`,
      );
    }
    const targetSlideId =
      snap.slideIndex > 0 ? slides.items[snap.slideIndex - 1].id : undefined;

    context.presentation.insertSlidesFromBase64(snap.originalBase64, {
      targetSlideId,
    });
    slides.items[snap.slideIndex].delete();
    await context.sync();
  });
}

/** Undo every recorded slide edit, newest first. */
export async function undoAllSlideEdits(j: SlideJournal): Promise<{
  restored: number;
}> {
  let restored = 0;
  while (j.size() > 0) {
    const snap = j.pop()!;
    await restoreSnapshot(j, snap);
    restored += 1;
  }
  return { restored };
}

export function getSessionSlideJournal(): SlideJournal {
  return journal;
}
