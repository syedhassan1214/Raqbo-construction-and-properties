import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser(["buyer", "owner"]);
    const inquiries = database.prepare(`
      SELECT inquiries.id, inquiries.listing_id, listings.title AS listing_title,
        inquiries.message, inquiries.status, inquiries.created_at,
        CASE WHEN inquiries.sender_id = ? THEN advertiser.display_name ELSE sender.display_name END AS other_party_name,
        CASE WHEN inquiries.sender_id = ? THEN 'sent' ELSE 'received' END AS direction
      FROM inquiries
      JOIN listings ON listings.id = inquiries.listing_id
      JOIN users AS sender ON sender.id = inquiries.sender_id
      LEFT JOIN users AS advertiser ON advertiser.id = listings.creator_id
      WHERE listings.creator_id = ? OR inquiries.sender_id = ?
      ORDER BY inquiries.created_at DESC
      LIMIT 100
    `).all(user.id, user.id, user.id, user.id);
    return json({ inquiries });
  } catch (error) {
    return errorResponse(error);
  }
}
