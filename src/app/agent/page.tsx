"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/ai/agent";
import { MODE_EVENT } from "@/components/ModeSwitch";
import type { Mandate } from "@/mandate/schema";

type StreamEvent = AgentEvent | { type: "start"; mandate_id: string; mode: string; defences: boolean };
type DecisionEvent = Extract<AgentEvent, { type: "decision" }>;
type Mode = "ENFORCE" | "OBSERVE";
type Purchase = { intent_id: string; status: string; approve_url?: string; capture_id?: string };
/** A purchase waiting for the person, wherever it was proposed from (this page or an agent connected over MCP). */
type Waiting = { intent_id: string; product_id: string; quantity: number; total_cents: number; status: string; approve_url: string | null };

const dollars = (cents: number | null | undefined) => (cents == null ? "-" : `$${(cents / 100).toFixed(2)}`);

const RULE_TEXT: Record<string, string> = {
  MANDATE_VALID: "the mandate is missing, expired, revoked or its signature does not verify",
  MERCHANT_ALLOWED: "the merchant is not on the allowed list",
  CATEGORY_ALLOWED: "the category is not on the allowed list",
  QUANTITY_LIMIT: "the quantity is above the limit per item",
  PER_PURCHASE_CAP: "the total is above the per-purchase cap",
  TOTAL_BUDGET: "it would go over the total budget",
  APPROVAL_THRESHOLD: "the total is above the amount that needs your approval",
};

const STATUS_TEXT: Record<string, string> = {
  BLOCKED: "No payment was made.",
  AWAITING_APPROVAL: "Waiting for you to approve.",
  NEEDS_BUYER: "Waiting for the buyer to approve the payment in PayPal.",
  CAPTURED: "Payment captured on the PayPal sandbox.",
  VOIDED: "Payment cancelled: PayPal's order did not match what the gate approved.",
  REJECTED: "No such product. Nothing was purchased.",
};

const TONE: Record<string, { card: string; badge: string; label: string }> = {
  ALLOW: { card: "border-ok bg-ok-soft", badge: "bg-ok text-white", label: "Allowed" },
  ESCALATE: { card: "border-amber-400 bg-warn-soft", badge: "bg-amber-400 text-black", label: "Needs your approval" },
  BLOCK: { card: "border-bad bg-bad-soft", badge: "bg-bad text-white", label: "Blocked" },
};

/** One-click tasks, so nobody has to think of what to type. The last one walks into the planted injection. */
const EXAMPLES = [
  "buy me a 1 m USB-C cable",
  "buy me a mechanical keyboard under $40",
  "buy the Tactile 75% mechanical keyboard",
  "buy the coiled aviator keyboard cable",
  "buy me a $50 gift card",
];

function DecisionCard({ event, purchase, onApprove, busy }: { event: DecisionEvent; purchase?: Purchase; onApprove: (intentId: string) => void; busy: boolean }) {
  const status = purchase?.status ?? event.status;
  const approveUrl = purchase?.approve_url ?? event.approve_url;
  const captureId = purchase?.capture_id ?? event.capture_id;
  const tone = TONE[event.decision ?? ""];
  return (
    <div
      data-testid="decision"
      data-decision={event.decision ?? "NONE"}
      data-rule={event.rule ?? ""}
      data-status={status}
      className={`rise rounded-xl border-2 p-5 shadow-sm ${tone?.card ?? "border-line bg-surface"}`}
    >
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${tone?.badge ?? "bg-surface-2 text-muted"}`}>
          Gate: {event.decision ?? "not reached"}
        </span>
        {tone && <span>{tone.label}</span>}
        {event.rule && <span className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs font-medium">rule {event.rule}</span>}
      </p>
      <p className="mt-3 text-base font-medium">
        {event.quantity} x {event.product_id}, total {dollars(event.total_cents)}
        {event.rule && `: ${RULE_TEXT[event.rule] ?? event.rule}`}.
      </p>
      <p className="mt-1 text-sm text-muted">{STATUS_TEXT[status] ?? status}</p>
      {captureId && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white/80 px-3 py-1.5 font-mono text-xs">
          <span className="font-sans font-semibold text-ok">PayPal capture</span> {captureId}
        </p>
      )}
      <p className="mt-2 font-mono text-xs text-muted">{event.intent_id}</p>
      {status === "AWAITING_APPROVAL" && (
        <button type="button" disabled={busy} onClick={() => onApprove(event.intent_id)} className="btn btn-warn mt-3">
          {busy ? "Approving…" : `Approve ${dollars(event.total_cents)}`}
        </button>
      )}
      {status === "NEEDS_BUYER" && approveUrl && (
        <a href={approveUrl} className="btn btn-primary mt-3">
          Approve in PayPal (sandbox buyer)
        </a>
      )}
    </div>
  );
}

export default function AgentPage() {
  const [task, setTask] = useState("buy me a mechanical keyboard under $40");
  const [defences, setDefences] = useState(true);
  const [mode, setMode] = useState<Mode | null>(null);
  const [mandate, setMandate] = useState<{ mandate: Mandate | null; committed_cents?: number } | null>(null);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [purchases, setPurchases] = useState<Record<string, Purchase>>({});
  const [running, setRunning] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  const loadWaiting = useCallback(async () => {
    try {
      const json = await fetch("/api/purchases").then((r) => r.json());
      if (Array.isArray(json.waiting)) setWaiting(json.waiting);
    } catch {
      // Keep the last list; the next poll tries again.
    }
  }, []);

  const refresh = useCallback(async () => {
    void loadWaiting();
    try {
      const [m, s] = await Promise.all([fetch("/api/mandates/latest").then((r) => r.json()), fetch("/api/mode").then((r) => r.json())]);
      setMandate(m);
      setMode(s.mode);
    } catch {
      setNotice({ tone: "bad", text: "Could not load the mandate and gate mode. Reload the page." });
    }
  }, [loadWaiting]);

  useEffect(() => {
    // Purchases proposed by an agent connected over MCP show up here without a reload.
    const timer = setInterval(() => void loadWaiting(), 5000);
    return () => clearInterval(timer);
  }, [loadWaiting]);

  useEffect(() => {
    // Returning from PayPal: /agent?intent=...&status=CAPTURED&capture=...
    const p = new URLSearchParams(window.location.search);
    const status = p.get("status");
    if (p.get("error")) setNotice({ tone: "bad", text: `The payment could not be completed (${p.get("error")}). Nothing was captured.` });
    else if (status === "CAPTURED") setNotice({ tone: "ok", text: `Payment captured on the PayPal sandbox. Capture ${p.get("capture")}, intent ${p.get("intent")}.` });
    else if (status) setNotice({ tone: "bad", text: `Purchase ${p.get("intent")} ended as ${status}.` });
    if (status || p.get("error")) window.history.replaceState(null, "", "/agent");
    void refresh();
    // Stay in step with the Enforce / Observe switch in the header.
    const onMode = (e: Event) => setMode((e as CustomEvent<Mode>).detail);
    window.addEventListener(MODE_EVENT, onMode);
    return () => window.removeEventListener(MODE_EVENT, onMode);
  }, [refresh]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [events]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setEvents([]);
    setNotice(null);
    try {
      const res = await fetch("/api/agent/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task, defences }) });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message ?? `Request failed (${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        const parsed = lines.filter(Boolean).map((line) => JSON.parse(line) as StreamEvent);
        if (parsed.length) setEvents((prev) => [...prev, ...parsed]);
      }
    } catch (err) {
      setEvents((prev) => [...prev, { type: "error", message: err instanceof Error ? err.message : String(err) }]);
    } finally {
      setRunning(false);
      void refresh();
    }
  }

  async function approve(intentId: string) {
    setApproving(intentId);
    try {
      const res = await fetch(`/api/purchases/${intentId}/approve`, { method: "POST" });
      const json = await res.json();
      const purchase: Purchase | undefined = res.ok ? json : json.purchase;
      if (purchase) setPurchases((prev) => ({ ...prev, [intentId]: purchase }));
      if (!res.ok) setNotice({ tone: "bad", text: `Approval did not go through (${json.error}).` });
      else if (purchase?.status === "CAPTURED") setNotice({ tone: "ok", text: `Approved and captured on the PayPal sandbox. Capture ${purchase.capture_id}.` });
    } catch {
      setNotice({ tone: "bad", text: "Approval did not go through. Check your connection and try again." });
    } finally {
      setApproving(null);
      void refresh();
    }
  }

  const m = mandate?.mandate;
  // Purchases from this page's own run already have a card with a button below; list only the others.
  const shownBelow = new Set(events.flatMap((e) => (e.type === "decision" ? [e.intent_id] : [])));
  const waitingElsewhere = waiting.filter((w) => !shownBelow.has(w.intent_id));

  return (
    <main className="page max-w-4xl">
      <p className="eyebrow">Step 2</p>
      <h1 className="page-title mt-1">Shopping agent</h1>
      <p className="lede">
        The agent can search the store, read product pages and propose a purchase. It cannot pay. Every proposal is checked by the gate against
        your signed mandate.
      </p>

      {notice && (
        <p data-testid="notice" role="status" className={`notice mt-6 ${notice.tone === "ok" ? "notice-ok" : "notice-bad"}`}>
          {notice.text}
        </p>
      )}

      <section className="card mt-6 text-sm">
        {mandate === null ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading the mandate">
            <div className="skeleton h-5 w-1/3" />
            <div className="skeleton h-12" />
          </div>
        ) : !m ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              <span className="font-semibold">No signed mandate yet.</span> <span className="text-muted">The agent cannot shop until you sign your rules.</span>
            </p>
            <Link href="/mandate" className="btn btn-accent">
              Sign your rules
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">Your signed rules</p>
              <span className="font-mono text-xs text-muted">{m.id}</span>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline justify-between">
                <p className="text-lg font-semibold">
                  {dollars(mandate.committed_cents)} <span className="text-sm font-normal text-muted">used of {dollars(m.total_budget_cents)} in total</span>
                </p>
                <p className="text-xs text-muted">{dollars(Math.max(0, m.total_budget_cents - (mandate.committed_cents ?? 0)))} left</p>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="presentation">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-700"
                  style={{ width: `${Math.min(100, ((mandate.committed_cents ?? 0) / m.total_budget_cents) * 100)}%` }}
                />
              </div>
            </div>
            <ul className="mt-4 flex flex-wrap gap-2">
              <li className="badge">Up to {dollars(m.per_purchase_cap_cents)} per purchase</li>
              <li className="badge">Asks you above {dollars(m.approval_threshold_cents)}</li>
              <li className="badge">At most {m.max_quantity_per_item} per item</li>
              <li className="badge">Only {m.allowed_categories.join(", ")}</li>
            </ul>
          </>
        )}
        <p data-testid="agent-mode" className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-sm">
          <span className={`badge ${mode === "OBSERVE" ? "badge-warn" : "badge-ok"}`}>Gate mode: {mode === null ? "loading…" : mode === "OBSERVE" ? "Observe" : "Enforce"}.</span>
          <span className="text-muted">
            {mode === "OBSERVE" ? "The gate only records; it does not stop payments." : "The gate stops anything outside the mandate."} Change it with the switch
            at the top of the page.
          </span>
        </p>
      </section>

      {waitingElsewhere.length > 0 && (
        <section data-testid="waiting" className="card mt-6 text-sm">
          <p className="font-semibold">Waiting for you</p>
          <p className="mt-1 text-muted">Purchases an agent proposed that only you can move forward, including agents connected over MCP.</p>
          <ul className="mt-3 space-y-3">
            {waitingElsewhere.map((w) => (
              <li key={w.intent_id} data-testid="waiting-item" className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {w.quantity} x {w.product_id}, total {dollars(w.total_cents)}
                  <span className="ml-2 font-mono text-xs text-muted">{w.intent_id}</span>
                </span>
                {w.status === "AWAITING_APPROVAL" ? (
                  <button type="button" disabled={approving === w.intent_id} onClick={() => approve(w.intent_id)} className="btn btn-warn">
                    {approving === w.intent_id ? "Approving…" : `Approve ${dollars(w.total_cents)}`}
                  </button>
                ) : (
                  w.approve_url && (
                    <a href={w.approve_url} className="btn btn-primary">
                      Approve in PayPal (sandbox buyer)
                    </a>
                  )
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={run} className="card mt-6">
        <label className="text-base font-semibold" htmlFor="task">
          What should the agent buy?
        </label>
        <textarea id="task" name="task" rows={2} required value={task} onChange={(e) => setTask(e.target.value)} className="field mt-2 text-base" />
        <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Example tasks">
          <span className="text-xs text-muted">Try:</span>
          {EXAMPLES.map((example) => (
            <button key={example} type="button" disabled={running} onClick={() => setTask(example)} className="chip">
              {example}
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-4">
          <button type="submit" disabled={running || !m} className="btn btn-primary">
            {running ? "Agent is working…" : "Run agent"}
          </button>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="defences" checked={defences} onChange={(e) => setDefences(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            Agent&apos;s own injection defences
          </label>
          <span className="text-xs text-muted">Turn off to simulate an agent that trusts whatever a product page says. The gate is unaffected.</span>
        </div>
      </form>

      <section className="mt-8 space-y-3" aria-live="polite">
        {events.length === 0 && !running && (
          <p className="rounded-xl border border-dashed border-line px-5 py-8 text-center text-sm text-muted">
            Nothing yet. Run the agent to see each tool call and the gate&apos;s decision here.
          </p>
        )}
        {events.map((event, i) => {
          if (event.type === "start") {
            return (
              <p key={i} className="text-xs text-muted">
                Started under mandate {event.mandate_id}, gate mode {event.mode}, agent defences {event.defences ? "on" : "off"}.
              </p>
            );
          }
          if (event.type === "tool_call") {
            return (
              <p key={i} data-testid="tool-call" className="rise flex items-start gap-2 font-mono text-xs">
                <span className="badge shrink-0 font-sans">tool call</span>
                <span className="break-all pt-0.5">
                  {event.tool}({JSON.stringify(event.input)})
                </span>
              </p>
            );
          }
          if (event.type === "tool_result") {
            return (
              <details key={i} className="ml-1 border-l-2 border-line pl-3 font-mono text-xs text-muted">
                <summary className="cursor-pointer hover:text-foreground">result of {event.tool}</summary>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3">{JSON.stringify(event.output, null, 2)}</pre>
              </details>
            );
          }
          if (event.type === "decision") {
            return <DecisionCard key={i} event={event} purchase={purchases[event.intent_id]} onApprove={approve} busy={approving === event.intent_id} />;
          }
          if (event.type === "text") {
            return (
              <p key={i} data-testid="agent-text" className="card text-sm">
                <span className="font-medium">Agent:</span> {event.text}
              </p>
            );
          }
          return (
            <p key={i} data-testid="agent-error" role="alert" className="notice notice-bad">
              {event.message}
            </p>
          );
        })}
        {running && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="skeleton inline-block h-3 w-24" /> The agent is working. Each tool call appears here as it happens.
          </p>
        )}
        <div ref={bottom} />
      </section>
    </main>
  );
}
