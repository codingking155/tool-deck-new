import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <p className="text-sm font-semibold tracking-wider text-brand">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">This page isn&apos;t a store — or anything else</h1>
      <p className="mt-3 text-muted">To check a website, put its domain after the slash, like /example.com.</p>
      <Link href="/" className="mt-6 inline-flex h-11 items-center rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-hover">
        Back to the checker
      </Link>
    </div>
  );
}
