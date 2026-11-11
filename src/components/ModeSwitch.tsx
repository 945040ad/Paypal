"use client";

import { useEffect, useState } from "react";

export type Mode = "ENFORCE" | "OBSERVE";

/** Other parts of a page listen for this to stay in step with the switch. */
export const MODE_EVENT = "gate-mode-changed";

/**
 * The Enforce / Observe switch. It sits in the sidebar of every page, and while the gate is in Observe mode
 * a bar across the top says so, because in that mode nothing is stopped.
 */
export function ModeSwitch() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mode")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (cancelled) return;
        setMode(j.mode);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(next: Mode) {
    if (next === mode || state === "saving") return;
    setState("saving");
    try {
      const res = await fetch("/api/mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: next }) });
      if (!res.ok) throw new Error(String(res.status));
      setMode(next);
      setState("ready");
      window.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: next }));
    } catch {
      setState("error");
    }
  }

  // Lets the page make room for the Observe bar (see globals.css).
  useEffect(() => {
    if (mode) document.documentElement.dataset.gate = mode;
  }, [mode]);

  const option = (value: Mode, label: string, activeClass: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === value}
      data-testid={`mode-${value}`}
      disabled={state === "loading" || state === "saving"}
      onClick={() => change(value)}
      className={`h-7 flex-1 rounded-md px-3 text-sm font-medium transition-colors duration-150 disabled:cursor-wait ${mode === value ? activeClass : "text-secondary hover:text-foreground"}`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div>
        <p className="flex items-center justify-between px-0.5 pb-2 text-xs text-muted">
          <span>Gate mode</span>
          {state === "loading" && <span>Loading…</span>}
        </p>
        <div role="radiogroup" aria-label="Gate mode" className="flex gap-0.5 rounded-lg border border-line bg-surface-3 p-0.5">
          {option("ENFORCE", "Enforce", "bg-surface text-ok shadow-[0_0_0_1px_var(--line)]")}
          {option("OBSERVE", "Observe", "bg-surface text-warn shadow-[0_0_0_1px_var(--line)]")}
        </div>
        <p className="hidden px-0.5 pt-2 text-xs leading-relaxed text-muted lg:block">
          {mode === "OBSERVE" ? "Records what it would have decided. Stops nothing." : "Stops anything outside your signed rules."}
        </p>
        {state === "error" && (
          <span role="alert" className="mt-1 block text-xs text-bad">
            Could not read or change the mode. Reload.
          </span>
        )}
      </div>
      {mode === "OBSERVE" && (
        <div
          data-testid="observe-banner"
          role="status"
          className="fixed inset-x-0 top-0 z-30 flex h-9 items-center justify-center border-b border-line bg-foreground px-6 text-center text-sm font-medium text-background lg:left-64"
        >
          Observe mode: the gate records what it would have decided but does not stop any payment.
        </div>
      )}
    </>
  );
}
