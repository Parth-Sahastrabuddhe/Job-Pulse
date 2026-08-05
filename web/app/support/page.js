import { getSession } from "@/lib/session";
import SupportTickets from "@/components/SupportTickets";

export const metadata = {
  title: "Support",
  description: "Ask a question or report a problem. No account needed.",
};

export default async function SupportPage() {
  const session = await getSession();

  return (
    <div className="mx-auto max-w-5xl py-10 animate-fade-in-up sm:py-14">
      <div className="mb-8 max-w-2xl">
        <div className="section-kicker">Support</div>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-[-0.04em] text-foreground sm:text-5xl">
          How can we help?
        </h1>
        <p className="mt-4 text-base leading-7 text-muted sm:text-lg">
          {session
            ? "Pick a topic and tell us what's going on. Tickets go straight into our queue, and responses show up on this page."
            : "Pick a topic and tell us what's going on. No account needed, tickets go straight into our queue."}
        </p>
      </div>
      <SupportTickets isMember={!!session} />
    </div>
  );
}
