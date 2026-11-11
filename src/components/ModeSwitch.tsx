"use client";

import { useEffect, useState } from "react";

export type Mode = "ENFORCE" | "OBSERVE";

/** Other parts of a page listen for this to stay in step with the switch. */
export const MODE_EVENT = "gate-mode-changed";

/**
 * The Enforce / Observe switch. It sits in the header of every page, and while the gate is in Observe mode
 * a full-width bar says so, because in that mode nothing is stopped.
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

  const option = (value: Mode, label: string, activeClass: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === value}
      data-testid={`mode-${value}`}
      disabled={state === "loading" || state === "saving"}
      onClick={() => change(value)}
      className={`px-4 py-1.5 text-sm font-semibold transition-colors disabled:cursor-wait ${mode === value ? activeClass : "bg-transparent text-zinc-300 hover:text-white"}`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-zinc-400">Gate</span>
        <div role="radiogroup" aria-label="Gate mode" className="flex overflow-hidden rounded-md border border-zinc-500">
          {option("ENFORCE", "Enforce", "bg-emerald-600 text-white")}
          {option("OBSERVE", "Observe", "bg-amber-500 text-black")}
        </div>
        {state === "loading" && <span className="text-xs text-zinc-400">Loading…</span>}
        {state === "error" && (
          <span role="alert" className="text-xs text-red-300">
            Could not read or change the mode. Reload.
          </span>
        )}
      </div>
      {mode === "OBSERVE" && (
        <div data-testid="observe-banner" role="status" className="absolute inset-x-0 top-full bg-amber-500 px-6 py-1.5 text-center text-sm font-semibold text-black">
          Observe mode: the gate records what it would have decided but does not stop any payment.
        </div>
      )}
    </>
  );
}
