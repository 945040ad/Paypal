import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { LiveStatus } from "@/components/LiveStatus";

const STEPS = [
  {
    href: "/mandate",
    title: "Sign your rules",
    body: "Say in plain words what the agent may spend. Review the drafted rules, then sign them with a key that stays in this browser.",
  },
  {
    href: "/agent",
    title: "Let the agent shop",
    body: "Ask it to buy something from the demo store. It can only propose; the gate checks each proposal against your signed rules and PayPal's sandbox takes the payment.",
  },
  {
    href: "/ledger",
    title: "Check the record",
    body: "See every step in the hash-chained ledger. Verify the chain, then tamper with a row and watch verification fail.",
  },
  {
    href: "/disputes",
    title: "Settle a dispute",
    body: "When the buyer disputes a payment in PayPal, the ledger shows which side is right. File the proof, or refund without argument.",
  },
];

const WHO = [
  ["Drafting your rules from a sentence", "AI model", "You review and sign; nothing is stored unsigned"],
  ["Searching the store and proposing a purchase", "AI model", "It can only propose; page text is treated as untrusted"],
  ["Allowing, escalating or blocking a payment", "Plain code", "Seven rules checked against the signed mandate"],
  ["Writing the ledger and moving money", "Plain code", "Hash chain; PayPal's order is re-checked before capture"],
  ["Deciding which side a dispute favours", "Plain code", "Read straight from the ledger"],
  ["Writing the evidence notes", "AI model", "Code rejects any ledger entry it cites that does not exist"],
];

export default function Home() {
  return (
    <main className="page">
      <div className="grid grid-cols-1 items-center gap-10 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div>
          <p className="eyebrow">A flight recorder for AI agents that pay with PayPal</p>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.08] tracking-[-0.02em] sm:text-[3.5rem]">
            When an AI agent spends your money, who can prove what you allowed
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-secondary">
            Verdict records what you allowed a shopping agent to do and what it actually did. Plain code checks every purchase against rules you
            signed. If a payment is disputed, the record settles it for whichever side is right.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/mandate" className="group btn btn-primary btn-lg">
              Sign your rules
              <ArrowRight aria-hidden="true" size={16} strokeWidth={1.5} className="arrow-nudge" />
            </Link>
            <Link href="/disputes" className="btn btn-lg">
              See a settled dispute
            </Link>
          </div>
        </div>
        <LiveStatus />
      </div>

      <section className="mt-16 grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[16rem_1fr]">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.01em]">Try it in four steps</h2>
          <p className="mt-2 text-sm text-secondary">Each takes under a minute. The numbers match the sidebar</p>
        </div>
        <ol className="card stagger divide-y divide-line !p-0">
          {STEPS.map((step, i) => (
            <li key={step.href}>
              <Link href={step.href} className="group flex items-start gap-4 px-5 py-4 transition-colors duration-150 hover:bg-surface-2">
                <span aria-hidden="true" className="w-4 pt-0.5 font-mono text-sm text-muted">
                  {i + 1}
                </span>
                <span className="flex-1">
                  <span className="block font-medium">{step.title}</span>
                  <span className="mt-1 block max-w-2xl text-sm leading-relaxed text-secondary">{step.body}</span>
                </span>
                <ArrowRight aria-hidden="true" size={16} strokeWidth={1.5} className="arrow-nudge mt-1 shrink-0 text-muted group-hover:text-foreground" />
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16 grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[16rem_1fr]">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.01em]">The two disputes it settles</h2>
          <p className="mt-2 text-sm text-secondary">Both are real PayPal sandbox disputes, open on the Disputes page</p>
        </div>
        <div className="card grid grid-cols-1 !p-0 md:grid-cols-2 md:divide-x md:divide-line">
          <section className="p-5">
            <p className="font-mono text-xs text-muted">Case A, PP-R-WSK-10198178</p>
            <h3 className="mt-2 font-medium">The purchase was inside the mandate</h3>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              The agent bought within the signed rules and the buyer disputes it anyway. The desk builds an evidence PDF with the signed mandate, the
              signature check and the ledger extract, and files it with PayPal.
            </p>
            <p className="mt-4 text-sm font-medium text-ok">The case settles for the seller</p>
          </section>
          <section className="border-t border-line p-5 md:border-t-0">
            <p className="font-mono text-xs text-muted">Case B, PP-R-BQE-10198182</p>
            <h3 className="mt-2 font-medium">The agent exceeded the mandate</h3>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              The gate was only observing, the agent overspent, and the ledger holds a violation entry. The same record now speaks for the buyer: the
              desk accepts the claim and refunds in full.
            </p>
            <p className="mt-4 text-sm font-medium text-bad">The buyer gets the money back</p>
          </section>
        </div>
      </section>

      <section className="mt-16 grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[16rem_1fr]">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.01em]">Who decides what</h2>
          <p className="mt-2 text-sm text-secondary">The model never decides whether a payment is allowed and never writes to the ledger</p>
        </div>
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-normal">Job</th>
                <th scope="col" className="px-5 py-2.5 font-normal">Done by</th>
                <th scope="col" className="px-5 py-2.5 font-normal">Safeguard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {WHO.map(([job, by, guard]) => (
                <tr key={job}>
                  <td className="px-5 py-3">{job}</td>
                  <td className={`whitespace-nowrap px-5 py-3 ${by === "Plain code" ? "font-medium" : "text-secondary"}`}>{by}</td>
                  <td className="px-5 py-3 text-secondary">{guard}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
