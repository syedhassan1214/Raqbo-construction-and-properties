import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser(["admin", "support"]);
    const users = database.prepare(`
      SELECT id, role, email, display_name, status, created_at, updated_at
      FROM users WHERE status != 'deleted'
      ORDER BY created_at DESC LIMIT 100
    `).all();
    return json({ users });
  } catch (error) {
    return errorResponse(error);
  }
}
