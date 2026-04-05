import { Syne, Outfit } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";

const syne = Syne({ subsets: ["latin"], variable: "--font-syne" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata = {
  title: "JobPulse — Real-time Job Alerts",
  description: "Job alerts from 120+ companies, filtered for your role and visa status.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${syne.variable} ${outfit.variable}`}>
      <body className="min-h-screen">
        <Navbar />
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 relative z-10">
          {children}
        </main>
      </body>
    </html>
  );
}
