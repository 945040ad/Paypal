"use client";

import { ThinkingOrb } from "thinking-orbs";

export type OrbState = "working" | "searching" | "solving" | "listening" | "connecting" | "weaving" | "composing" | "breathing" | "shaping";

/**
 * The app's one "something is happening" indicator: a dotted orb whose motion says what kind of work it is.
 * `onDark` flips the dots to light for use on the black sidebar or an orange button.
 */
export function Orb({ state = "working", size = 20, onDark = false, label, className }: { state?: OrbState; size?: 20 | 64; onDark?: boolean; label?: string; className?: string }) {
  return <ThinkingOrb state={state} size={size} theme={onDark ? "dark" : "light"} aria-label={label} className={`shrink-0 ${className ?? ""}`} />;
}

/** A waiting panel: a large orb with one line saying what is being waited for. */
export function OrbPanel({ state, title, detail }: { state: OrbState; title: string; detail?: string }) {
  return (
    <div role="status" className="fade-in flex items-center gap-4 rounded-xl border border-line bg-surface px-5 py-4">
      <Orb state={state} size={64} />
      <div>
        <p className="font-medium">{title}</p>
        {detail && <p className="mt-0.5 text-sm text-secondary">{detail}</p>}
      </div>
    </div>
  );
}
