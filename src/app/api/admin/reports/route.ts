import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireUser(["admin", "moderator", "support"]);
    const status = request.nextUrl.searchParams.get("status");
    if (status && !["open", "investigating", "resolved", "dismissed"].includes(status)) {
      throw new HttpError(400, "invalid_report_status", "Choose a valid report status.");
    }
    const reports = status
      ? database.prepare(`
          SELECT reports.id, reports.listing_id, reports.reporter_id, reports.category,
            reports.message, reports.status, reports.created_at,
            listings.title AS listing_title, listings.city, listings.locality,
            listings.status AS listing_status
          FROM reports LEFT JOIN listings ON listings.id = reports.listing_id
          WHERE reports.status = ? ORDER BY reports.created_at ASC LIMIT 100
        `).all(status)
      : database.prepare(`
          SELECT reports.id, reports.listing_id, reports.reporter_id, reports.category,
            reports.message, reports.status, reports.created_at,
            listings.title AS listing_title, listings.city, listings.locality,
            listings.status AS listing_status
          FROM reports LEFT JOIN listings ON listings.id = reports.listing_id
          ORDER BY reports.created_at ASC LIMIT 100
        `).all();
    return json({ reports });
  } catch (error) {
    return errorResponse(error);
  }
}
