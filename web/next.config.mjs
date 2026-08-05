import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDiscordRedirectUri, resolvePublicOrigin } from "./lib/security-core.mjs";
import { resolveSessionSecret } from "./lib/session-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isProduction = process.env.NODE_ENV === "production";
if (isProduction) {
  const publicOrigin = resolvePublicOrigin(
    process.env.NEXT_PUBLIC_BASE_URL,
    "https://invalid.local",
    { production: true }
  );
  resolveDiscordRedirectUri(process.env.DISCORD_REDIRECT_URI, publicOrigin, { production: true });
  resolveSessionSecret(process.env.SESSION_SECRET, { production: true });
}
/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],
  // Production is a 1 GB EC2 instance. Keep static-page generation bounded so
  // a deploy cannot fan out to every visible host CPU and exhaust RAM/swap.
  experimental: {
    cpus: 1,
    memoryBasedWorkersCount: false,
  },
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
