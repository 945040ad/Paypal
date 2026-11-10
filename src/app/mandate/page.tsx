"use client";

import { useState } from "react";
import { loadOrCreateKeyPair } from "@/mandate/keystore";
import type { Mandate } from "@/mandate/schema";
import { exportPublicJwk, signMandate } from "@/mandate/sign";

type Result =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "done"; mandateId: string; seq: number; hash: string; signature: string }
  | { kind: "error"; message: string };

function randomHex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function dollarsToCents(value: string) {
  return Math.round(Number(value) * 100);
}

function list(value: string) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? `Request failed (${res.status})`);
  return json;
}

const FIELD = "mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export default function MandatePage() {
  const [form, setForm] = useState({
    perPurchaseCap: "40",
    totalBudget: "100",
    approvalThreshold: "30",
    merchants: "demo-store",
    categories: "keyboards, cables",
    maxQuantity: "2",
    validDays: "7",
  });
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const [sentence, setSentence] = useState("Keyboards and cables only, up to $40 per purchase and $100 in total. Ask me above $30. No more than 2 of anything.");
  const [draft, setDraft] = useState<{ kind: "idle" | "working" | "done" } | { kind: "error"; message: string }>({ kind: "idle" });

  /** The model drafts the fields; they only fill the form below, where the user reviews and edits them. */
  async function draftFromSentence() {
    setDraft({ kind: "working" });
    try {
      const { draft: d } = await postJson("/api/mandates/draft", { sentence });
      setForm({
        perPurchaseCap: (d.per_purchase_cap_cents / 100).toString(),
        totalBudget: (d.total_budget_cents / 100).toString(),
        approvalThreshold: (d.approval_threshold_cents / 100).toString(),
        merchants: d.allowed_merchants.join(", "),
        categories: d.allowed_categories.join(", "),
        maxQuantity: String(d.max_quantity_per_item),
        validDays: String(d.valid_days),
      });
      setDraft({ kind: "done" });
    } catch (err) {
      setDraft({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function signAndSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      setResult({ kind: "working", step: "Loading this browser's signing key" });
      const { keyPair } = await loadOrCreateKeyPair();
      await postJson("/api/keys", { public_key_jwk: await exportPublicJwk(keyPair.publicKey) });

      const now = new Date();
      const mandate: Mandate = {
        id: `mnd_${randomHex(8)}`,
        version: 1,
        user_id: "demo-user",
        currency: "USD",
        per_purchase_cap_cents: dollarsToCents(form.perPurchaseCap),
        total_budget_cents: dollarsToCents(form.totalBudget),
        approval_threshold_cents: dollarsToCents(form.approvalThreshold),
        allowed_merchants: list(form.merchants),
        allowed_categories: list(form.categories),
        max_quantity_per_item: Number(form.maxQuantity),
        expires_at: new Date(now.getTime() + Number(form.validDays) * 86_400_000).toISOString(),
        created_at: now.toISOString(),
        nonce: randomHex(16),
      };

      setResult({ kind: "working", step: "Signing" });
      const signature = await signMandate(keyPair.privateKey, mandate);

      setResult({ kind: "working", step: "Sending to the server for verification" });
      const saved = await postJson("/api/mandates", { mandate, signature });
      setResult({ kind: "done", mandateId: saved.mandate_id, seq: saved.ledger_seq, hash: saved.ledger_hash, signature });
    } catch (err) {
      setResult({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Mandate</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Set the rules your shopping agent must follow, then sign them. The signing key is created in this browser and
        never leaves it.
      </p>

      <section className="mt-8">
        <label className="text-sm font-medium" htmlFor="sentence">
          1. Describe your rules in plain words
        </label>
        <textarea id="sentence" name="sentence" rows={3} value={sentence} onChange={(e) => setSentence(e.target.value)} className={FIELD} />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={draftFromSentence}
            disabled={draft.kind === "working" || !sentence.trim()}
            className="rounded border border-zinc-400 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {draft.kind === "working" ? "Drafting…" : "Draft the rules with AI"}
          </button>
          {draft.kind === "done" && (
            <span data-testid="draft-done" className="text-sm text-emerald-700 dark:text-emerald-400">
              Drafted. Check the fields below before you sign.
            </span>
          )}
          {draft.kind === "error" && (
            <span data-testid="draft-error" role="alert" className="text-sm text-red-700 dark:text-red-400">
              {draft.message}
            </span>
          )}
        </div>
      </section>

      <h2 className="mt-8 text-sm font-medium">2. Review the rules, then sign</h2>
      <form onSubmit={signAndSave} className="mt-3 grid grid-cols-2 gap-4">
        <label className="text-sm font-medium">
          Per-purchase cap (USD)
          <input className={FIELD} name="perPurchaseCap" type="number" min="0.01" step="0.01" required value={form.perPurchaseCap} onChange={set("perPurchaseCap")} />
        </label>
        <label className="text-sm font-medium">
          Total budget (USD)
          <input className={FIELD} name="totalBudget" type="number" min="0.01" step="0.01" required value={form.totalBudget} onChange={set("totalBudget")} />
        </label>
        <label className="text-sm font-medium">
          Ask me above (USD)
          <input className={FIELD} name="approvalThreshold" type="number" min="0" step="0.01" required value={form.approvalThreshold} onChange={set("approvalThreshold")} />
        </label>
        <label className="text-sm font-medium">
          Max quantity per item
          <input className={FIELD} name="maxQuantity" type="number" min="1" step="1" required value={form.maxQuantity} onChange={set("maxQuantity")} />
        </label>
        <label className="text-sm font-medium">
          Allowed merchants
          <input className={FIELD} name="merchants" required value={form.merchants} onChange={set("merchants")} />
        </label>
        <label className="text-sm font-medium">
          Allowed categories
          <input className={FIELD} name="categories" required value={form.categories} onChange={set("categories")} />
        </label>
        <label className="text-sm font-medium">
          Valid for (days)
          <input className={FIELD} name="validDays" type="number" min="1" step="1" required value={form.validDays} onChange={set("validDays")} />
        </label>

        <div className="col-span-2">
          <button
            type="submit"
            disabled={result.kind === "working"}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {result.kind === "working" ? `${result.step}…` : "Sign and save"}
          </button>
        </div>
      </form>

      {result.kind === "done" && (
        <section data-testid="mandate-saved" className="mt-8 rounded border border-emerald-600 p-4 text-sm">
          <p className="font-medium text-emerald-700 dark:text-emerald-400">Mandate signed and verified by the server.</p>
          <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 font-mono text-xs">
            <dt>Mandate</dt>
            <dd data-testid="mandate-id">{result.mandateId}</dd>
            <dt>Ledger entry</dt>
            <dd data-testid="ledger-seq">{result.seq}</dd>
            <dt>Entry hash</dt>
            <dd className="break-all">{result.hash}</dd>
            <dt>Signature</dt>
            <dd className="break-all">{result.signature}</dd>
          </dl>
        </section>
      )}
      {result.kind === "error" && (
        <p data-testid="mandate-error" role="alert" className="mt-8 rounded border border-red-600 p-4 text-sm text-red-700 dark:text-red-400">
          Could not save the mandate: {result.message}
        </p>
      )}
    </main>
  );
}
