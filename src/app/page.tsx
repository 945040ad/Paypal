import Link from "next/link";
import { LiveStatus } from "@/components/LiveStatus";

const STEPS = [
  {
    href: "/mandate",
    title: "Sign your rules",
    body: "Say in plain words what the agent may spend. Review the drafted rules, then sign them with a key that stays in this browser.",
    cta: "Open Mandate",
  },
  {
    href: "/agent",
    title: "Let the agent shop",
    body: "Ask it to buy something from the demo store. It can only propose; the gate checks each proposal against your signed rules and PayPal's sandbox takes the payment.",
    cta: "Open Agent",
  },
  {
    href: "/ledger",
    title: "Check the record",
    body: "See every step in the hash-chained ledger. Verify the chain, then tamper with a row and watch verification fail.",
    cta: "Open Ledger",
  },
  {
    href: "/disputes",
    title: "Settle a dispute",
    body: "When the buyer disputes a payment in PayPal, the ledger shows which side is right. File the proof, or refund without argument.",
    cta: "Open Disputes",
  },
];

const FLOW = [
  { label: "You sign rules", sub: "Mandate" },
  { label: "Agent proposes", sub: "AI model" },
  { label: "Gate decides", sub: "Plain code" },
  { label: "PayPal pays", sub: "Sandbox" },
  { label: "Ledger records", sub: "Hash chain" },
];

export default function Home() {
  return (
    <main className="page">
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="rise">
          <p className="eyebrow">A flight recorder for AI agents that pay with PayPal</p>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            When an AI agent spends your money, who can prove <span className="text-accent">what you allowed?</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
            Verdict records what you allowed an AI shopping agent to do and what it actually did. Plain code checks every purchase against rules you
            signed, and if a payment is disputed, the record settles it for whichever side is right.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/mandate" className="btn btn-accent">
              Start: sign your rules
            </Link>
            <Link href="/disputes" className="btn">
              See a settled dispute
            </Link>
          </div>
        </div>
        <LiveStatus />
      </div>

      <ol aria-label="How a purchase flows" className="card mt-10 grid grid-cols-2 gap-x-2 gap-y-4 sm:grid-cols-5">
        {FLOW.map((f, i) => (
          <li key={f.label} className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
              {i + 1}
            </span>
            <span>
              <span className="block text-sm font-semibold leading-tight">{f.label}</span>
              <span className="block text-xs text-muted">{f.sub}</span>
            </span>
          </li>
        ))}
      </ol>

      <h2 className="mt-14 text-2xl font-semibold tracking-tight">Try it in four steps</h2>
      <p className="mt-1 text-muted">Each step takes under a minute. The numbers match the tabs at the top.</p>
      <ol className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        {STEPS.map((step, i) => (
          <li key={step.href}>
            <Link href={step.href} className="card group flex h-full gap-4 transition-all hover:-translate-y-0.5 hover:border-accent">
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-white">
                {i + 1}
              </span>
              <span className="flex flex-col">
                <span className="text-lg font-semibold">{step.title}</span>
                <span className="mt-1 flex-1 text-sm leading-relaxed text-muted">{step.body}</span>
                <span className="mt-3 text-sm font-semibold text-accent">
                  {step.cta} <span aria-hidden="true" className="inline-block transition-transform group-hover:translate-x-1">→</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <h2 className="mt-14 text-2xl font-semibold tracking-tight">The two disputes it settles</h2>
      <p className="mt-1 text-muted">Both are real PayPal sandbox disputes, open on the Disputes page.</p>
      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="card">
          <p className="badge badge-ok">Case A</p>
          <h3 className="mt-1 text-lg font-semibold">The purchase was inside the mandate</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The agent bought within the signed rules and the buyer disputes it anyway. The desk builds an evidence PDF with the signed mandate, the
            signature check and the ledger extract, and files it with PayPal.
          </p>
          <p className="mt-3 text-sm font-semibold text-ok">The case settles for the seller.</p>
        </section>
        <section className="card">
          <p className="badge badge-bad">Case B</p>
          <h3 className="mt-1 text-lg font-semibold">The agent exceeded the mandate</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The gate was only observing, the agent overspent, and the ledger holds a violation entry. The same record now speaks for the buyer: the
            desk accepts the claim and refunds in full.
          </p>
          <p className="mt-3 text-sm font-semibold text-bad">The buyer gets the money back.</p>
        </section>
      </div>

      <h2 className="mt-14 text-2xl font-semibold tracking-tight">Who decides what</h2>
      <p className="mt-1 text-muted">The AI model never decides whether a payment is allowed and never writes to the ledger.</p>
      <div className="card mt-5 overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold">Job</th>
              <th scope="col" className="px-5 py-3 font-semibold">Done by</th>
              <th scope="col" className="px-5 py-3 font-semibold">Safeguard</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr>
              <td className="px-5 py-3">Drafting your rules from a sentence</td>
              <td className="px-5 py-3">AI model</td>
              <td className="px-5 py-3 text-muted">You review and sign; nothing is stored unsigned</td>
            </tr>
            <tr>
              <td className="px-5 py-3">Searching the store and proposing a purchase</td>
              <td className="px-5 py-3">AI model</td>
              <td className="px-5 py-3 text-muted">It can only propose; page text is treated as untrusted</td>
            </tr>
            <tr>
              <td className="px-5 py-3">Allowing, escalating or blocking a payment</td>
              <td className="px-5 py-3 font-semibold">Plain code</td>
              <td className="px-5 py-3 text-muted">Seven rules checked against the signed mandate</td>
            </tr>
            <tr>
              <td className="px-5 py-3">Writing the ledger and moving money</td>
              <td className="px-5 py-3 font-semibold">Plain code</td>
              <td className="px-5 py-3 text-muted">Hash chain; PayPal&apos;s order is re-checked before capture</td>
            </tr>
            <tr>
              <td className="px-5 py-3">Deciding which side a dispute favours</td>
              <td className="px-5 py-3 font-semibold">Plain code</td>
              <td className="px-5 py-3 text-muted">Read straight from the ledger</td>
            </tr>
            <tr>
              <td className="px-5 py-3">Writing the evidence notes</td>
              <td className="px-5 py-3">AI model</td>
              <td className="px-5 py-3 text-muted">Code rejects any ledger entry it cites that does not exist</td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  );
}
