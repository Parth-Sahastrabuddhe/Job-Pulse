import { redirect } from "next/navigation";
import { clearSession } from "@/lib/session";

export async function GET() {
  await clearSession();
  redirect("/");
}
