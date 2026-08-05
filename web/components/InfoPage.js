import Link from "next/link";

export default function InfoPage({ kicker, title, updated, children }) {
  return (
    <div className="mx-auto max-w-3xl py-10 animate-fade-in-up sm:py-14">
      <div className="section-kicker">{kicker}</div>
      <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-5xl">
        {title}
      </h1>
      {updated && <p className="mt-3 text-xs text-faint">Last updated {updated}</p>}
      <div className="mt-9 space-y-8">{children}</div>
      <div className="mt-12 border-t border-line pt-6">
        <Link href="/" className="text-sm font-semibold text-pulse transition-colors hover:text-pulse-hover">
          ← Back to JobLookout
        </Link>
      </div>
    </div>
  );
}

export function InfoSection({ heading, children }) {
  return (
    <section>
      <h2 className="font-display text-lg font-bold text-foreground sm:text-xl">{heading}</h2>
      <div className="mt-2.5 space-y-3 text-sm leading-7 text-muted sm:text-base">{children}</div>
    </section>
  );
}
