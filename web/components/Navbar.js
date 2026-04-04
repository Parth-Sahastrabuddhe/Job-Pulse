import Link from "next/link";
import { getSession } from "@/lib/session";

export default async function Navbar() {
  const session = await getSession();

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-indigo-600 hover:text-indigo-700">
          JobPulse
        </Link>

        <div className="flex items-center gap-4 text-sm">
          {session ? (
            <>
              <Link href="/profile" className="text-gray-600 hover:text-gray-900">
                Profile
              </Link>
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                Dashboard
              </Link>
              <Link href="/support" className="text-gray-600 hover:text-gray-900">
                Support
              </Link>
              <span className="text-gray-500">
                {session.username}
              </span>
              <Link
                href="/api/auth/logout"
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-md transition-colors"
              >
                Logout
              </Link>
            </>
          ) : (
            <Link
              href="/api/auth/discord"
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md transition-colors font-medium"
            >
              Login with Discord
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
