"use client";

import { useCallback, useEffect, useState } from "react";

type Classification = "IN_MANDATE" | "VIOLATION" | "UNKNOWN";
type Row = {
  dispute_id: string;
  status: string | null;
  stage: string | null;
  reason: string | null;
  amount_cents: number | null;
  outcome: string | null;
  classification: Classification;
  classification_reason: string;
};
type Detail = {
  dispute_id: string;
  status: string | null;
  stage: string | null;
  reason: string | null;
  outcome: string | null;
  classification: Classification;
  classification_reason: string;
  actions: string[];
  evidence_type: string | null;
  draft: { notes: string; source: "model" | "template"; problems: string[]; evidence_type: string | null } | null;
  timeline: { seq: number; ts: string; type: string; hash: string; text: string }[];
  has_ledger_record: boolean;
};
type Notice = { tone: "ok" | "bad"; text: string } | null;

const dollars = (cents: number | null) => (cents == null ? "-" : `$${(cents / 100).toFixed(2)}`);
const words = (s: string | null) => (s ?? "-").replaceAll("_", " ").toLowerCase();

const BADGE: Record<Classification, { label: string; tone: string }> = {
  IN_MANDATE: { label: "Inside the mandate", tone: "bg-emerald-700 text-white" },
  VIOLATION: { label: "Agent broke the mandate", tone: "bg-red-700 text-white" },
  UNKNOWN: { label: "Needs a person", tone: "bg-zinc-600 text-white" },
};

const BUTTON = "rounded px-4 py-2 text-sm font-medium disabled:opacity-50";

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? `Request failed (${res.status}).`);
  return json;
}

export default function DisputesPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const loadList = useCallback(async () => {
    try {
      setRows((await call("/api/disputes")).disputes);
    } catch (err) {
      setRows([]);
      setNotice({ tone: "bad", text: err instanceof Error ? err.message : "Could not load disputes." });
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      setDetail(await call(`/api/disputes/${id}`));
    } catch (err) {
      setDetail(null);
      setNotice({ tone: "bad", text: err instanceof Error ? err.message : "Could not load the dispute." });
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    call("/api/disputes")
      .then((json) => !cancelled && setRows(json.disputes))
      .catch((err) => {
        if (cancelled) return;
        setRows([]);
        setNotice({ tone: "bad", text: err instanceof Error ? err.message : "Could not load disputes." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function open(id: string) {
    setSelected(id);
    setDetail(null);
    setNotice(null);
    void loadDetail(id);
  }

  async function sync() {
    setBusy("sync");
    setNotice(null);
    try {
      const s = await call("/api/reconcile", { method: "POST" });
      setNotice({ tone: "ok", text: `Synced with PayPal: ${s.disputes_seen} disputes checked, ${s.disputes_opened} new, ${s.disputes_resolved} newly resolved.` });
      await loadList();
      if (selected) await loadDetail(selected);
    } catch {
      setNotice({ tone: "bad", text: "Could not reach PayPal. Try again in a moment." });
    } finally {
      setBusy(null);
    }
  }

  async function act(action: string, done: string, body?: unknown) {
    if (!selected) return;
    setBusy(action);
    setNotice(null);
    try {
      await call(`/api/disputes/${selected}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      setNotice({ tone: "ok", text: done });
    } catch (err) {
      setNotice({ tone: "bad", text: err instanceof Error ? err.message : "The action failed." });
    } finally {
      setBusy(null);
      await Promise.all([loadList(), loadDetail(selected)]);
    }
  }

  const can = (a: string) => detail?.actions.includes(a) ?? false;
  const resolved = detail?.status === "RESOLVED";

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dispute desk</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            When a buyer disputes a payment, the ledger shows whether the purchase was inside the signed mandate. If it was, file the proof. If the
            agent broke the rules, refund without argument.
          </p>
        </div>
        <button type="button" onClick={sync} disabled={busy !== null} className={`${BUTTON} border border-zinc-400`}>
          {busy === "sync" ? "Syncing…" : "Sync from PayPal"}
        </button>
      </div>

      {notice && (
        <p data-testid="notice" role="status" className={`mt-6 rounded border p-3 text-sm ${notice.tone === "ok" ? "border-emerald-600 text-emerald-700 dark:text-emerald-400" : "border-red-600 text-red-700 dark:text-red-400"}`}>
          {notice.text}
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[20rem_1fr]">
        <section aria-label="Disputes">
          {rows === null && <p className="text-sm text-zinc-500">Loading disputes…</p>}
          {rows?.length === 0 && (
            <p className="text-sm text-zinc-500">No disputes yet. When a buyer opens one in PayPal it appears here within a few minutes; use Sync from PayPal to check now.</p>
          )}
          <ul className="space-y-2">
            {rows?.map((r) => (
              <li key={r.dispute_id}>
                <button
                  type="button"
                  data-testid="dispute-row"
                  data-id={r.dispute_id}
                  onClick={() => open(r.dispute_id)}
                  className={`w-full rounded border p-3 text-left text-sm ${selected === r.dispute_id ? "border-zinc-900 dark:border-zinc-100" : "border-zinc-200 dark:border-zinc-800"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{r.dispute_id}</span>
                    <span className="font-mono">{dollars(r.amount_cents)}</span>
                  </span>
                  <span className={`mt-2 inline-block rounded px-2 py-0.5 text-xs font-semibold ${BADGE[r.classification].tone}`}>{BADGE[r.classification].label}</span>
                  <span className="mt-1 block text-xs text-zinc-500">
                    {r.status === "RESOLVED" ? `Resolved: ${words(r.outcome)}` : `${words(r.status)}, ${words(r.stage)} stage`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Dispute detail" aria-live="polite">
          {!selected && rows !== null && rows.length > 0 && <p className="text-sm text-zinc-500">Choose a dispute to see what the ledger says about it.</p>}
          {selected && loadingDetail && !detail && <p className="text-sm text-zinc-500">Asking PayPal for the latest state of {selected}…</p>}
          {detail && (
            <div data-testid="dispute-detail" data-classification={detail.classification} data-status={detail.status ?? ""}>
              <h2 className="font-mono text-lg">{detail.dispute_id}</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Buyer&apos;s reason: {words(detail.reason)}. PayPal status: {words(detail.status)}, {words(detail.stage)} stage.
                {detail.outcome && ` Outcome: ${words(detail.outcome)}.`}
              </p>

              <div className={`mt-4 rounded border-2 p-4 ${detail.classification === "IN_MANDATE" ? "border-emerald-600" : detail.classification === "VIOLATION" ? "border-red-600" : "border-zinc-400"}`}>
                <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${BADGE[detail.classification].tone}`}>{BADGE[detail.classification].label}</span>
                <p className="mt-2 text-sm">{detail.classification_reason}</p>
                <p className="mt-1 text-xs text-zinc-500">Decided by code from the ledger. No AI model takes part in this decision.</p>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {resolved && <p className="text-sm font-medium">This dispute is closed.</p>}
                {!resolved && detail.classification !== "VIOLATION" && can("provide_evidence") && detail.evidence_type && (
                  <button type="button" data-testid="file-evidence" disabled={busy !== null} onClick={() => act("file-evidence", "Evidence filed with PayPal and recorded in the ledger.")} className={`${BUTTON} bg-emerald-700 text-white`}>
                    {busy === "file-evidence" ? "Filing…" : "File evidence"}
                  </button>
                )}
                {!resolved && detail.classification !== "IN_MANDATE" && can("accept_claim") && (
                  <button type="button" data-testid="accept-claim" disabled={busy !== null} onClick={() => act("accept-claim", "Claim accepted. PayPal is refunding the buyer in full.")} className={`${BUTTON} bg-red-700 text-white`}>
                    {busy === "accept-claim" ? "Accepting…" : "Accept claim and refund"}
                  </button>
                )}
                {!resolved && detail.classification !== "VIOLATION" && can("escalate") && (
                  <button type="button" data-testid="escalate" disabled={busy !== null} onClick={() => act("escalate", "Escalated to a PayPal claim. PayPal will ask for evidence in a few minutes.")} className={`${BUTTON} border border-zinc-400`}>
                    {busy === "escalate" ? "Escalating…" : "Ask PayPal to decide (escalate)"}
                  </button>
                )}
                {!resolved && detail.actions.length === 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">PayPal is not accepting any action on this dispute right now. In the sandbox this wait can take up to half an hour. Use Sync from PayPal to check again.</p>}
              </div>

              {!resolved && can("adjudicate") && (
                <div className="mt-4 rounded border border-dashed border-amber-500 p-4">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Simulate PayPal&apos;s decision (sandbox only)</p>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">In real life PayPal reviews the evidence and decides. The sandbox has no reviewer, so this stands in for one.</p>
                  <div className="mt-3 flex gap-3">
                    <button type="button" data-testid="adjudicate-seller" disabled={busy !== null} onClick={() => act("adjudicate", "PayPal's decision was simulated: for the seller. It takes a few minutes to show as resolved.", { outcome: "SELLER_FAVOR" })} className={`${BUTTON} border border-amber-600`}>
                      Decide for the seller
                    </button>
                    <button type="button" disabled={busy !== null} onClick={() => act("adjudicate", "PayPal's decision was simulated: for the buyer. It takes a few minutes to show as resolved.", { outcome: "BUYER_FAVOR" })} className={`${BUTTON} border border-amber-600`}>
                      Decide for the buyer
                    </button>
                  </div>
                </div>
              )}

              {detail.draft && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold">Evidence that will be filed ({words(detail.draft.evidence_type)})</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    {detail.draft.source === "model"
                      ? "Notes drafted by the AI model. Code checked that every ledger entry they cite exists."
                      : "Notes from the fixed template, built from ledger facts only."}
                    {detail.draft.problems.length > 0 && ` The model's draft was not used: ${detail.draft.problems.join(" ")}`}
                  </p>
                  <p data-testid="draft-notes" className="mt-2 whitespace-pre-wrap rounded bg-zinc-100 p-3 text-sm dark:bg-zinc-900">{detail.draft.notes}</p>
                </div>
              )}

              {detail.has_ledger_record && (
                <div className="mt-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Evidence PDF</h3>
                    <a href={`/api/disputes/${detail.dispute_id}/evidence`} target="_blank" rel="noreferrer" className="text-sm underline">
                      Open in a new tab
                    </a>
                  </div>
                  <iframe title={`Evidence PDF for ${detail.dispute_id}`} src={`/api/disputes/${detail.dispute_id}/evidence#toolbar=0`} className="mt-2 h-96 w-full rounded border border-zinc-200 dark:border-zinc-800" />
                </div>
              )}

              <div className="mt-6">
                <h3 className="text-sm font-semibold">What the ledger holds</h3>
                {detail.timeline.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">Nothing. This payment was not made through the gate.</p>
                ) : (
                  <ol className="mt-2 space-y-1">
                    {detail.timeline.map((e) => (
                      <li key={e.seq} data-testid="timeline-entry" data-type={e.type} className={`font-mono text-xs ${e.type === "VIOLATION" || e.type === "UNMATCHED_CAPTURE" ? "text-red-700 dark:text-red-400" : ""}`}>
                        {e.text} <span className="text-zinc-400">{e.hash.slice(0, 10)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
