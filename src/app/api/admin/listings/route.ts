import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, json } from "@/lib/server/http";
import { publicListing, type ListingRow } from "@/lib/server/listings";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedStatuses = ["submitted", "needs_changes", "rejected", "live", "paused", "under_offer", "sold", "rented", "expired"] as const;

export async function GET(request: NextRequest) {
  try {
    await requireUser(["admin", "moderator"]);
    const parsedStatus = z.enum(allowedStatuses).safeParse(request.nextUrl.searchParams.get("status"));
    if (!parsedStatus.success) {
      throw new HttpError(400, "invalid_listing_status", "Choose a valid moderation status.");
    }
    const listings = database.prepare(`
      SELECT * FROM listings WHERE status = ?
      ORDER BY is_demo ASC, created_at ASC LIMIT 100
    `).all(parsedStatus.data) as ListingRow[];
    return json({
      listings: listings.map((listing) => {
        const media = database.prepare(`
          SELECT id, asset_type AS assetType, mime_type AS mimeType,
            file_size AS fileSize, review_status AS reviewStatus, review_note AS reviewNote
          FROM property_3d_assets
          WHERE listing_id = ?
          ORDER BY created_at ASC
        `).all(listing.id) as {
          id: string;
          assetType: string;
          mimeType: string;
          fileSize: number;
          reviewStatus: string;
          reviewNote: string | null;
        }[];
        return {
          ...publicListing(listing),
          creatorId: listing.creator_id,
          reviewNote: listing.review_note,
          media: media.map((asset) => ({
            ...asset,
            fileUrl: `/api/3d-assets/${asset.id}/file`,
          })),
        };
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
