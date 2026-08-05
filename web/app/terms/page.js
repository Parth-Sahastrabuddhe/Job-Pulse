import InfoPage, { InfoSection } from "@/components/InfoPage";

export const metadata = {
  title: "Terms",
  description: "The short, plain-language terms for using JobLookout.",
};

export default function TermsPage() {
  return (
    <InfoPage kicker="Trust" title="Terms of use" updated="August 2026">
      <InfoSection heading="The service">
        <p>
          JobLookout monitors public company career pages and sends you alerts that match the
          preferences you set. It is free to use. It is provided as-is: we work hard to keep
          coverage accurate and fast, but we cannot guarantee that every posting is caught, that
          details are always correct, or that the service is available at all times. Always confirm
          role details on the company&apos;s own page before applying.
        </p>
      </InfoSection>
      <InfoSection heading="Your account">
        <p>
          Keep your password private and your account secure. One account per person. You are
          responsible for activity that happens through your account.
        </p>
      </InfoSection>
      <InfoSection heading="Fair use">
        <p>
          Do not attempt to disrupt the service, scrape or resell its data, probe other users&apos;
          information, or automate bulk access to the site. Accounts that abuse the service can be
          suspended or removed.
        </p>
      </InfoSection>
      <InfoSection heading="Third-party links">
        <p>
          Alerts link to career pages operated by the hiring companies. Those sites have their own
          terms and privacy practices, which we do not control.
        </p>
      </InfoSection>
      <InfoSection heading="Changes">
        <p>
          Features may change, and the service may evolve or be discontinued. Material changes to
          these terms will be reflected on this page.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
