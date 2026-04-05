import Link from "next/link";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await getSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="space-y-24 py-8">
      {/* Hero */}
      <section className="text-center animate-fade-in-up">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-line text-xs font-medium tracking-wider uppercase text-pulse bg-[rgba(34,197,94,0.08)] mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-pulse animate-pulse" />
          Monitoring 120+ companies
        </div>
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 font-display leading-[1.1]">
          Your next role,
          <br />
          <span className="text-pulse animate-pulse-glow">the moment it drops.</span>
        </h1>
        <p className="text-lg sm:text-xl text-muted max-w-xl mx-auto mb-10 leading-relaxed">
          Real-time job notifications tailored to your role, seniority, and visa
          sponsorship needs — delivered straight to Discord.
        </p>
        <Link
          href="/auth"
          className="inline-flex items-center gap-2 bg-pulse hover:bg-pulse-hover text-black text-lg font-semibold px-8 py-3.5 rounded-lg transition-all duration-200 shadow-[0_0_20px_rgba(34,197,94,0.25)] hover:shadow-[0_0_30px_rgba(34,197,94,0.4)]"
        >
          Get Started
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </Link>
      </section>

      {/* Features */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-5 stagger">
        <div className="bg-surface rounded-xl border border-line p-6 hover:border-line-hover transition-colors group">
          <div className="w-8 h-0.5 bg-pulse mb-5 group-hover:w-12 transition-all duration-300" />
          <h3 className="text-base font-semibold text-foreground mb-2 font-display">
            8 Role Categories
          </h3>
          <p className="text-muted text-sm leading-relaxed">
            Software Engineering, Data, ML/AI, DevOps, Product, Design, QA, and
            more — get alerts only for roles that match your track.
          </p>
        </div>

        <div className="bg-surface rounded-xl border border-line p-6 hover:border-line-hover transition-colors group">
          <div className="w-8 h-0.5 bg-warn mb-5 group-hover:w-12 transition-all duration-300" />
          <h3 className="text-base font-semibold text-foreground mb-2 font-display">
            Real-time or Digest
          </h3>
          <p className="text-muted text-sm leading-relaxed">
            Get notified the moment a job is posted, or choose a daily or weekly
            digest to keep your inbox quiet.
          </p>
        </div>

        <div className="bg-surface rounded-xl border border-line p-6 hover:border-line-hover transition-colors group">
          <div className="w-8 h-0.5 bg-info mb-5 group-hover:w-12 transition-all duration-300" />
          <h3 className="text-base font-semibold text-foreground mb-2 font-display">
            H1B Sponsor Filter
          </h3>
          <p className="text-muted text-sm leading-relaxed">
            Filter to companies known to sponsor H1B visas so you only see
            opportunities that are actually open to you.
          </p>
        </div>
      </section>
    </div>
  );
}
