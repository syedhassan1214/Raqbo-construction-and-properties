import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser(["admin", "verifier"]);
    const cases = database.prepare(`
      SELECT verification_cases.id, verification_cases.listing_id, verification_cases.check_type,
        verification_cases.status, verification_cases.scope, verification_cases.evidence_summary,
        verification_cases.reviewer_id, verification_cases.second_reviewer_id,
        verification_cases.expires_at, verification_cases.reviewed_at, verification_cases.created_at,
        listings.title AS listing_title, listings.city, listings.locality, listings.is_demo
      FROM verification_cases
      JOIN listings ON listings.id = verification_cases.listing_id
      WHERE verification_cases.status IN ('requested', 'in_review', 'pending_second_review')
      ORDER BY verification_cases.created_at ASC LIMIT 100
    `).all();
    return json({ cases });
  } catch (error) {
    return errorResponse(error);
  }
}
