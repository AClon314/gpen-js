/**
 * Command / edit history with a **state budget** instead of a fixed array
 * length.
 *
 * Why not a plain array with `shift()`:
 *
 * - `shift()` on every commit is O(n) on the whole array (V8 does not turn
 *   `Array.prototype.shift` into a ring buffer for large arrays), and it
 *   evicts by *count*: 50 snapshots of a small document and 50 snapshots of a
 *   huge document cost the same, and the oldest history is dropped one entry
 *   at a time;
 * - snapshots of our immutable document are just references, so the real
 *   pressure is the number of *distinct* documents alive — exactly what an
 *   entry budget bounds;
 * - users care about "how far back can I go", which is a budget question, not
 *   an array-length question.
 *
 * The design here:
 *
 * - `undoStack` is a **ring buffer** (`{items, head, length}`): commit is O(1)
 *   amortized, `undo()`/`redo()` pop from the end, and the oldest entry is
 *   dropped by advancing `head` — no element shifting ever happens;
 * - `limit` is the ring capacity, `maxEntries` is an additional hard cap
 *   (whichever is tighter wins) so a burst of tiny edits cannot grow memory
 *   without bound;
 * - entries can be *coalesced*: committing with `coalesceWith` replaces the
 *   previous entry instead of pushing a new one (stroke sampling does not need
 *   this today, but continuous drags will);
 * - `onEvict` reports dropped entries so a caller with heavier payloads can
 *   release whatever they keep outside the history (e.g. an image cache).
 *
 * `redoStack` is intentionally a plain array: it is bounded by the same budget
 * and is cleared on every new commit, so it never accumulates.
 */

export interface EditHistoryOptions<T> {
  /** Maximum number of undoable states kept (ring capacity). Default 50. */
  limit?: number;
  /** Hard cap on retained states regardless of `limit`. Default = `limit`. */
  maxEntries?: number;
  /** Called with every state dropped by the budget (oldest first). */
  onEvict?: (state: T) => void;
}

export interface CommitOptions<T> {
  /**
   * Merge into the newest undo entry instead of pushing a new one.
   *
   * Used for continuous gestures: the caller decides when two consecutive
   * edits are "the same action". The newest entry is *replaced* by
   * `coalesceWith(state)`, and the redo stack is cleared as usual.
   */
  coalesceWith?: (newest: T) => T;
}

export interface EditHistory<T> {
  /** Record `state` as an undoable step (clears the redo stack). */
  commit(state: T, options?: CommitOptions<T>): void;

  /** Move one step back. Returns the state to restore, or undefined at the end. */
  undo(current: T): T | undefined;

  /** Move one step forward. Returns the state to restore, or undefined. */
  redo(current: T): T | undefined;

  canUndo(): boolean;
  canRedo(): boolean;
  /** Number of undoable states (not counting the current one). */
  undoDepth(): number;
  redoDepth(): number;
  /** Drop every entry (keeps the budget and the eviction callback). */
  clear(): void;
}

type Ring<T> = {
  items: Array<T | undefined>;
  /** Index of the oldest entry. */
  head: number;
  length: number;
};

function createRing<T>(capacity: number): Ring<T> {
  // `Array.from` (not `new Array(n)`) so the intent is unambiguous and the
  // ring is pre-sized with `undefined` slots.
  return { items: Array.from<T | undefined>({ length: capacity }), head: 0, length: 0 };
}

function ringPush<T>(ring: Ring<T>, value: T): T | undefined {
  const capacity = ring.items.length;
  if (capacity === 0) return value;
  if (ring.length < capacity) {
    ring.items[(ring.head + ring.length) % capacity] = value;
    ring.length += 1;
    return undefined;
  }
  // Full: overwrite the oldest entry and advance the head.
  const evicted = ring.items[ring.head];
  ring.items[ring.head] = value;
  ring.head = (ring.head + 1) % capacity;
  return evicted;
}

function ringPop<T>(ring: Ring<T>): T | undefined {
  if (ring.length === 0) return undefined;
  const index = (ring.head + ring.length - 1) % ring.items.length;
  const value = ring.items[index];
  ring.items[index] = undefined;
  ring.length -= 1;
  return value;
}

function ringLast<T>(ring: Ring<T>): T | undefined {
  if (ring.length === 0) return undefined;
  return ring.items[(ring.head + ring.length - 1) % ring.items.length];
}

function ringReplaceLast<T>(ring: Ring<T>, value: T): void {
  if (ring.length === 0) return;
  ring.items[(ring.head + ring.length - 1) % ring.items.length] = value;
}

function ringToArray<T>(ring: Ring<T>): T[] {
  const result: T[] = [];
  for (let offset = 0; offset < ring.length; offset += 1) {
    const value = ring.items[(ring.head + offset) % ring.items.length];
    if (value !== undefined) result.push(value);
  }
  return result;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

export function createEditHistory<T>(options: EditHistoryOptions<T> = {}): EditHistory<T> {
  const limit = normalizeLimit(options.limit, 50);
  const capacity = Math.min(limit, normalizeLimit(options.maxEntries, limit));
  const onEvict = options.onEvict;

  let undoRing = createRing<T>(capacity);
  let redoStack: T[] = [];

  function evict(state: T | undefined): void {
    if (state !== undefined) onEvict?.(state);
  }

  return {
    commit(state, commitOptions) {
      // A new action invalidates the redo branch, but its states must still be
      // reported to the eviction callback (a caller may cache them).
      for (const dropped of redoStack) evict(dropped);
      redoStack = [];

      const newest = ringLast(undoRing);
      if (commitOptions?.coalesceWith && newest !== undefined) {
        ringReplaceLast(undoRing, commitOptions.coalesceWith(newest));
        return;
      }
      evict(ringPush(undoRing, state));
    },

    undo(current) {
      const previous = ringPop(undoRing);
      if (previous === undefined) return undefined;
      redoStack.push(current);
      return previous;
    },

    redo(current) {
      const next = redoStack.pop();
      if (next === undefined) return undefined;
      evict(ringPush(undoRing, current));
      return next;
    },

    canUndo: () => undoRing.length > 0,
    canRedo: () => redoStack.length > 0,
    undoDepth: () => undoRing.length,
    redoDepth: () => redoStack.length,

    clear() {
      for (const state of ringToArray(undoRing)) evict(state);
      for (const state of redoStack) evict(state);
      undoRing = createRing<T>(capacity);
      redoStack = [];
    },
  };
}
