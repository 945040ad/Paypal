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

const FIELD = "field";

/** Starting points for the plain-words box, so nobody faces an empty field. */
const EXAMPLES = [
  { label: "Careful", text: "Cables only. Up to $15 per purchase and $30 in total. Ask me above $10. Only 1 of anything." },
  { label: "Everyday", text: "Keyboards and cables only, up to $40 per purchase and $100 in total. Ask me above $30. No more than 2 of anything." },
  { label: "Generous", text: "Keyboards, cables and gift cards. Up to $100 per purchase and $300 in total. Ask me above $80. Up to 3 of anything." },
];

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
    <main className="page">
      <p className="eyebrow">Step 1</p>
      <h1 className="page-title mt-1">Mandate</h1>
      <p className="lede">
        Set the rules your shopping agent must follow, then sign them. The signing key is created in this browser and
        never leaves it.
      </p>

      <section className="card mt-8">
        <label className="flex items-center gap-3 text-base font-semibold" htmlFor="sentence">
          <span aria-hidden="true" className="font-mono text-sm font-normal text-muted">
            1
          </span>
          <span>
            <span className="sr-only">1. </span>Describe your rules in plain words
          </span>
        </label>
        <textarea id="sentence" name="sentence" rows={3} value={sentence} onChange={(e) => setSentence(e.target.value)} className={`${FIELD} mt-3 text-base`} />
        <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Example rules">
          <span className="text-xs text-muted">Or start from:</span>
          {EXAMPLES.map((example) => (
            <button key={example.label} type="button" onClick={() => setSentence(example.text)} className="chip">
              {example.label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={draftFromSentence}
            disabled={draft.kind === "working" || !sentence.trim()}
            className="btn btn-primary"
          >
            {draft.kind === "working" ? "Drafting…" : "Draft the rules with AI"}
          </button>
          {draft.kind === "done" && (
            <span data-testid="draft-done" className="text-sm text-ok">
              Drafted. Check the fields below before you sign.
            </span>
          )}
          {draft.kind === "error" && (
            <span data-testid="draft-error" role="alert" className="text-sm text-bad">
              {draft.message}
            </span>
          )}
        </div>
      </section>

      <form onSubmit={signAndSave} className="card mt-5 grid grid-cols-2 gap-4">
        <h2 className="col-span-2 flex items-center gap-3 text-base font-semibold">
          <span aria-hidden="true" className="font-mono text-sm font-normal text-muted">
            2
          </span>
          <span>
            <span className="sr-only">2. </span>Review the rules, then sign
          </span>
        </h2>
        <p data-testid="mandate-summary" className="col-span-2 rounded-xl bg-surface-2 px-4 py-3 text-sm leading-relaxed">
          <span className="font-semibold">In plain words:</span> the agent may buy <span className="font-semibold">{form.categories || "nothing"}</span> from{" "}
          <span className="font-semibold">{form.merchants || "no store"}</span>, up to <span className="font-semibold">${form.perPurchaseCap}</span> per purchase and{" "}
          <span className="font-semibold">${form.totalBudget}</span> in total, at most <span className="font-semibold">{form.maxQuantity}</span> of any item. Anything
          above <span className="font-semibold">${form.approvalThreshold}</span> waits for your approval. These rules last{" "}
          <span className="font-semibold">{form.validDays}</span> days.
        </p>
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

        <div className="col-span-2 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button
            type="submit"
            disabled={result.kind === "working"}
            className="btn btn-primary"
          >
            {result.kind === "working" ? `${result.step}…` : "Sign and save"}
          </button>
          <span className="text-xs text-muted">Signed with a key that is created in this browser and never leaves it.</span>
        </div>
      </form>

      {result.kind === "done" && (
        <section data-testid="mandate-saved" className="notice notice-ok rise mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold text-ok">Mandate signed and verified by the server. It is now entry #{result.seq} in the ledger.</p>
            <a href="/agent" className="btn btn-ok">
              Next: let the agent shop
            </a>
          </div>
          <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1 rounded-lg bg-surface-2 p-3 font-mono text-xs">
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
        <p data-testid="mandate-error" role="alert" className="notice notice-bad mt-8">
          Could not save the mandate: {result.message}
        </p>
      )}
    </main>
  );
}
