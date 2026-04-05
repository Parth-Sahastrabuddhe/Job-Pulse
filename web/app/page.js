import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="text-center py-16">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Job alerts from 120+ companies
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-8">
          Real-time job notifications tailored to your role, seniority, and visa
          sponsorship needs — delivered straight to Discord.
        </p>
        <Link
          href="/auth"
          className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white text-lg font-medium px-8 py-3 rounded-lg transition-colors"
        >
          Get Started
        </Link>
      </section>

      {/* Feature cards */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-3xl mb-3">🎯</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            8 Role Categories
          </h3>
          <p className="text-gray-600 text-sm">
            Software Engineering, Data, ML/AI, DevOps, Product, Design, QA, and
            more — get alerts only for roles that match your track.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-3xl mb-3">⚡</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Real-time or Digest
          </h3>
          <p className="text-gray-600 text-sm">
            Get notified the moment a job is posted, or choose a daily digest to
            keep your Discord channel quiet.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-3xl mb-3">🌎</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            H1B Sponsor Filter
          </h3>
          <p className="text-gray-600 text-sm">
            Filter to companies known to sponsor H1B visas so you only see
            opportunities that are actually open to you.
          </p>
        </div>
      </section>
    </div>
  );
}
