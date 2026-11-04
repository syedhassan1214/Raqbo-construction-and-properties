import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, HttpError, logAudit } from "@/lib/server/http";
import { resolveStoredMedia } from "@/lib/server/property-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type AssetContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: AssetContext) {
  try {
    const { id } = await context.params;
    const asset = database.prepare(`
      SELECT property_3d_assets.storage_key, property_3d_assets.mime_type,
        property_3d_assets.review_status, property_3d_assets.owner_id,
        listings.status AS listing_status, listings.is_demo
      FROM property_3d_assets
      JOIN listings ON listings.id = property_3d_assets.listing_id
      WHERE property_3d_assets.id = ? LIMIT 1
    `).get(id) as {
      storage_key: string;
      mime_type: string;
      review_status: string;
      owner_id: string;
      listing_status: string;
      is_demo: number;
    } | undefined;
    if (!asset || asset.is_demo) throw new HttpError(404, "asset_not_found", "This media item was not found.");

    const isPublic = asset.review_status === "approved" && asset.listing_status === "live";
    if (!isPublic) {
      const user = await getCurrentUser();
      if (!user || (user.id !== asset.owner_id && !["admin", "moderator"].includes(user.role))) {
        throw new HttpError(404, "asset_not_found", "This media item was not found.");
      }
      if (user.id !== asset.owner_id) {
        logAudit(user.id, "property_media.private_preview_accessed", "property_3d_asset", id);
      }
    }
    const contents = await readFile(resolveStoredMedia(asset.storage_key));
    const isVideo = asset.mime_type === "video/mp4";
    const range = isVideo ? request.headers.get("range") : null;
    let responseContents = contents;
    let status = 200;
    let contentRange: string | null = null;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${contents.byteLength}`, "Accept-Ranges": "bytes" },
        });
      }
      const start = match[1] ? Number(match[1]) : Math.max(0, contents.byteLength - Number(match[2]));
      const end = match[1]
        ? Math.min(Number(match[2] || contents.byteLength - 1), contents.byteLength - 1)
        : contents.byteLength - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || start >= contents.byteLength || end < start) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${contents.byteLength}`, "Accept-Ranges": "bytes" },
        });
      }
      responseContents = contents.subarray(start, end + 1);
      status = 206;
      contentRange = `bytes ${start}-${end}/${contents.byteLength}`;
    }
    return new Response(responseContents, {
      status,
      headers: {
        "Content-Type": asset.mime_type,
        "Content-Length": String(responseContents.byteLength),
        "Content-Disposition": "inline",
        "Cache-Control": isPublic ? "public, max-age=300" : "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
        ...(isVideo ? { "Accept-Ranges": "bytes" } : {}),
        ...(contentRange ? { "Content-Range": contentRange } : {}),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
