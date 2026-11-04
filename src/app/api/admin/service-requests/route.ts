import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import {
  errorResponse,
  HttpError,
  json,
} from "@/lib/server/http";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireUser(["admin", "support"]);
    const status = request.nextUrl.searchParams.get("status");
    const statuses = ["submitted", "under_review", "information_required", "quoted", "in_progress", "completed", "closed"] as const;
    if (status && !z.enum(statuses).safeParse(status).success) {
      throw new HttpError(400, "invalid_case_status", "Choose a valid service request status.");
    }
    const rows = status
      ? database.prepare(`
          SELECT service_requests.id, service_requests.requester_id, service_requests.name,
            service_requests.city, service_requests.service_type, service_requests.message,
            service_requests.status, service_requests.assigned_to,
            assignee.display_name AS assignee_name, service_requests.created_at, service_requests.updated_at
          FROM service_requests
          LEFT JOIN users AS assignee ON assignee.id = service_requests.assigned_to
          WHERE service_requests.status = ? ORDER BY service_requests.created_at ASC LIMIT 100
        `).all(status)
      : database.prepare(`
          SELECT service_requests.id, service_requests.requester_id, service_requests.name,
            service_requests.city, service_requests.service_type, service_requests.message,
            service_requests.status, service_requests.assigned_to,
            assignee.display_name AS assignee_name, service_requests.created_at, service_requests.updated_at
          FROM service_requests
          LEFT JOIN users AS assignee ON assignee.id = service_requests.assigned_to
          ORDER BY service_requests.created_at ASC LIMIT 100
        `).all();
    const assignees = database.prepare(`
      SELECT id, display_name, email FROM users
      WHERE role IN ('admin', 'support') AND status = 'active'
      ORDER BY display_name, email
    `).all();
    return json({ requests: rows, assignees });
  } catch (error) {
    return errorResponse(error);
  }
}
