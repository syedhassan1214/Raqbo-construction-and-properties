import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser(["admin", "moderator"]);
    const assets = database.prepare(`
      SELECT property_3d_assets.id, property_3d_assets.listing_id,
        property_3d_assets.asset_type, property_3d_assets.mime_type,
        property_3d_assets.file_size, property_3d_assets.review_status,
        property_3d_assets.created_at, listings.title AS listing_title,
        listings.city, listings.locality
      FROM property_3d_assets
      JOIN listings ON listings.id = property_3d_assets.listing_id
      WHERE property_3d_assets.review_status = 'pending' AND listings.is_demo = 0
      ORDER BY property_3d_assets.created_at ASC LIMIT 100
    `).all() as {
      id: string;
      listing_id: string;
      asset_type: string;
      mime_type: string;
      file_size: number;
      review_status: string;
      created_at: string;
      listing_title: string;
      city: string;
      locality: string;
    }[];
    return json({
      assets: assets.map(({ id, ...asset }) => ({
        id,
        ...asset,
        fileUrl: `/api/3d-assets/${id}/file`,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
