/** Money is integer cents everywhere in our code. These two functions are the only place PayPal's decimal strings appear. */

export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`Not a valid cent amount: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function decimalToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error(`Not a valid decimal amount: ${JSON.stringify(value)}`);
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}
