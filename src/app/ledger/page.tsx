"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { describeEntry } from "@/ledger/describe";
import type { LedgerEntry, VerifyResult } from "@/ledger/ledger";
import { Orb, OrbPanel } from "@/components/Orb";

type Export = { length: number; head_hash: string; entries: LedgerEntry[] };
type Notice = { tone: "ok" | "bad" | "warn"; text: string } | null;

const FAMILY: Record<string, { label: string; chip: string; dot: string }> = {
  mandate: { label: "Mandate", chip: "text-foreground", dot: "bg-foreground" },
  gate: { label: "Gate", chip: "text-secondary", dot: "bg-muted" },
  paypal: { label: "PayPal", chip: "text-secondary", dot: "bg-muted" },
  dispute: { label: "Dispute", chip: "text-warn", dot: "bg-warn" },
  alarm: { label: "Alarm", chip: "text-bad", dot: "bg-bad" },
};

function familyOf(type: string): keyof typeof FAMILY {
  if (type === "MANDATE_SIGNED") return "mandate";
  if (["VIOLATION", "UNMATCHED_CAPTURE", "RECHECK_FAILED"].includes(type)) return "alarm";
  if (["INTENT", "DECISION", "APPROVAL"].includes(type)) return "gate";
  if (type.startsWith("DISPUTE_") || type === "EVIDENCE_SUBMITTED" || type === "CLAIM_ACCEPTED") return "dispute";
  return "paypal";
}

const time = (ts: string) => ts.replace("T", " ").replace(/\.\d+Z$/, " UTC");

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? `Request failed (${res.status}).`);
  return json as T;
}

export default function LedgerPage() {
  const [data, setData] = useState<Export | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [tampered, setTampered] = useState(false);
  const [busy, setBusy] = useState<"verify" | "tamper" | "reset" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    const [ledger, flag] = await Promise.all([getJson<Export>("/api/ledger"), getJson<{ tampered: boolean }>("/api/ledger/tamper")]);
    setData(ledger);
    setTampered(flag.tampered);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getJson<Export>("/api/ledger"), getJson<{ tampered: boolean }>("/api/ledger/tamper")])
      .then(([ledger, flag]) => {
        if (cancelled) return;
        setData(ledger);
        setTampered(flag.tampered);
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : "Could not load the ledger."));
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(kind: "verify" | "tamper" | "reset") {
    setBusy(kind);
    setNotice(null);
    try {
      if (kind === "verify") {
        setVerify(await getJson<VerifyResult>("/api/ledger/verify"));
      } else if (kind === "tamper") {
        const r = await getJson<{ seq: number; type: string }>("/api/ledger/tamper", { method: "POST" });
        setVerify(null);
        setNotice({ tone: "warn", text: `Entry #${r.seq} (${r.type}) was edited directly in the database, without going through the ledger. Press Verify the chain.` });
      } else {
        const r = await getJson<{ restored: boolean; seq: number | null }>("/api/ledger/reset", { method: "POST" });
        setVerify(null);
        setNotice({ tone: "ok", text: r.restored ? `Entry #${r.seq} was put back as it was. Press Verify the chain.` : "Nothing was tampered with, so there was nothing to reset." });
      }
      if (kind !== "verify") await load();
    } catch (err) {
      setNotice({ tone: "bad", text: err instanceof Error ? err.message : "That did not work. Try again." });
    } finally {
      setBusy(null);
    }
  }

  const badSeq = verify && !verify.ok ? verify.first_bad_seq : null;
  const newestFirst = data ? [...data.entries].reverse() : [];

  return (
    <main className="page">
      <p className="eyebrow">Flight recorder</p>
      <h1 className="page-title mt-1">Ledger</h1>
      <p className="lede">
        Every step is written here once and never changed. Each entry carries a hash of itself and of the entry before it, so editing any entry
        breaks the chain from that point on. Anyone can export the chain and check it.
      </p>

      {loadError && (
        <p role="alert" className="notice notice-bad mt-6">
          {loadError} Reload the page to try again.
        </p>
      )}

      {!data && !loadError && (
        <div className="mt-8" aria-busy="true">
          <OrbPanel state="weaving" title="Loading the ledger" detail="Reading every entry in the chain" />
        </div>
      )}

      {data && (
        <>
          <section className="card mt-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-muted">Head hash</p>
                <p data-testid="head-hash" className="mt-1 break-all font-mono text-sm">{data.head_hash}</p>
                <p className="mt-2 text-sm text-muted">
                  {data.length} {data.length === 1 ? "entry" : "entries"}. The head hash commits to every one of them.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" data-testid="verify" className="btn btn-primary" disabled={busy !== null} onClick={() => run("verify")}>
                  {busy === "verify" && <Orb state="solving" onDark />}
                  {busy === "verify" ? "Verifying…" : "Verify the chain"}
                </button>
                <a className="btn" href="/api/ledger?download=1" download>
                  Export JSON
                </a>
              </div>
            </div>

            {verify?.ok && (
              <p data-testid="verify-result" data-ok="true" role="status" className="rise mt-5 flex items-center gap-3 rounded-lg bg-ok px-4 py-3 text-base font-medium text-white">
                <Check aria-hidden="true" size={18} strokeWidth={1.5} className="shrink-0" />
                Chain verified. All {verify.length} entries match their hashes and link to the one before.
              </p>
            )}
            {verify && !verify.ok && (
              <p data-testid="verify-result" data-ok="false" role="alert" className="rise mt-5 flex items-center gap-3 rounded-lg bg-bad px-4 py-3 text-base font-medium text-white">
                <TriangleAlert aria-hidden="true" size={18} strokeWidth={1.5} className="shrink-0" />
                Chain broken at entry #{verify.first_bad_seq}. {verify.reason} Nothing from that entry onward can be trusted.
              </p>
            )}
          </section>

          <section className="mt-4 rounded-xl border border-dashed border-line-strong p-5">
            <p className="badge badge-warn">Demo only</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-xl text-sm text-muted">
                Play the attacker: change one stored entry directly in the database, behind the ledger&apos;s back, then verify. Reset puts the entry
                back.
                {tampered && <span className="ml-1 font-semibold text-bad">One entry is currently tampered with.</span>}
              </p>
              <div className="flex gap-3">
                <button type="button" data-testid="tamper" className="btn btn-warn" disabled={busy !== null || data.length === 0} onClick={() => run("tamper")}>
                  {busy === "tamper" && <Orb state="shaping" />}
                  {busy === "tamper" ? "Editing…" : "Tamper with a row"}
                </button>
                <button type="button" data-testid="reset" className="btn" disabled={busy !== null || !tampered} onClick={() => run("reset")}>
                  {busy === "reset" && <Orb state="working" />}
                  {busy === "reset" ? "Resetting…" : "Reset"}
                </button>
              </div>
            </div>
          </section>

          {notice && (
            <p data-testid="notice" role="status" className={`notice notice-${notice.tone} rise mt-4`}>
              {notice.text}
            </p>
          )}

          <section className="mt-8" aria-label="Ledger entries">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Entries, newest first</h2>
              <ul className="flex flex-wrap gap-2 text-xs">
                {Object.entries(FAMILY).map(([key, f]) => (
                  <li key={key} className={`flex items-center gap-1.5 ${f.chip}`}>
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${f.dot}`} />
                    {f.label}
                  </li>
                ))}
              </ul>
            </div>

            {data.length === 0 ? (
              <p className="card mt-4 text-sm text-muted">
                The ledger is empty. Sign a mandate on the Mandate page and it becomes entry #1; every agent proposal, gate decision and PayPal event
                follows.
              </p>
            ) : (
              <ol className="card stagger mt-4 !p-0 [&>li+li]:border-t [&>li+li]:border-t-line">
                {newestFirst.map((e) => {
                  const f = FAMILY[familyOf(e.type)];
                  const broken = badSeq !== null && e.seq === badSeq;
                  const untrusted = badSeq !== null && e.seq > badSeq;
                  return (
                    <li
                      key={e.seq}
                      data-testid="entry"
                      data-seq={e.seq}
                      data-broken={broken}
                      className={`relative py-3 pl-10 pr-5 first:rounded-t-xl last:rounded-b-xl ${broken ? "shadow-[inset_3px_0_0_var(--bad)]" : ""} ${untrusted ? "opacity-50" : ""}`}
                    >
                      <span aria-hidden="true" className={`absolute left-4 top-[1.2rem] h-1.5 w-1.5 rounded-full ${broken ? "bg-bad" : f.dot}`} />
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-mono text-sm font-semibold">#{e.seq}</span>
                        <span className={`font-mono text-xs ${f.chip}`}>{e.type}</span>
                        <span className="font-mono text-xs text-muted">{time(e.ts)}</span>
                        {broken && <span className="text-xs font-semibold text-bad">does not match its hash</span>}
                        {untrusted && <span className="text-xs text-muted">after the break</span>}
                      </div>
                      <p className="mt-1 text-sm">{describeEntry(e).replace(/^#\d+ \S+ \S+: /, "") || "(no summary)"}</p>
                      <p className="mt-1 font-mono text-[0.7rem] text-muted">
                        prev {e.prev_hash.slice(0, 12)}… → hash {e.hash.slice(0, 12)}…
                        {e.intent_id && <span className="ml-3">{e.intent_id}</span>}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </>
      )}
    </main>
  );
}
