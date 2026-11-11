import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <p className="eyebrow">Not found</p>
      <h1 className="page-title mt-1">There is no page at this address</h1>
      <p className="lede">Use the links at the top, or start from the overview.</p>
      <Link href="/" className="btn btn-primary mt-6">
        Go to the overview
      </Link>
    </main>
  );
}
