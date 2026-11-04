import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireUser(["admin"]);
    const page = Math.max(1, Math.min(10_000, Number(request.nextUrl.searchParams.get("page")) || 1));
    const logs = database.prepare(`
      SELECT audit_logs.id, audit_logs.action, audit_logs.entity_type, audit_logs.entity_id,
        audit_logs.details_json, audit_logs.created_at, users.email AS actor_email,
        users.display_name AS actor_name
      FROM audit_logs
      LEFT JOIN users ON users.id = audit_logs.actor_id
      ORDER BY audit_logs.created_at DESC LIMIT 50 OFFSET ?
    `).all((page - 1) * 50) as {
      id: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      details_json: string;
      created_at: string;
      actor_email: string | null;
      actor_name: string | null;
    }[];
    return json({
      page,
      logs: logs.map(({ details_json, ...entry }) => ({
        ...entry,
        details: JSON.parse(details_json) as Record<string, unknown>,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
