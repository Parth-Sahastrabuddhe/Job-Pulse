// Infinite horizontal logo wall. Two rows drift in opposite directions; each
// row renders its chip sequence twice so the -50% keyframe loops seamlessly.
// Pure CSS animation, pauses on hover, effectively static under
// prefers-reduced-motion via the global media query.

function Chip({ label }) {
  return (
    <span className="flex shrink-0 items-center gap-2.5 rounded-full border border-line bg-surface/85 py-2 pl-2 pr-4">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-elevated font-display text-[10px] font-bold text-pulse">
        {label.slice(0, 2).toUpperCase()}
      </span>
      <span className="whitespace-nowrap text-sm font-semibold text-muted">{label}</span>
    </span>
  );
}

function Row({ companies, direction, duration }) {
  const group = (hidden) => (
    <div className="marquee-group" aria-hidden={hidden || undefined}>
      {companies.map((company) => (
        <Chip key={company.key} label={company.label} />
      ))}
    </div>
  );
  return (
    <div className="marquee-row">
      <div className="marquee-track" data-direction={direction} style={{ "--marquee-duration": `${duration}s` }}>
        {group(false)}
        {group(true)}
      </div>
    </div>
  );
}

export default function CompanyMarquee({ companies }) {
  const half = Math.ceil(companies.length / 2);
  const top = companies.slice(0, half);
  const bottom = companies.slice(half);
  return (
    <div className="space-y-3">
      <Row companies={top} direction="left" duration={Math.max(45, top.length * 1.9)} />
      <Row companies={bottom.length ? bottom : top} direction="right" duration={Math.max(45, (bottom.length || top.length) * 2.1)} />
    </div>
  );
}
