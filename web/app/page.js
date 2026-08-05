import Link from "next/link";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";
import { getLandingSnapshot } from "@/lib/live-stats";
import { getGroupedCompanies } from "@/lib/companies";
import { BrandWordmark } from "@/components/Brand";
import CompanyMarquee from "@/components/CompanyMarquee";
import DiscordEmbedDemo from "@/components/DiscordEmbedDemo";

const FEATURES = [
  {
    number: "01",
    title: "Closer to the source",
    copy: "JobLookout watches company career pages directly, straight from each employer's own applicant system, so you see openings before aggregator feeds catch up.",
  },
  {
    number: "02",
    title: "Only the roles that fit",
    copy: "Filter by discipline, seniority, location, education and sponsorship needs. Your alert feed stays useful instead of noisy.",
  },
  {
    number: "03",
    title: "From alert to outcome",
    copy: "Track every application, interview and offer in one place, with a calendar that shows the momentum of your search.",
  },
];

function ArrowIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 9h11M10 4.5 14.5 9 10 13.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 8.5 3.2 3.2L13 5" />
    </svg>
  );
}

function buildFaq(snapshot) {
  const median = snapshot.stats?.[3]?.value || "minutes";
  const companies = snapshot.companiesWatched
    ? snapshot.companiesWatched.toLocaleString("en-US")
    : "190+";
  return [
    {
      q: "Is JobLookout free?",
      a: "Yes. Alerts, filters and the application tracker are all free. No card, no paid tier.",
    },
    {
      q: "Why does it need Discord?",
      a: "Alerts arrive as Discord DMs, so connecting Discord is how we know where to deliver. Each DM carries buttons that update your tracker in place, which email digests cannot do.",
    },
    {
      q: "How fast are the alerts?",
      a: `Career pages are checked around the clock. Over the last two weeks the median gap between a company posting a role and the alert reaching a member was ${median}.`,
    },
    {
      q: "Which companies are covered?",
      a: `${companies} companies today, watched directly on their own careers sites. The wall above scrolls through the current watchlist, and you can suggest missing ones after signing up.`,
    },
    {
      q: "Does it understand visa sponsorship?",
      a: "Yes. Tell it you need work-visa sponsorship and it works for you: postings whose text rules out sponsorship get flagged before you spend an application, and for US roles each alert shows the company's sponsorship track record from public H-1B visa filings.",
    },
    {
      q: "What data do you keep?",
      a: "Your Discord ID and username, email, a password hash, and your alert preferences. Nothing else. The privacy policy has the full list.",
    },
    {
      q: "Which countries does it cover?",
      a: "United States and Canada today. You choose per profile, and roles from other regions are filtered out before they ever reach you.",
    },
    {
      q: "Is it open source?",
      a: "The scraping core is public on GitHub under an MIT license. Delivery and account infrastructure stay private.",
    },
    {
      q: "What's coming next?",
      a: "An AI fit check that reads each posting against your resume is built and in private testing, India coverage is on the roadmap, and new companies join the watchlist continuously through member suggestions.",
    },
  ];
}

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const snapshot = getLandingSnapshot();
  let companyList = null;
  try {
    const groups = getGroupedCompanies();
    companyList = Object.values(groups || {}).flat();
    if (companyList.length === 0) companyList = null;
  } catch {
    companyList = null;
  }
  const faq = buildFaq(snapshot);

  return (
    <div className="overflow-hidden">
      <section className="grid min-h-[calc(100vh-8rem)] grid-cols-1 items-center gap-12 py-10 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16 lg:py-16">
        <div className="min-w-0 animate-fade-in-up">
          <div className="mb-7 inline-flex items-center gap-2.5 rounded-full border border-line bg-surface/80 px-3.5 py-2 text-xs font-semibold text-muted shadow-lg">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pulse opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-pulse" />
            </span>
            {snapshot.live && snapshot.companiesWatched
              ? `Live across ${snapshot.companiesWatched.toLocaleString("en-US")} company career pages`
              : "Live across 190+ company career pages"}
          </div>

          <h1 className="max-w-3xl font-display text-[clamp(3.2rem,7vw,6.8rem)] font-bold leading-[0.91] tracking-[-0.07em] text-foreground">
            See the role.
            <span className="mt-2 block text-pulse">Before the crowd.</span>
          </h1>

          <p className="mt-7 max-w-xl text-lg leading-8 text-muted sm:text-xl">
            JobLookout monitors the companies you care about, filters every opening to your profile, and delivers the signal straight to Discord.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/auth?mode=register" className="primary-button px-6 py-3.5 text-base">
              Start your lookout <ArrowIcon />
            </Link>
            <a href="#how-it-works" className="secondary-button px-6 py-3.5 text-base">
              See how it works
            </a>
          </div>

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            {["No job-board noise", "Visa-aware filters", "Free, no card required"].map((item) => (
              <span key={item} className="inline-flex items-center gap-2">
                <span className="text-pulse"><CheckIcon /></span>{item}
              </span>
            ))}
          </div>
        </div>

        <div className="relative mx-auto w-full min-w-0 max-w-[620px] animate-fade-in-up lg:mx-0" style={{ animationDelay: "100ms" }}>
          <div className="absolute -inset-16 -z-10 rounded-full bg-[radial-gradient(circle,rgba(215,255,112,0.11),transparent_66%)] blur-2xl" />
          <div className="surface-card relative overflow-hidden rounded-[28px] p-3 sm:p-4">
            <div className="radar-grid absolute inset-0 opacity-60" />
            <div className="scan-line absolute left-5 right-5 top-0 h-px bg-gradient-to-r from-transparent via-pulse to-transparent shadow-[0_0_22px_rgba(215,255,112,0.85)]" />

            <div className="relative rounded-[22px] border border-line/80 bg-[rgba(7,16,14,0.86)] p-4 backdrop-blur sm:p-5">
              <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
                <div>
                  <div className="section-kicker">Live lookout</div>
                  <div className="mt-1 font-display text-lg font-bold text-foreground">Fresh matches</div>
                </div>
                <div className="flex items-center gap-2 rounded-full border border-[rgba(215,255,112,0.18)] bg-[rgba(215,255,112,0.07)] px-3 py-1.5 text-xs font-semibold text-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-pulse" /> {snapshot.live ? "Scanning now" : "Sample matches"}
                </div>
              </div>

              <div className="mt-3 space-y-2.5">
                {snapshot.feed.map((job, index) => (
                  <div key={`${job.company}-${index}`} className="group flex items-center gap-3 rounded-2xl border border-line/80 bg-surface/85 p-3.5 transition-all hover:-translate-y-0.5 hover:border-line-hover hover:bg-surface-hover sm:p-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-elevated font-display text-sm font-bold text-pulse">
                      {job.company.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold text-foreground sm:text-base">{job.role}</span>
                        {index === 0 && <span className="rounded-md bg-pulse px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#07100c]">new</span>}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted">{job.company} · {job.meta}</div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-faint">{job.age}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-dashed border-line px-3.5 py-3 text-xs text-muted">
                {snapshot.live && snapshot.latestMatchAge ? (
                  <>
                    <span>Newest posting spotted across all watchlists</span>
                    <span className="shrink-0 font-mono font-semibold text-pulse">{snapshot.latestMatchAge} ago</span>
                  </>
                ) : (
                  <span>Scanning selected career pages around the clock</span>
                )}
              </div>
            </div>
          </div>

          <div className="animate-float absolute -bottom-5 -left-3 hidden rounded-2xl border border-line bg-elevated/95 px-4 py-3 shadow-2xl backdrop-blur sm:block">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-faint">Delivery</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="h-2 w-2 rounded-full bg-[#5865f2]" /> Discord connected
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-line py-8">
        <div className="grid grid-cols-2 gap-y-7 sm:grid-cols-4 sm:divide-x sm:divide-line">
          {snapshot.stats.map((stat) => (
            <div key={stat.label} className="px-3 text-center sm:px-6">
              <div className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-4xl">{stat.value}</div>
              <div className="mt-1 text-[11px] text-muted sm:text-sm">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-24 py-24 sm:py-28">
        <div className="mb-12 max-w-2xl">
          <div className="section-kicker">Built for the first move</div>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-5xl">
            Less searching. More intentional applying.
          </h2>
          <p className="mt-4 text-base leading-7 text-muted sm:text-lg">
            A focused pipeline from first discovery to final outcome, without another noisy job board in the middle.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <article key={feature.number} className="surface-card group rounded-2xl p-6 transition-transform duration-300 hover:-translate-y-1 sm:p-7">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-pulse">{feature.number}</span>
                <span className="h-px w-12 bg-line transition-all group-hover:w-20 group-hover:bg-pulse" />
              </div>
              <h3 className="mt-10 font-display text-xl font-bold tracking-tight text-foreground">{feature.title}</h3>
              <p className="mt-3 text-sm leading-6 text-muted sm:text-base sm:leading-7">{feature.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="alert" className="scroll-mt-24 border-t border-line py-24 sm:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <div className="min-w-0">
            <div className="section-kicker">The deliverable</div>
            <h2 className="mt-4 font-display text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-5xl">
              This is what lands in your DMs.
            </h2>
            <p className="mt-4 max-w-lg text-base leading-7 text-muted sm:text-lg">
              One message per matching role, minutes after it goes live. No digest to dig through, no tab full of job boards.
            </p>
            <ul className="mt-7 space-y-3 text-sm text-muted sm:text-base">
              {[
                "Buttons update your application tracker in place",
                "Sponsorship track record for US roles, from public H-1B filings",
                "Level equivalents (SDE 2 / L4 style) when a title matches a known ladder",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-1 text-pulse"><CheckIcon /></span>{item}
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <DiscordEmbedDemo />
            <p className="mt-3 text-center text-xs text-faint">Exact layout of a real alert, shown with sample data.</p>
          </div>
        </div>
      </section>

      {companyList && (
        <section id="companies" className="scroll-mt-24 border-t border-line py-24 sm:py-28">
          <div className="mb-10 max-w-2xl">
            <div className="section-kicker">Coverage</div>
            <h2 className="mt-4 font-display text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-5xl">
              Already watching your target list.
            </h2>
            <p className="mt-4 text-base leading-7 text-muted sm:text-lg">
              {companyList.length} companies, checked around the clock on their own careers pages.
              Missing one you care about? Suggest it after signing up.
            </p>
          </div>
          <CompanyMarquee companies={companyList} />
        </section>
      )}

      <section id="faq" className="scroll-mt-24 border-t border-line py-24 sm:py-28">
        <div className="mb-10 max-w-2xl">
          <div className="section-kicker">Questions</div>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-5xl">
            Answers before you ask.
          </h2>
        </div>
        <div className="mx-auto grid gap-3 lg:grid-cols-2">
          {faq.map((item) => (
            <details key={item.q} className="faq-item surface-card rounded-2xl px-5 py-4 sm:px-6">
              <summary className="flex items-center justify-between gap-4 text-sm font-semibold text-foreground sm:text-base">
                {item.q}
                <span className="faq-chevron shrink-0 text-pulse" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-6 text-muted">
                {item.a}
                {item.q === "Is it open source?" && (
                  <>
                    {" "}
                    <a href="https://github.com/Parth-Sahastrabuddhe/JobPulse" target="_blank" rel="noreferrer" className="font-semibold text-pulse hover:underline">
                      View the code
                    </a>
                    .
                  </>
                )}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="surface-card relative overflow-hidden rounded-[28px] px-6 py-12 text-center sm:px-12 sm:py-16">
        <div className="radar-grid absolute inset-0 opacity-40" />
        <div className="relative mx-auto max-w-2xl">
          <div className="section-kicker">Your next role is already moving</div>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-[-0.045em] text-foreground sm:text-5xl">Put JobLookout on watch.</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">Set your preferences once. We&rsquo;ll keep an eye on the sources and send the right openings to you.</p>
          <Link href="/auth?mode=register" className="primary-button mt-8 px-6 py-3.5">
            Create your lookout <ArrowIcon />
          </Link>
          <p className="mt-4 text-xs text-faint">Free · about 2 minutes to set up · no card required</p>
        </div>
      </section>

      <footer className="mt-14 border-t border-line pt-12">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="max-w-xs">
            <BrandWordmark />
            <p className="mt-4 text-sm leading-6 text-muted">
              Source-direct job discovery, built for focused searches.
            </p>
            <p className="mt-3 text-xs leading-5 text-faint">
              Job data comes from public company career pages.
            </p>
          </div>
          {[
            {
              title: "Product",
              links: [
                { label: "How it works", href: "#how-it-works" },
                { label: "Your alerts", href: "#alert" },
                { label: "Companies", href: "#companies" },
                { label: "FAQ", href: "#faq" },
              ],
            },
            {
              title: "Account",
              links: [
                { label: "Create account", href: "/auth?mode=register" },
                { label: "Log in", href: "/auth" },
                { label: "Support", href: "/support" },
              ],
            },
            {
              title: "Trust",
              links: [
                { label: "About", href: "/about" },
                { label: "Privacy", href: "/privacy" },
                { label: "Terms", href: "/terms" },
                { label: "GitHub", href: "https://github.com/Parth-Sahastrabuddhe/JobPulse", external: true },
              ],
            },
          ].map((column) => (
            <div key={column.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-faint">{column.title}</h3>
              <ul className="mt-3.5 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a href={link.href} target="_blank" rel="noreferrer" className="text-sm text-muted transition-colors hover:text-foreground">
                        {link.label}
                      </a>
                    ) : (
                      <a href={link.href} className="text-sm text-muted transition-colors hover:text-foreground">
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-line pb-1 pt-6 text-xs text-faint sm:flex-row">
          <span>© {new Date().getFullYear()} JobLookout</span>
          <span>Made for people who apply early.</span>
        </div>
      </footer>
    </div>
  );
}
