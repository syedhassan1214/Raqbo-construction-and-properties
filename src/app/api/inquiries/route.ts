import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database, randomUUID } from "@/lib/server/database";
import {
  enforceRateLimit,
  errorResponse,
  HttpError,
  json,
  logAudit,
  readJson,
  requireSameOrigin,
} from "@/lib/server/http";
import { inquirySchema } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["buyer", "owner"]);
    const body = await readJson(request, inquirySchema);
    enforceRateLimit(`inquiry-user:${user.id}`, 12, 60 * 60 * 1000);
    enforceRateLimit(`inquiry-listing:${user.id}:${body.listingId}`, 3, 60 * 60 * 1000);

    const listing = database
      .prepare("SELECT id, creator_id FROM listings WHERE id = ? AND status = 'live' LIMIT 1")
      .get(body.listingId) as { id: string; creator_id: string | null } | undefined;
    if (!listing) throw new HttpError(404, "listing_not_found", "This property listing is not available.");
    if (listing.creator_id === user.id) {
      throw new HttpError(409, "self_inquiry", "You cannot send an enquiry about your own listing.");
    }

    const id = randomUUID();
    database
      .prepare("INSERT INTO inquiries(id, listing_id, sender_id, message) VALUES (?, ?, ?, ?)")
      .run(id, listing.id, user.id, body.message);
    logAudit(user.id, "inquiry.created", "inquiry", id, { listingId: listing.id });
    return json(
      { id, status: "new", message: "Your enquiry has been recorded. Owner notifications require a configured delivery provider." },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
