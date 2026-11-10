"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/ai/agent";
import type { Mandate } from "@/mandate/schema";

type StreamEvent = AgentEvent | { type: "start"; mandate_id: string; mode: string; defences: boolean };
type DecisionEvent = Extract<AgentEvent, { type: "decision" }>;
type Mode = "ENFORCE" | "OBSERVE";
type Purchase = { intent_id: string; status: string; approve_url?: string; capture_id?: string };

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
    <div data-testid="decision" data-decision={event.decision ?? "NONE"} data-rule={event.rule ?? ""} data-status={status} className={`rounded border-2 p-4 ${TONE[event.decision ?? ""] ?? "border-zinc-400"}`}>
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
        <button type="button" disabled={busy} onClick={() => onApprove(event.intent_id)} className="mt-3 rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Approving…" : `Approve ${dollars(event.total_cents)}`}
        </button>
      )}
      {status === "NEEDS_BUYER" && approveUrl && (
        <a href={approveUrl} className="mt-3 inline-block rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white">
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
  const bottom = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([fetch("/api/mandates/latest").then((r) => r.json()), fetch("/api/mode").then((r) => r.json())]);
      setMandate(m);
      setMode(s.mode);
    } catch {
      setNotice({ tone: "bad", text: "Could not load the mandate and gate mode. Reload the page." });
    }
  }, []);

  useEffect(() => {
    // Returning from PayPal: /agent?intent=...&status=CAPTURED&capture=...
    const p = new URLSearchParams(window.location.search);
    const status = p.get("status");
    if (p.get("error")) setNotice({ tone: "bad", text: `The payment could not be completed (${p.get("error")}). Nothing was captured.` });
    else if (status === "CAPTURED") setNotice({ tone: "ok", text: `Payment captured on the PayPal sandbox. Capture ${p.get("capture")}, intent ${p.get("intent")}.` });
    else if (status) setNotice({ tone: "bad", text: `Purchase ${p.get("intent")} ended as ${status}.` });
    if (status || p.get("error")) window.history.replaceState(null, "", "/agent");
    void refresh();
  }, [refresh]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [events]);

  async function changeMode(next: Mode) {
    const res = await fetch("/api/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: next }) });
    if (res.ok) setMode(next);
  }

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
    } catch {
      setNotice({ tone: "bad", text: "Approval did not go through. Check your connection and try again." });
    } finally {
      setApproving(null);
      void refresh();
    }
  }

  const m = mandate?.mandate;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Shopping agent</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        The agent can search the store, read product pages and propose a purchase. It cannot pay. Every proposal is checked by the gate against
        your signed mandate.
      </p>

      {notice && (
        <p data-testid="notice" role="status" className={`mt-6 rounded border p-3 text-sm ${notice.tone === "ok" ? "border-emerald-600 text-emerald-700 dark:text-emerald-400" : "border-red-600 text-red-700 dark:text-red-400"}`}>
          {notice.text}
        </p>
      )}

      <section className="mt-6 rounded border border-zinc-200 p-4 text-sm dark:border-zinc-800">
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
        <div className="mt-3 flex items-center gap-2">
          <span className="font-medium">Gate mode</span>
          {(["ENFORCE", "OBSERVE"] as const).map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`mode-${option}`}
              aria-pressed={mode === option}
              onClick={() => changeMode(option)}
              className={`rounded border px-3 py-1 text-xs font-semibold ${mode === option ? (option === "ENFORCE" ? "border-emerald-700 bg-emerald-700 text-white" : "border-amber-600 bg-amber-600 text-white") : "border-zinc-300 dark:border-zinc-700"}`}
            >
              {option === "ENFORCE" ? "Enforce" : "Observe"}
            </button>
          ))}
          <span className="text-xs text-zinc-500">{mode === "OBSERVE" ? "The gate only records; it does not stop payments." : "The gate stops anything outside the mandate."}</span>
        </div>
      </section>

      <form onSubmit={run} className="mt-6">
        <label className="text-sm font-medium" htmlFor="task">
          What should the agent buy?
        </label>
        <textarea id="task" name="task" rows={2} required value={task} onChange={(e) => setTask(e.target.value)} className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <button type="submit" disabled={running || !m} className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
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
              <p key={i} data-testid="agent-text" className="rounded bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
                <span className="font-medium">Agent:</span> {event.text}
              </p>
            );
          }
          return (
            <p key={i} data-testid="agent-error" role="alert" className="rounded border border-red-600 p-3 text-sm text-red-700 dark:text-red-400">
              {event.message}
            </p>
          );
        })}
        {running && <p className="text-sm text-zinc-500">Working…</p>}
        <div ref={bottom} />
      </section>
    </main>
  );
}
