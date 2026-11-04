import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { database, randomUUID } from "@/lib/server/database";
import {
  enforceRateLimit,
  errorResponse,
  HttpError,
  json,
  logAudit,
  readJson,
  requireSameOrigin,
  requestAddress,
} from "@/lib/server/http";
import { reportSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    enforceRateLimit(`report-ip:${requestAddress(request)}`, 8, 60 * 60 * 1000);
    const body = await readJson(request, reportSchema);
    const user = await getCurrentUser();
    if (body.listingId) {
      const listing = database
        .prepare("SELECT id FROM listings WHERE id = ? AND status = 'live' LIMIT 1")
        .get(body.listingId);
      if (!listing) throw new HttpError(404, "listing_not_found", "This property listing was not found.");
    }
    const id = randomUUID();
    database
      .prepare("INSERT INTO reports(id, listing_id, reporter_id, category, message) VALUES (?, ?, ?, ?, ?)")
      .run(id, body.listingId ?? null, user?.id ?? null, body.category, body.message);
    logAudit(user?.id ?? null, "report.created", "report", id, {
      listingId: body.listingId ?? null,
      category: body.category,
    });
    return json({ id, status: "open", message: "Your report has been recorded for review." }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
