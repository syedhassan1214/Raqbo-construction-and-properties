import { unlink } from "node:fs/promises";
import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, json, logAudit, requireSameOrigin } from "@/lib/server/http";
import { resolveStoredMedia } from "@/lib/server/property-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type AssetContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: AssetContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["owner"]);
    const { id } = await context.params;
    const asset = database.prepare(`
      SELECT id, listing_id, storage_key FROM property_3d_assets
      WHERE id = ? AND owner_id = ? AND review_status IN ('pending', 'rejected')
      LIMIT 1
    `).get(id, user.id) as { id: string; listing_id: string; storage_key: string } | undefined;
    if (!asset) throw new HttpError(404, "asset_not_removable", "Only your pending or rejected media can be removed.");

    database.prepare("DELETE FROM property_3d_assets WHERE id = ? AND owner_id = ?").run(id, user.id);
    await unlink(resolveStoredMedia(asset.storage_key));
    logAudit(user.id, "property_media.removed", "property_3d_asset", id, { listingId: asset.listing_id });
    return json({ id, removed: true });
  } catch (error) {
    return errorResponse(error);
  }
}
