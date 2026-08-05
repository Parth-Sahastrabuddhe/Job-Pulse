import Link from "next/link";
import { getSession } from "@/lib/session";
import { BrandWordmark } from "./Brand";
import NavDropdown from "./NavDropdown";

const NAV_LINKS = [
  { href: "/dashboard", label: "Tracker" },
  { href: "/profile", label: "Preferences" },
  { href: "/support", label: "Support" },
];

export default async function Navbar() {
  const session = await getSession();

  return (
    <nav className="sticky top-0 z-50 border-b border-line/80 bg-[rgba(7,16,14,0.82)] backdrop-blur-xl">
      <div className="mx-auto flex min-h-[68px] max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <BrandWordmark />

        {session ? (
          <>
            <div className="hidden items-center gap-1 rounded-xl border border-line/80 bg-surface/70 p-1 md:flex">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:bg-elevated hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
              {session.role === "admin" && (
                <Link href="/admin" className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:bg-elevated hover:text-foreground">
                  Admin
                </Link>
              )}
            </div>

            <div className="hidden items-center gap-3 md:flex">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-elevated text-sm font-bold text-pulse">
                {(session.username || "U").slice(0, 1).toUpperCase()}
              </div>
              <div className="hidden lg:block">
                <div className="max-w-28 truncate text-sm font-semibold text-foreground">{session.username}</div>
                <div className="text-[11px] text-faint">Lookout active</div>
              </div>
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="secondary-button px-3.5 py-2 text-sm">
                  Log out
                </button>
              </form>
            </div>

            <div className="md:hidden">
              <NavDropdown username={session.username} isAdmin={session.role === "admin"} />
            </div>
          </>
        ) : (
          <>
            <div className="hidden items-center gap-1 md:flex">
              {[
                { href: "/#how-it-works", label: "How it works" },
                { href: "/#companies", label: "Companies" },
                { href: "/#faq", label: "FAQ" },
              ].map((link) => (
                <a key={link.href} href={link.href} className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:bg-elevated hover:text-foreground">
                  {link.label}
                </a>
              ))}
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Link href="/auth" className="hidden px-3 py-2 text-sm font-semibold text-muted transition-colors hover:text-foreground sm:inline-flex">
                Log in
              </Link>
              <Link href="/auth?mode=register" className="primary-button px-4 py-2.5 text-sm">
                Start your lookout
              </Link>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
