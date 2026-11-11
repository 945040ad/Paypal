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
  IN_MANDATE: { label: "Inside the mandate", tone: "text-ok" },
  VIOLATION: { label: "Agent broke the mandate", tone: "text-bad" },
  UNKNOWN: { label: "Needs a person", tone: "text-muted" },
};

const BUTTON = "btn";

/** One sentence telling a first-time user what to do next with this dispute. */
function nextStep(d: Detail): string | null {
  const can = (a: string) => d.actions.includes(a);
  if (d.status === "RESOLVED") return null;
  if (d.classification === "VIOLATION") {
    return can("accept_claim")
      ? "The ledger shows the agent broke the mandate, so the buyer is right. Accept the claim: PayPal refunds the buyer and closes the case within a few minutes."
      : null;
  }
  if (d.classification === "UNKNOWN") return "The ledger has no clear answer for this payment. A person has to decide what to do.";
  if (can("adjudicate")) return "Step 4 of 4. PayPal has the evidence and would now review it. The sandbox has no reviewer, so simulate the decision below.";
  if (d.stage === "CHARGEBACK" && can("provide_evidence")) {
    return "Step 3 of 4. The case is now a PayPal claim and PayPal asks for evidence again. File it: this time the signed mandate goes in as the main document.";
  }
  if (can("provide_evidence") && d.evidence_type) return "Step 1 of 4. The ledger shows this purchase was inside the mandate. File the evidence PayPal has asked for.";
  if (can("escalate")) return "Step 2 of 4. The buyer has your evidence. Ask PayPal to decide: this turns the inquiry into a claim that PayPal rules on.";
  return null;
}

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

  // While this page is open it keeps itself current: the list every 30 seconds, and an open, unresolved
  // dispute every 60 seconds (that one asks PayPal). A failed background refresh changes nothing on screen.
  // The steady traffic also keeps a host that sleeps when idle awake through PayPal's long waits.
  const selectedStatus = detail?.status ?? null;
  useEffect(() => {
    if (busy !== null) return;
    const list = setInterval(() => {
      call("/api/disputes")
        .then((json) => setRows(json.disputes))
        .catch(() => {});
    }, 30_000);
    const one =
      selected && selectedStatus !== "RESOLVED"
        ? setInterval(() => {
            call(`/api/disputes/${selected}`)
              .then((json: Detail) => setDetail((current) => (current && current.dispute_id === json.dispute_id ? json : current)))
              .catch(() => {});
          }, 60_000)
        : undefined;
    return () => {
      clearInterval(list);
      if (one) clearInterval(one);
    };
  }, [selected, selectedStatus, busy]);

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
    <main className="page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Step 4</p>
          <h1 className="page-title mt-1">Dispute desk</h1>
          <p className="lede">
            When a buyer disputes a payment, the ledger shows whether the purchase was inside the signed mandate. If it was, file the proof. If the
            agent broke the rules, refund without argument.
          </p>
        </div>
        <div className="text-right">
          <button type="button" onClick={sync} disabled={busy !== null} className={BUTTON}>
            {busy === "sync" ? "Syncing…" : "Sync from PayPal"}
          </button>
          <p className="mt-2 text-xs text-muted">Updates on its own while this page is open.</p>
        </div>
      </div>

      {notice && (
        <p data-testid="notice" role="status" className={`notice mt-6 ${notice.tone === "ok" ? "notice-ok" : "notice-bad"}`}>
          {notice.text}
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[20rem_1fr]">
        <section aria-label="Disputes">
          {rows === null && (
            <div className="space-y-2" aria-busy="true" aria-label="Loading disputes">
              <div className="skeleton h-20" />
              <div className="skeleton h-20" />
            </div>
          )}
          {rows?.length === 0 && (
            <div className="card text-sm">
              <p className="font-semibold">No disputes yet.</p>
              <p className="mt-2 text-muted">To try the desk, open one as the sandbox buyer:</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
                <li>Buy something on the Agent page.</li>
                <li>Log in to sandbox.paypal.com with the sandbox buyer account.</li>
                <li>Open Activity, choose the payment to Test Store, and click Report a problem.</li>
                <li>Choose &ldquo;I didn&apos;t receive an item I purchased&rdquo; and submit.</li>
                <li>Wait about five minutes, then press Sync from PayPal.</li>
              </ol>
            </div>
          )}
          <ul className="space-y-2">
            {rows?.map((r) => (
              <li key={r.dispute_id}>
                <button
                  type="button"
                  data-testid="dispute-row"
                  data-id={r.dispute_id}
                  onClick={() => open(r.dispute_id)}
                  className={`w-full rounded-xl border p-4 text-left text-sm transition-colors duration-150 ${selected === r.dispute_id ? "border-line-strong bg-surface" : "border-transparent hover:bg-surface-2"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{r.dispute_id}</span>
                    <span className="font-mono">{dollars(r.amount_cents)}</span>
                  </span>
                  <span className={`mt-2 block text-sm font-medium ${BADGE[r.classification].tone}`}>{BADGE[r.classification].label}</span>
                  <span className="mt-1 block text-xs text-muted">
                    {r.status === "RESOLVED" ? `Resolved: ${words(r.outcome)}` : `${words(r.status)}, ${words(r.stage)} stage`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Dispute detail" aria-live="polite">
          {!selected && rows !== null && rows.length > 0 && <p className="rounded-xl border border-dashed border-line px-5 py-10 text-center text-sm text-muted">Choose a dispute on the left to see what the ledger says about it.</p>}
          {selected && loadingDetail && !detail && (
            <div aria-busy="true">
              <p className="text-sm text-muted">Asking PayPal for the latest state of {selected}…</p>
              <div className="skeleton mt-3 h-24" />
              <div className="skeleton mt-3 h-40" />
            </div>
          )}
          {detail && (
            <div data-testid="dispute-detail" data-classification={detail.classification} data-status={detail.status ?? ""} className="card">
              <h2 className="font-mono text-xl font-semibold">{detail.dispute_id}</h2>
              <p className="mt-1 text-sm text-muted">
                Buyer&apos;s reason: {words(detail.reason)}. PayPal status: {words(detail.status)}, {words(detail.stage)} stage.
                {detail.outcome && ` Outcome: ${words(detail.outcome)}.`}
              </p>

              <div className={`mt-4 rounded-xl border border-l-[3px] border-line p-5 ${detail.classification === "IN_MANDATE" ? "border-l-ok" : detail.classification === "VIOLATION" ? "border-l-bad" : ""}`}>
                <span className={`text-sm font-semibold ${BADGE[detail.classification].tone}`}>{BADGE[detail.classification].label}</span>
                <p className="mt-3 text-base font-medium">{detail.classification_reason}</p>
                <p className="mt-1 text-xs text-muted">Decided by code from the ledger. No AI model takes part in this decision.</p>
              </div>

              {nextStep(detail) && (
                <p data-testid="next-step" className="notice notice-warn mt-4">
                  <span className="font-semibold">What to do now.</span> {nextStep(detail)}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {resolved && <p className="badge">This dispute is closed. Nothing more to do.</p>}
                {!resolved && detail.classification !== "VIOLATION" && can("provide_evidence") && detail.evidence_type && (
                  <button type="button" data-testid="file-evidence" disabled={busy !== null} onClick={() => act("file-evidence", "Evidence filed with PayPal and recorded in the ledger.")} className={`${BUTTON} btn-ok`}>
                    {busy === "file-evidence" ? "Filing…" : "File evidence"}
                  </button>
                )}
                {!resolved && detail.classification !== "IN_MANDATE" && can("accept_claim") && (
                  <button type="button" data-testid="accept-claim" disabled={busy !== null} onClick={() => act("accept-claim", "Claim accepted. PayPal is refunding the buyer in full.")} className={`${BUTTON} btn-bad`}>
                    {busy === "accept-claim" ? "Accepting…" : "Accept claim and refund"}
                  </button>
                )}
                {!resolved && detail.classification !== "VIOLATION" && can("escalate") && (
                  <button type="button" data-testid="escalate" disabled={busy !== null} onClick={() => act("escalate", "Escalated to a PayPal claim. PayPal will ask for evidence in a few minutes.")} className={BUTTON}>
                    {busy === "escalate" ? "Escalating…" : "Ask PayPal to decide (escalate)"}
                  </button>
                )}
                {!resolved && detail.actions.length === 0 && <p className="text-sm text-muted">PayPal is not accepting any action on this dispute right now. In the sandbox this wait can take up to half an hour. Use Sync from PayPal to check again.</p>}
              </div>

              {!resolved && can("adjudicate") && (
                <div className="mt-4 rounded-xl border border-dashed border-line-strong p-4">
                  <p className="text-sm font-semibold text-warn">Simulate PayPal&apos;s decision (sandbox only)</p>
                  <p className="mt-1 text-xs text-muted">In real life PayPal reviews the evidence and decides. The sandbox has no reviewer, so this stands in for one.</p>
                  <div className="mt-3 flex gap-3">
                    <button type="button" data-testid="adjudicate-seller" disabled={busy !== null} onClick={() => act("adjudicate", "PayPal's decision was simulated: for the seller. It takes a few minutes to show as resolved.", { outcome: "SELLER_FAVOR" })} className={`${BUTTON} btn-warn`}>
                      Decide for the seller
                    </button>
                    <button type="button" disabled={busy !== null} onClick={() => act("adjudicate", "PayPal's decision was simulated: for the buyer. It takes a few minutes to show as resolved.", { outcome: "BUYER_FAVOR" })} className={`${BUTTON} btn-warn`}>
                      Decide for the buyer
                    </button>
                  </div>
                </div>
              )}

              {detail.draft && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold">Evidence that will be filed ({words(detail.draft.evidence_type)})</h3>
                  <p className="mt-1 text-xs text-muted">
                    {detail.draft.source === "model"
                      ? "Notes drafted by the AI model. Code checked that every ledger entry they cite exists."
                      : "Notes from the fixed template, built from ledger facts only."}
                    {detail.draft.problems.length > 0 && ` The model's draft was not used: ${detail.draft.problems.join(" ")}`}
                  </p>
                  <p data-testid="draft-notes" className="card mt-2 whitespace-pre-wrap text-sm">{detail.draft.notes}</p>
                </div>
              )}

              {detail.has_ledger_record && (
                <div className="mt-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Evidence PDF</h3>
                    <a href={`/api/disputes/${detail.dispute_id}/evidence`} target="_blank" rel="noreferrer" className="text-sm underline decoration-line-strong underline-offset-4 hover:decoration-foreground">
                      Open in a new tab
                    </a>
                  </div>
                  <iframe title={`Evidence PDF for ${detail.dispute_id}`} src={`/api/disputes/${detail.dispute_id}/evidence#toolbar=0`} className="mt-2 h-96 w-full rounded-xl border border-line bg-surface" />
                </div>
              )}

              <div className="mt-6">
                <h3 className="text-sm font-semibold">What the ledger holds</h3>
                {detail.timeline.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">Nothing. This payment was not made through the gate.</p>
                ) : (
                  <ol className="mt-2 space-y-1.5 rounded-xl bg-surface-2 p-4">
                    {detail.timeline.map((e) => (
                      <li key={e.seq} data-testid="timeline-entry" data-type={e.type} className={`font-mono text-xs ${e.type === "VIOLATION" || e.type === "UNMATCHED_CAPTURE" ? "font-semibold text-bad" : ""}`}>
                        {e.text} <span className="text-muted">{e.hash.slice(0, 10)}</span>
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
