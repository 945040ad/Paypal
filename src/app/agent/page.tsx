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

const TONE: Record<string, string> = {
  ALLOW: "border-emerald-600 text-emerald-700 dark:text-emerald-400",
  ESCALATE: "border-amber-500 text-amber-700 dark:text-amber-400",
  BLOCK: "border-red-600 text-red-700 dark:text-red-400",
};

function DecisionCard({ event, purchase, onApprove, busy }: { event: DecisionEvent; purchase?: Purchase; onApprove: (intentId: string) => void; busy: boolean }) {
  const status = purchase?.status ?? event.status;
  const approveUrl = purchase?.approve_url ?? event.approve_url;
  const captureId = purchase?.capture_id ?? event.capture_id;
  return (
    <div data-testid="decision" data-decision={event.decision ?? "NONE"} data-rule={event.rule ?? ""} data-status={status} className={`rounded-lg border-2 bg-surface p-4 ${TONE[event.decision ?? ""] ?? "border-zinc-400"}`}>
      <p className="text-sm font-semibold">
        Gate: {event.decision ?? "not reached"}
        {event.rule && <span className="ml-2 font-mono text-xs">rule {event.rule}</span>}
      </p>
      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
        {event.quantity} x {event.product_id}, total {dollars(event.total_cents)}
        {event.rule && `: ${RULE_TEXT[event.rule] ?? event.rule}`}.
      </p>
      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{STATUS_TEXT[status] ?? status}</p>
      {captureId && <p className="mt-1 font-mono text-xs text-zinc-600 dark:text-zinc-400">PayPal capture {captureId}</p>}
      <p className="mt-1 font-mono text-xs text-zinc-500">{event.intent_id}</p>
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
          <p className="text-zinc-500">Loading the mandate…</p>
        ) : !m ? (
          <p>
            No signed mandate yet.{" "}
            <Link href="/mandate" className="underline">
              Sign one first
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="font-medium">
              Mandate <span className="font-mono text-xs">{m.id}</span>
            </p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              Up to {dollars(m.per_purchase_cap_cents)} per purchase, {dollars(m.total_budget_cents)} in total ({dollars(mandate.committed_cents)} used), asks you above{" "}
              {dollars(m.approval_threshold_cents)}, at most {m.max_quantity_per_item} per item, categories: {m.allowed_categories.join(", ")}.
            </p>
          </>
        )}
        <p data-testid="agent-mode" className="mt-3 text-sm">
          <span className="font-semibold">Gate mode: {mode === null ? "loading…" : mode === "OBSERVE" ? "Observe" : "Enforce"}.</span>{" "}
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

      <form onSubmit={run} className="mt-6">
        <label className="text-sm font-medium" htmlFor="task">
          What should the agent buy?
        </label>
        <textarea id="task" name="task" rows={2} required value={task} onChange={(e) => setTask(e.target.value)} className="field" />
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <button type="submit" disabled={running || !m} className="btn btn-primary">
            {running ? "Agent is working…" : "Run agent"}
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="defences" checked={defences} onChange={(e) => setDefences(e.target.checked)} />
            Agent&apos;s own injection defences
          </label>
          <span className="text-xs text-zinc-500">Turn off to simulate an agent that trusts whatever a product page says. The gate is unaffected.</span>
        </div>
      </form>

      <section className="mt-8 space-y-3" aria-live="polite">
        {events.length === 0 && !running && <p className="text-sm text-zinc-500">Nothing yet. Run the agent to see each tool call and the gate&apos;s decision here.</p>}
        {events.map((event, i) => {
          if (event.type === "start") {
            return (
              <p key={i} className="text-xs text-zinc-500">
                Started under mandate {event.mandate_id}, gate mode {event.mode}, agent defences {event.defences ? "on" : "off"}.
              </p>
            );
          }
          if (event.type === "tool_call") {
            return (
              <p key={i} data-testid="tool-call" className="font-mono text-xs">
                <span className="text-zinc-500">tool call</span> {event.tool}({JSON.stringify(event.input)})
              </p>
            );
          }
          if (event.type === "tool_result") {
            return (
              <details key={i} className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                <summary className="cursor-pointer">result of {event.tool}</summary>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-zinc-100 p-2 dark:bg-zinc-900">{JSON.stringify(event.output, null, 2)}</pre>
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
