export default function robots() {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://joblookout.app";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin", "/dashboard", "/profile", "/verify", "/forgot-password"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
