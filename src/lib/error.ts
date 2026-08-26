/** Convert an unknown rejection/throw value into an Error. */
export function asError(reason: unknown, fallback = "Unknown error"): Error {
  if (reason instanceof Error) return reason;
  if (typeof reason === "string") return new Error(reason);
  return new Error(fallback);
}
