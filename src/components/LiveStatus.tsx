"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { describeEntry } from "@/ledger/describe";
import type { LedgerEntry } from "@/ledger/ledger";

type Snapshot = {
  mandate: { budget: number; used: number } | null;
  ledger: { ok: boolean; length: number; head: string; latest: LedgerEntry[] } | null;
  disputes: number | null;
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The running demo at a glance: the newest ledger entries, the chain's health, the budget and the disputes. */
export function LiveStatus() {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const get = (url: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    Promise.all([get("/api/mandates/latest"), get("/api/ledger/verify"), get("/api/disputes"), get("/api/ledger")]).then(([m, v, d, l]) => {
      if (cancelled) return;
      setSnap({
        mandate: m?.mandate ? { budget: m.mandate.total_budget_cents, used: m.committed_cents ?? 0 } : null,
        ledger: v && l ? { ok: Boolean(v.ok), length: v.length, head: l.head_hash ?? "", latest: (l.entries as LedgerEntry[]).slice(-6).reverse() } : null,
        disputes: Array.isArray(d?.disputes) ? d.disputes.length : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = snap === null;

  return (
    <section aria-label="The ledger of this demo, live" className="card !p-0">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <p className="text-sm font-medium">Ledger, live from the sandbox</p>
        {loading ? (
          <div className="skeleton h-5 w-28" />
        ) : snap.ledger ? (
          <p className={`badge ${snap.ledger.ok ? "badge-ok" : "badge-bad"}`}>
            {snap.ledger.length} entries, {snap.ledger.ok ? "chain verified" : "chain broken"}
          </p>
        ) : (
          <p className="badge">Unavailable</p>
        )}
      </header>

      <ol className="min-h-[19rem] divide-y divide-line">
        {loading && [0, 1, 2, 3, 4, 5].map((i) => <li key={i} className="px-5 py-3"><div className="skeleton h-5" /></li>)}
        {snap?.ledger?.latest.map((e) => (
          <li key={e.seq} className="flex items-baseline gap-3 px-5 py-2.5">
            <span className="w-8 shrink-0 font-mono text-xs text-muted">#{e.seq}</span>
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-mono text-xs text-secondary">{e.type}</span>
              <span className="block truncate text-secondary">{describeEntry(e).replace(/^#\d+ \S+ \S+: /, "")}</span>
            </span>
            <span className="hidden font-mono text-xs text-muted sm:block">{e.hash.slice(0, 8)}</span>
          </li>
        ))}
        {snap && snap.ledger?.latest.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">Empty. Sign a mandate and it becomes entry #1</li>}
      </ol>

      <dl className="grid grid-cols-2 divide-x divide-line border-t border-line text-sm">
        <div className="px-5 py-3">
          <dt className="text-xs text-muted">Budget used</dt>
          <dd className="mt-0.5 font-medium">
            {loading ? <div className="skeleton h-5 w-24" /> : snap.mandate ? `${dollars(snap.mandate.used)} of ${dollars(snap.mandate.budget)}` : "No mandate yet"}
          </dd>
        </div>
        <div className="px-5 py-3">
          <dt className="text-xs text-muted">Disputes on file</dt>
          <dd className="mt-0.5 font-medium">
            {loading ? (
              <div className="skeleton h-5 w-10" />
            ) : snap.disputes === null ? (
              "Unavailable"
            ) : (
              <Link href="/disputes" className="underline decoration-line-strong underline-offset-4 hover:decoration-foreground">
                {snap.disputes}
              </Link>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
