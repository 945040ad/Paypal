"use client";

/** Shown when a page fails to render. Nothing about the failure is exposed beyond a reference code. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="page-title mt-1">This page could not be shown</h1>
      <p className="lede">Your data is safe: the ledger is only ever added to, so nothing was lost or changed. Try the page again.</p>
      {error.digest && <p className="mt-3 font-mono text-xs text-muted">Reference {error.digest}</p>}
      <button type="button" className="btn btn-primary mt-6" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
