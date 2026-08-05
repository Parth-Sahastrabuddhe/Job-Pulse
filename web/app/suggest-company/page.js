import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import SuggestCompanyForm from "@/components/SuggestCompanyForm";

export const metadata = {
  title: "Suggest a company",
  description: "Nominate a company for the JobLookout watchlist.",
};

export default async function SuggestCompanyPage() {
  const session = await getSession();
  if (!session) redirect("/auth");

  return (
    <div className="mx-auto max-w-5xl py-10 animate-fade-in-up sm:py-14">
      <div className="mb-8 max-w-2xl">
        <div className="section-kicker">Coverage</div>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-5xl">
          Suggest a company.
        </h1>
        <p className="mt-4 text-base leading-7 text-muted sm:text-lg">
          Want your target companies on the watchlist? Send them over and we&apos;ll review each one.
        </p>
      </div>
      <SuggestCompanyForm />
    </div>
  );
}
