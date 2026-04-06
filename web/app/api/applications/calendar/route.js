import { getSession } from "@/lib/session";
import { getApplicationsByMonth } from "@/lib/db";

export async function GET(request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const month = searchParams.get("month");

  // Validate month format: YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return Response.json({ error: "Invalid month format. Use YYYY-MM." }, { status: 400 });
  }

  try {
    const days = getApplicationsByMonth(session.discordId, month);

    // Build totals from days
    const totals = {};
    for (const [date, jobs] of Object.entries(days)) {
      totals[date] = jobs.length;
    }

    return Response.json({ month, days, totals });
  } catch (err) {
    console.error("Calendar fetch error:", err);
    return Response.json({ error: "Failed to fetch calendar data" }, { status: 500 });
  }
}
