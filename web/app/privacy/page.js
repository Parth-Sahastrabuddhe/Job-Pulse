import InfoPage, { InfoSection } from "@/components/InfoPage";

export const metadata = {
  title: "Privacy",
  description: "What JobLookout stores, why, and how to remove it.",
};

export default function PrivacyPage() {
  return (
    <InfoPage kicker="Trust" title="Privacy policy" updated="August 2026">
      <InfoSection heading="What we store">
        <p>
          When you create an account we store your Discord ID and username, your first name, your
          email address, a hash of your password (never the password itself), and the alert
          preferences you set: role categories, seniority, location, education, sponsorship needs,
          company watchlist, and notification settings.
        </p>
        {/* When Fit Check ships, restore the disclosure here: it stores pasted
            resume text and an encrypted LLM API key, used only for the user's
            own checks and removable from the preferences page. */}
        <p>
          The job postings themselves are public data collected from company career pages. Nothing
          about you is attached to them.
        </p>
      </InfoSection>
      <InfoSection heading="What we do with it">
        <p>
          Your data is used for one purpose: matching job postings to your profile and delivering
          them to you. We do not sell data, share it with third parties, run ads, or use your
          information for anything beyond operating the service. Emails are sent only for
          verification codes and password resets.
        </p>
      </InfoSection>
      <InfoSection heading="Cookies">
        <p>
          One session cookie keeps you signed in. There are no analytics trackers, advertising
          pixels, or third-party cookies.
        </p>
      </InfoSection>
      <InfoSection heading="Deleting your data">
        <p>
          Open a ticket on the support page from your account and request deletion. Your profile,
          preferences and application history are removed. Alert delivery stops immediately when
          you deactivate notifications.
        </p>
      </InfoSection>
      <InfoSection heading="Questions">
        <p>Reach us through the support page in your dashboard.</p>
      </InfoSection>
    </InfoPage>
  );
}
