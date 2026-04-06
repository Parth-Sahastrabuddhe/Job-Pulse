import Link from "next/link";
import { getSession } from "@/lib/session";
import NavDropdown from "./NavDropdown";

export default async function Navbar() {
  const session = await getSession();

  return (
    <nav className="bg-[rgba(15,17,23,0.85)] backdrop-blur-md border-b border-line sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {session && <NavDropdown />}
          <Link href="/" className="flex items-center gap-0.5">
            <span className="text-xl font-bold text-foreground font-display">Job</span>
            <span className="text-xl font-bold text-pulse font-display animate-pulse-glow">Pulse</span>
          </Link>
        </div>

        <div className="flex items-center gap-5 text-sm">
          {session ? (
            <>
              <Link href="/profile" className="text-muted hover:text-foreground transition-colors">
                Profile
              </Link>
              <Link href="/dashboard" className="text-muted hover:text-foreground transition-colors">
                Dashboard
              </Link>
              <Link href="/support" className="text-muted hover:text-foreground transition-colors">
                Support
              </Link>
              {session.role === "admin" && (
                <Link href="/admin" className="text-muted hover:text-foreground transition-colors">
                  Admin
                </Link>
              )}
              <span className="text-faint">{session.username}</span>
              <a
                href="/api/auth/logout"
                className="bg-elevated hover:bg-surface-hover text-muted hover:text-foreground px-3 py-1.5 rounded-md border border-line transition-colors text-sm"
              >
                Logout
              </a>
            </>
          ) : (
            <Link
              href="/auth"
              className="bg-pulse hover:bg-pulse-hover text-black font-medium px-4 py-2 rounded-md transition-colors"
            >
              Get Started
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
