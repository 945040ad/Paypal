"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Status = {
  mandate: { budget: number; used: number } | null;
  ledger: { ok: boolean; length: number } | null;
  disputes: number | null;
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** A glance at the running demo: the signed budget, the ledger's health and the disputes on file. */
export function LiveStatus() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    const get = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([get("/api/mandates/latest"), get("/api/ledger/verify"), get("/api/disputes")]).then(([m, v, d]) => {
      if (cancelled) return;
      setStatus({
        mandate: m?.mandate ? { budget: m.mandate.total_budget_cents, used: m.committed_cents ?? 0 } : null,
        ledger: v ? { ok: Boolean(v.ok), length: v.length } : null,
        disputes: Array.isArray(d?.disputes) ? d.disputes.length : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = status === null;
  const used = status?.mandate ? Math.min(100, Math.round((status.mandate.used / status.mandate.budget) * 100)) : 0;

  return (
    <section aria-label="Live status of this demo" className="card rise">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Live on the sandbox</p>
        <span className="badge badge-ok">
          <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" />
          Running
        </span>
      </div>

      <dl className="mt-4 space-y-4 text-sm">
        <div>
          <dt className="flex items-center justify-between text-muted">
            <span>Budget used</span>
            <Link href="/mandate" className="text-xs font-medium text-accent hover:underline">
              Mandate
            </Link>
          </dt>
          <dd className="mt-1">
            {loading ? (
              <div className="skeleton h-6 w-40" />
            ) : status.mandate ? (
              <>
                <p className="text-lg font-semibold">
                  {dollars(status.mandate.used)} <span className="text-sm font-normal text-muted">of {dollars(status.mandate.budget)}</span>
                </p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" role="presentation">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${used}%` }} />
                </div>
              </>
            ) : (
              <p className="text-muted">No signed mandate yet</p>
            )}
          </dd>
        </div>

        <div className="flex items-center justify-between border-t border-line pt-4">
          <dt className="text-muted">Ledger</dt>
          <dd className="flex items-center gap-2 font-medium">
            {loading ? (
              <div className="skeleton h-5 w-32" />
            ) : status.ledger ? (
              <>
                {status.ledger.length} entries
                <span className={`badge ${status.ledger.ok ? "badge-ok" : "badge-bad"}`}>{status.ledger.ok ? "Chain verified" : "Chain broken"}</span>
              </>
            ) : (
              <span className="text-muted">Unavailable</span>
            )}
          </dd>
        </div>

        <div className="flex items-center justify-between border-t border-line pt-4">
          <dt className="text-muted">Disputes on file</dt>
          <dd className="font-medium">
            {loading ? (
              <div className="skeleton h-5 w-16" />
            ) : status.disputes === null ? (
              <span className="text-muted">Unavailable</span>
            ) : (
              <Link href="/disputes" className="hover:underline">
                {status.disputes} {status.disputes === 1 ? "dispute" : "disputes"}
              </Link>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
