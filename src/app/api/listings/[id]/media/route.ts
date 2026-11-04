import { NextRequest } from "next/server";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ListingContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: ListingContext) {
  try {
    const { id } = await context.params;
    const listing = database.prepare(`
      SELECT id FROM listings WHERE id = ? AND status = 'live' AND is_demo = 0 LIMIT 1
    `).get(id);
    if (!listing) throw new HttpError(404, "listing_not_found", "This property listing was not found.");
    const assets = database.prepare(`
      SELECT id, asset_type AS assetType, mime_type AS mimeType
      FROM property_3d_assets
      WHERE listing_id = ? AND review_status = 'approved'
      ORDER BY created_at ASC
    `).all(id) as { id: string; assetType: string; mimeType: string }[];
    return json({
      assets: assets.map(({ id: assetId, ...asset }) => ({
        ...asset,
        url: `/api/3d-assets/${assetId}/file`,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
