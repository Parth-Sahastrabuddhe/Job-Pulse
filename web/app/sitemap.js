export default function sitemap() {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://joblookout.app";
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/auth`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/privacy`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "monthly", priority: 0.3 },
  ];
}
