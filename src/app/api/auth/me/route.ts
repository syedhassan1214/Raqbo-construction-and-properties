import { getCurrentUser } from "@/lib/server/auth";
import { errorResponse, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    return json({ user });
  } catch (error) {
    return errorResponse(error);
  }
}
