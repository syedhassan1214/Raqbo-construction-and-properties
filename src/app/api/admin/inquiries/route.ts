import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser(["admin", "support"]);
    const inquiries = database.prepare(`
      SELECT inquiries.id, inquiries.listing_id, listings.title AS listing_title,
        listings.city, listings.locality, inquiries.message, inquiries.status,
        inquiries.buyer_update, inquiries.owner_update, inquiries.assigned_to,
        assignee.display_name AS assignee_name, buyer.display_name AS buyer_name,
        owner.display_name AS owner_name, inquiries.created_at
      FROM inquiries
      JOIN listings ON listings.id = inquiries.listing_id
      JOIN users AS buyer ON buyer.id = inquiries.sender_id
      LEFT JOIN users AS owner ON owner.id = listings.creator_id
      LEFT JOIN users AS assignee ON assignee.id = inquiries.assigned_to
      ORDER BY CASE WHEN inquiries.status IN ('new', 'flagged') THEN 0 ELSE 1 END,
        inquiries.created_at DESC
      LIMIT 100
    `).all();
    const assignees = database.prepare(`
      SELECT id, display_name, email FROM users
      WHERE role IN ('admin', 'support') AND status = 'active'
      ORDER BY display_name, email
    `).all();
    return json({ inquiries, assignees });
  } catch (error) {
    return errorResponse(error);
  }
}
