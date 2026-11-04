import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import {
  enforceRateLimit,
  errorResponse,
  HttpError,
  json,
  logAudit,
  requireSameOrigin,
} from "@/lib/server/http";
import {
  MAX_MODEL_BYTES,
  MAX_PHOTO_BYTES,
  MAX_PANORAMA_BYTES,
  MAX_VIDEO_BYTES,
  resolveStoredMedia,
  sanitizePanorama,
  sanitizePropertyPhoto,
  validateGlb,
  validatePropertyVideo,
} from "@/lib/server/property-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type ListingContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: ListingContext) {
  try {
    const user = await requireUser(["owner", "admin", "moderator"]);
    const { id } = await context.params;
    const listing = database.prepare(`
      SELECT id, creator_id, is_demo FROM listings WHERE id = ? LIMIT 1
    `).get(id) as { id: string; creator_id: string | null; is_demo: number } | undefined;
    if (!listing || listing.is_demo || (listing.creator_id !== user.id && !["admin", "moderator"].includes(user.role))) {
      throw new HttpError(404, "listing_not_found", "This property listing was not found.");
    }
    const assets = database.prepare(`
      SELECT id, asset_type, file_size, review_status, review_note, ai_status, created_at
      FROM property_3d_assets WHERE listing_id = ? ORDER BY created_at ASC
    `).all(id);
    return json({ assets });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, context: ListingContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["owner"]);
    enforceRateLimit(`property-media:${user.id}`, 10, 60 * 60 * 1000);
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_VIDEO_BYTES + 1024 * 1024) {
      throw new HttpError(413, "upload_too_large", "Uploads must be 50 MB or smaller.");
    }
    const { id: listingId } = await context.params;
    const listing = database.prepare(`
      SELECT id FROM listings
      WHERE id = ? AND creator_id = ? AND is_demo = 0 AND status IN ('draft', 'needs_changes')
      LIMIT 1
    `).get(listingId, user.id) as { id: string } | undefined;
    if (!listing) {
      throw new HttpError(404, "editable_listing_not_found", "Only your unpublished listing drafts can receive new media.");
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw new HttpError(400, "invalid_multipart", "Upload must use a valid multipart form.");
    }
    const uploaded = formData.get("asset");
    const assetType = formData.get("assetType");
    const rightsConfirmed = formData.get("rightsConfirmed") === "true";
    if (!(uploaded instanceof File) || uploaded.size === 0) {
      throw new HttpError(400, "asset_required", "Choose a property photo, MP4 video, 3D model, or 360° panorama to upload.");
    }
    if (assetType !== "model_glb" && assetType !== "panorama" &&
      assetType !== "property_photo" && assetType !== "property_video") {
      throw new HttpError(400, "invalid_asset_type", "Choose a supported media type.");
    }
    if (!rightsConfirmed) {
      throw new HttpError(400, "media_rights_required", "Confirm that you own or may upload this media.");
    }
    if (assetType === "model_glb" && uploaded.size > MAX_MODEL_BYTES) {
      throw new HttpError(413, "model_too_large", "3D models must be 25 MB or smaller.");
    }
    if (assetType === "panorama" && uploaded.size > MAX_PANORAMA_BYTES) {
      throw new HttpError(413, "panorama_too_large", "360° panorama images must be 20 MB or smaller.");
    }
    if (assetType === "property_photo" && uploaded.size > MAX_PHOTO_BYTES) {
      throw new HttpError(413, "photo_too_large", "Property photos must be 10 MB or smaller.");
    }
    if (assetType === "property_video" && uploaded.size > MAX_VIDEO_BYTES) {
      throw new HttpError(413, "video_too_large", "Property videos must be 50 MB or smaller.");
    }
    const existing = database.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(file_size), 0) AS bytes
      FROM property_3d_assets WHERE listing_id = ?
    `).get(listingId) as { count: number; bytes: number };
    if (existing.count >= 20) {
      throw new HttpError(409, "asset_limit_reached", "A listing can have at most 20 photos, videos, and tour assets.");
    }
    if (existing.bytes >= 150 * 1024 * 1024) {
      throw new HttpError(409, "listing_storage_limit_reached", "This listing has reached its 150 MB media limit.");
    }

    const original = Buffer.from(await uploaded.arrayBuffer());
    let buffer: Buffer;
    let mimeType: string;
    let extension: string;
    if (assetType === "model_glb") {
      if (!uploaded.name.toLowerCase().endsWith(".glb")) {
        throw new HttpError(400, "glb_required", "Upload a single-file binary glTF (.glb) model.");
      }
      validateGlb(original);
      buffer = original;
      mimeType = "model/gltf-binary";
      extension = "glb";
    } else if (assetType === "panorama") {
      const sanitized = await sanitizePanorama(original);
      buffer = sanitized.buffer;
      mimeType = sanitized.mimeType;
      extension = sanitized.extension;
    } else if (assetType === "property_photo") {
      const sanitized = await sanitizePropertyPhoto(original);
      buffer = sanitized.buffer;
      mimeType = sanitized.mimeType;
      extension = sanitized.extension;
    } else {
      if (!uploaded.name.toLowerCase().endsWith(".mp4")) {
        throw new HttpError(400, "mp4_required", "Upload a single MP4 property video.");
      }
      validatePropertyVideo(original);
      buffer = original;
      mimeType = "video/mp4";
      extension = "mp4";
    }

    if (existing.bytes + buffer.length > 150 * 1024 * 1024) {
      throw new HttpError(409, "listing_storage_limit_reached", "This listing has a 150 MB media limit.");
    }
    const assetId = randomUUID();
    const storageKey = `${assetId}.${extension}`;
    const filePath = resolveStoredMedia(storageKey);
    await writeFile(filePath, buffer, { flag: "wx", mode: 0o600 });
    try {
      database.prepare(`
        INSERT INTO property_3d_assets(id, listing_id, owner_id, asset_type, storage_key, mime_type, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(assetId, listingId, user.id, assetType, storageKey, mimeType, buffer.length);
    } catch (error) {
      await unlink(filePath);
      throw error;
    }
    logAudit(user.id, "property_media.uploaded", "property_3d_asset", assetId, {
      listingId,
      assetType,
      fileSize: buffer.length,
      rightsConfirmed,
    });
    return json({
      asset: {
        id: assetId,
        assetType,
        fileSize: buffer.length,
        reviewStatus: "pending",
        aiStatus: "disabled",
        fileUrl: `/api/3d-assets/${assetId}/file`,
      },
      message: "Upload received. It remains private until staff review. AI processing is disabled until a provider is approved.",
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
