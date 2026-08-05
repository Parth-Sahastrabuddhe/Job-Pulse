import { Syne, Outfit } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";

const syne = Syne({ subsets: ["latin"], variable: "--font-syne" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

const SITE_TITLE = "JobLookout — Find new roles before the crowd";
const SITE_DESCRIPTION =
  "Source-direct job alerts from 190+ company career pages, filtered to your role, seniority and visa needs, delivered to Discord in minutes.";

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || "https://joblookout.app"),
  title: {
    default: SITE_TITLE,
    template: "%s | JobLookout",
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: "JobLookout",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${syne.variable} ${outfit.variable}`}>
      <body className="min-h-screen antialiased">
        <Navbar />
        <main className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-9 relative z-10">
          {children}
        </main>
      </body>
    </html>
  );
}
