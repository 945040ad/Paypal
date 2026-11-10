/** Step 6 of the purchase flow: compare what PayPal holds with what the gate approved, before capturing. */
import { centsToDecimal } from "./money";

export type Expected = { total_cents: number; currency: string; custom_id: string; payee_email: string };
export type Mismatch = { field: "purchase_units" | "amount" | "currency" | "payee" | "custom_id"; expected: string; actual: string };

type OrderLike = {
  purchase_units?: {
    custom_id?: string;
    amount?: { currency_code?: string; value?: string };
    payee?: { email_address?: string };
  }[];
};

export function recheckOrder(order: unknown, expected: Expected): { ok: boolean; mismatches: Mismatch[] } {
  const units = (order as OrderLike)?.purchase_units ?? [];
  if (units.length !== 1) {
    return { ok: false, mismatches: [{ field: "purchase_units", expected: "1", actual: String(units.length) }] };
  }
  const unit = units[0];
  const mismatches: Mismatch[] = [];
  const check = (field: Mismatch["field"], want: string, got: string | undefined, same = want === got) => {
    if (!same) mismatches.push({ field, expected: want, actual: got ?? "(missing)" });
  };
  check("amount", centsToDecimal(expected.total_cents), unit.amount?.value);
  check("currency", expected.currency, unit.amount?.currency_code);
  check("payee", expected.payee_email, unit.payee?.email_address, expected.payee_email.toLowerCase() === unit.payee?.email_address?.toLowerCase());
  check("custom_id", expected.custom_id, unit.custom_id);
  return { ok: mismatches.length === 0, mismatches };
}
