import { runGemini } from "./gemini.js";
import { getCachedResearch, cacheResearch, getDb } from "./state.js";

export async function researchCompany(companyName, companyKey, jobTitle) {
  // Check cache first (7-day TTL)
  const cached = getCachedResearch(companyKey);
  if (cached) return cached;

  // Gather H1B data from local DB
  let h1bContext = "";
  try {
    const db = getDb();
    const h1b = db.prepare("SELECT * FROM h1b_sponsors WHERE company_key = ?").get(companyKey);
    if (h1b) {
      h1bContext = `\nH1B data from our database: sponsors_h1b=${h1b.sponsors_h1b}, lca_count=${h1b.lca_count}, avg_salary=$${h1b.avg_salary}`;
    }
  } catch {}

  const prompt = `Research the company "${companyName}" for a job seeker evaluating a "${jobTitle}" role. ${h1bContext}

Return a JSON object with these fields (no markdown code fences, just raw JSON):
{
  "overview": "What the company does, approximate size, funding stage or public status. 2-3 sentences.",
  "h1bSponsorship": "Does this company sponsor H1B visas? History of sponsorship, LCA filings if known. 1-2 sentences.",
  "recentNews": ["Bullet point 1 about recent company news", "Bullet point 2", "Bullet point 3"],
  "techStack": ["Known technologies", "frameworks", "languages used"],
  "ratingsOverview": "Approximate Glassdoor/Blind ratings and sentiment. 1-2 sentences.",
  "interviewProcess": "Typical interview loop for engineering roles. 2-3 sentences."
}

Be factual. If you don't know something, say "Not available" rather than guessing.`;

  const output = await runGemini(prompt, { maxOutputTokens: 2048 });
  const cleaned = output.replace(/```json?\s*/g, "").replace(/```/g, "").trim();

  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    // Try to extract JSON from the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      data = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("Could not parse research response as JSON");
    }
  }

  cacheResearch(companyKey, companyName, data);
  return data;
}
