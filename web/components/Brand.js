import Link from "next/link";

export function BrandMark({ size = 34, className = "" }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[11px] bg-pulse text-[#07100c] shadow-[0_0_0_1px_rgba(215,255,112,0.28),0_10px_30px_rgba(151,218,55,0.18)] ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 32 32" width={Math.round(size * 0.7)} height={Math.round(size * 0.7)} fill="none">
        <path d="M5 18.5a11 11 0 0 1 22 0" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M8 18.5a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".55" />
        <path d="M4.5 22.5h23" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="16" cy="16" r="2.3" fill="currentColor" />
      </svg>
    </span>
  );
}

export function BrandWordmark({ href = "/", compact = false, className = "" }) {
  const content = (
    <>
      <BrandMark size={compact ? 30 : 34} />
      <span className={`font-display font-bold tracking-[-0.045em] text-foreground ${compact ? "text-lg" : "text-xl"}`}>
        Job<span className="text-pulse">Lookout</span>
      </span>
    </>
  );

  if (!href) {
    return <div className={`inline-flex items-center gap-2.5 ${className}`}>{content}</div>;
  }

  return (
    <Link href={href} className={`inline-flex items-center gap-2.5 ${className}`} aria-label="JobLookout home">
      {content}
    </Link>
  );
}
