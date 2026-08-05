"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const NAV_LINKS = [
  { href: "/dashboard", label: "Tracker", detail: "Applications and progress" },
  { href: "/profile", label: "Preferences", detail: "Roles, companies and alerts" },
  { href: "/support", label: "Support", detail: "Tickets and questions" },
];

export default function NavDropdown({ username, isAdmin = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    function handleEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-muted transition-colors hover:border-line-hover hover:text-foreground"
        aria-label="Open navigation menu"
        aria-expanded={open}
      >
        <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          {open ? <path d="M5 5l10 10M15 5 5 15" /> : <path d="M3 5.5h14M3 10h14M3 14.5h14" />}
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[min(19rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
          <div className="border-b border-line bg-elevated/60 px-4 py-3">
            <div className="text-sm font-semibold text-foreground">{username || "JobLookout member"}</div>
            <div className="mt-0.5 text-xs text-faint">Your lookout is running</div>
          </div>
          <div className="p-2">
            {[...NAV_LINKS, ...(isAdmin ? [{ href: "/admin", label: "Admin", detail: "Manage users and system health" }] : [])].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="block rounded-xl px-3 py-2.5 transition-colors hover:bg-elevated"
              >
                <div className="text-sm font-semibold text-foreground">{link.label}</div>
                <div className="text-xs text-faint">{link.detail}</div>
              </Link>
            ))}
          </div>
          <form action="/api/auth/logout" method="post" className="border-t border-line p-2">
            <button type="submit" className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-muted transition-colors hover:bg-elevated hover:text-foreground">
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
