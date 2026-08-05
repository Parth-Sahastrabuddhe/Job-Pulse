import InfoPage, { InfoSection } from "@/components/InfoPage";

export const metadata = {
  title: "About",
  description: "Why JobLookout exists and how it works.",
};

export default function AboutPage() {
  return (
    <InfoPage kicker="Trust" title="About JobLookout">
      <InfoSection heading="Why this exists">
        <p>
          JobLookout was built by an engineer in the middle of their own job search, after watching
          good roles fill up before aggregator sites ever showed them. The fix was to stop waiting
          on middlemen: watch each company&apos;s own career page directly, filter hard, and deliver
          the match the moment it appears.
        </p>
        <p>
          It started as a personal tool, worked well enough that friends asked for access, and grew
          into the service you are looking at.
        </p>
      </InfoSection>
      <InfoSection heading="How it works">
        <p>
          Collectors check company career pages around the clock, straight from the applicant
          systems the companies themselves use. Every posting is classified by role, seniority, and
          location, then matched against each member&apos;s profile: the disciplines they want, the
          level they are at, where they can work, and whether they need visa sponsorship. Matches
          arrive as Discord DMs with the application tracker built into the message.
        </p>
      </InfoSection>
      <InfoSection heading="Open source">
        <p>
          The scraping core is public on{" "}
          <a
            href="https://github.com/Parth-Sahastrabuddhe/JobPulse"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-pulse hover:underline"
          >
            GitHub
          </a>{" "}
          under an MIT license, so you can read exactly how job data is collected. Delivery and
          account infrastructure stay private.
        </p>
      </InfoSection>
      <InfoSection heading="Contact">
        <p>Members can reach us any time through the support page in the dashboard.</p>
      </InfoSection>
    </InfoPage>
  );
}
