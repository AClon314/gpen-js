/**
 * Unique id for one mounted gpen instance.
 *
 * Written to `data-instance` on the overlay root so the *current running*
 * instance can be found/targeted (and duplicate mounts detected) at runtime.
 *
 * This is deliberately not a build hash: Svelte's scoped `svelte-*` class is
 * identical for every instance of a build, and `data-version` is identical for
 * every user of a release — neither identifies one instance.
 */
let counter = 0;

export function createInstanceId(): string {
  counter += 1;
  const cryptoObject = typeof globalThis.crypto === "undefined" ? undefined : globalThis.crypto;
  const random =
    typeof cryptoObject?.randomUUID === "function"
      ? cryptoObject.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `gpen-${counter.toString(36)}-${random}`;
}
