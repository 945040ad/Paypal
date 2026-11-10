import canonicalize from "canonicalize";

/** RFC 8785 canonical JSON. The same value gives the same string in the browser and on the server. */
export function canonicalString(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new Error("Value cannot be canonicalized as JSON.");
  return out;
}

/** The exact bytes that are signed and hashed. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalString(value));
}
