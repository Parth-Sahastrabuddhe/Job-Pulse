import { getGroupedCompanies } from "@/lib/companies";

export async function GET() {
  try {
    const groups = getGroupedCompanies();
    return Response.json({ groups });
  } catch (err) {
    console.error("Companies fetch error:", err);
    return Response.json({ error: "Failed to fetch companies" }, { status: 500 });
  }
}
