import "server-only";

import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import sharp from "sharp";
import { HttpError } from "./http";

export const MAX_MODEL_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PANORAMA_BYTES = 20 * 1024 * 1024;

const configuredMediaDirectory = process.env.RAQBO_MEDIA_DIRECTORY;
if (configuredMediaDirectory && !isAbsolute(configuredMediaDirectory)) {
  throw new Error("RAQBO_MEDIA_DIRECTORY must be an absolute path.");
}

const defaultMediaDirectory = process.env.RAQBO_DATABASE_PATH
  ? resolve(dirname(resolve(process.env.RAQBO_DATABASE_PATH)), "media")
  : ".data/media";
export const mediaDirectory = resolve(configuredMediaDirectory ?? defaultMediaDirectory);
mkdirSync(mediaDirectory, { recursive: true });

export function resolveStoredMedia(storageKey: string) {
  if (!/^[0-9a-f-]{36}\.(glb|jpg|mp4|webp)$/.test(storageKey)) {
    throw new Error("Stored media key has an invalid format.");
  }
  const filePath = resolve(mediaDirectory, storageKey);
  if (!filePath.startsWith(`${mediaDirectory}${sep}`)) {
    throw new Error("Stored media path is outside the configured media directory.");
  }
  return filePath;
}

export function validatePropertyVideo(buffer: Buffer) {
  if (buffer.length < 24 || buffer.length > MAX_VIDEO_BYTES) {
    throw new HttpError(400, "invalid_video_size", "Property videos must be between 24 bytes and 50 MB.");
  }
  const firstBoxLength = buffer.readUInt32BE(0);
  if (buffer.toString("ascii", 4, 8) !== "ftyp" ||
    firstBoxLength < 16 || firstBoxLength > buffer.length) {
    throw new HttpError(400, "invalid_property_video", "Upload a valid MP4 property video.");
  }
  let offset = 0;
  let hasFileType = false;
  let hasMovieData = false;
  let hasMovieIndex = false;
  while (offset + 8 <= buffer.length) {
    let boxLength = buffer.readUInt32BE(offset);
    const boxType = buffer.toString("ascii", offset + 4, offset + 8);
    let headerLength = 8;
    if (boxLength === 1) {
      if (offset + 16 > buffer.length) {
        throw new HttpError(400, "invalid_property_video", "The MP4 video contains an incomplete box.");
      }
      const extendedLength = buffer.readBigUInt64BE(offset + 8);
      if (extendedLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new HttpError(400, "invalid_property_video", "The MP4 video contains an oversized box.");
      }
      boxLength = Number(extendedLength);
      headerLength = 16;
    } else if (boxLength === 0) {
      boxLength = buffer.length - offset;
    }
    if (boxLength < headerLength || offset + boxLength > buffer.length) {
      throw new HttpError(400, "invalid_property_video", "The MP4 video contains an invalid box.");
    }
    if (offset === 0 && boxType === "ftyp") hasFileType = true;
    if (boxType === "mdat") hasMovieData = true;
    if (boxType === "moov" || boxType === "moof") hasMovieIndex = true;
    offset += boxLength;
    if (boxLength === 0) break;
  }
  if (offset !== buffer.length || !hasFileType || !hasMovieData || !hasMovieIndex) {
    throw new HttpError(400, "invalid_property_video", "Upload a complete MP4 video with its movie index and media data.");
  }
}

export function validateGlb(buffer: Buffer) {
  if (buffer.length < 20 || buffer.length > MAX_MODEL_BYTES) {
    throw new HttpError(400, "invalid_model_size", "3D models must be between 20 bytes and 25 MB.");
  }
  if (buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2 ||
    buffer.readUInt32LE(8) !== buffer.length) {
    throw new HttpError(400, "invalid_glb", "Upload a valid binary glTF 2.0 (.glb) model.");
  }

  let offset = 12;
  let parsedDocument: Record<string, unknown> | null = null;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (chunkLength % 4 !== 0 || offset + chunkLength > buffer.length) {
      throw new HttpError(400, "invalid_glb", "The 3D model contains an invalid chunk.");
    }
    if (parsedDocument === null) {
      if (chunkType !== 0x4e4f534a) {
        throw new HttpError(400, "invalid_glb", "The model is missing its glTF JSON document.");
      }
      try {
        parsedDocument = JSON.parse(buffer.subarray(offset, offset + chunkLength).toString("utf8").trimEnd()) as Record<string, unknown>;
      } catch {
        throw new HttpError(400, "invalid_glb", "The 3D model JSON is invalid.");
      }
    } else if (chunkType !== 0x004e4942) {
      throw new HttpError(400, "invalid_glb", "The 3D model contains an unsupported external resource.");
    }
    offset += chunkLength;
  }
  if (offset !== buffer.length || !parsedDocument || typeof parsedDocument.asset !== "object" ||
    parsedDocument.asset === null || (parsedDocument.asset as { version?: unknown }).version !== "2.0") {
    throw new HttpError(400, "invalid_glb", "The file is not a complete glTF 2.0 model.");
  }

  const pending: unknown[] = [parsedDocument];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const child of value) pending.push(child);
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    for (const [key, child] of Object.entries(value)) {
      if (key === "uri" && typeof child === "string" &&
        !/^data:image\/(?:jpeg|png|webp);base64,/i.test(child)) {
        throw new HttpError(400, "external_model_resource", "Models cannot reference remote or separate files.");
      }
      pending.push(child);
    }
  }
}

export async function sanitizePanorama(buffer: Buffer) {
  if (buffer.length > MAX_PANORAMA_BYTES) {
    throw new HttpError(400, "panorama_too_large", "360° panorama images must be 20 MB or smaller.");
  }
  const image = sharp(buffer, { limitInputPixels: 80_000_000, failOn: "error" });
  const metadata = await image.metadata();
  if (!["jpeg", "webp"].includes(metadata.format ?? "")) {
    throw new HttpError(400, "invalid_panorama", "Upload a JPEG or WebP equirectangular panorama.");
  }
  if (!metadata.width || !metadata.height || metadata.width < 2048 ||
    metadata.orientation && [5, 6, 7, 8].includes(metadata.orientation) ||
    metadata.width / metadata.height < 1.8 || metadata.width / metadata.height > 2.2) {
    throw new HttpError(400, "invalid_panorama", "Use a landscape 360° panorama with an approximately 2:1 aspect ratio and at least 2048 pixels wide.");
  }

  const sanitized = await image.rotate()
    .resize({ width: 8192, height: 4096, fit: "inside", withoutEnlargement: true })
    .toFormat(metadata.format === "jpeg" ? "jpeg" : "webp", { quality: 88 })
    .toBuffer();
  if (sanitized.length > MAX_PANORAMA_BYTES) {
    throw new HttpError(400, "panorama_too_large", "The processed panorama is still too large. Upload a smaller image.");
  }
  return {
    buffer: sanitized,
    mimeType: metadata.format === "jpeg" ? "image/jpeg" : "image/webp",
    extension: metadata.format === "jpeg" ? "jpg" : "webp",
  } as const;
}

export async function sanitizePropertyPhoto(buffer: Buffer) {
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new HttpError(400, "photo_too_large", "Property photos must be 10 MB or smaller.");
  }
  const image = sharp(buffer, { limitInputPixels: 60_000_000, failOn: "error" });
  const metadata = await image.metadata();
  if (!["jpeg", "webp"].includes(metadata.format ?? "")) {
    throw new HttpError(400, "invalid_photo", "Upload a JPEG or WebP property photo.");
  }
  if (!metadata.width || !metadata.height || metadata.width < 640 || metadata.height < 480) {
    throw new HttpError(400, "photo_resolution_too_low", "Property photos must be at least 640 × 480 pixels.");
  }
  const sanitized = await image.rotate()
    .resize({ width: 6000, height: 6000, fit: "inside", withoutEnlargement: true })
    .toFormat(metadata.format === "jpeg" ? "jpeg" : "webp", { quality: 88 })
    .toBuffer();
  if (sanitized.length > MAX_PHOTO_BYTES) {
    throw new HttpError(400, "photo_too_large", "The processed photo is still too large. Upload a smaller image.");
  }
  return {
    buffer: sanitized,
    mimeType: metadata.format === "jpeg" ? "image/jpeg" : "image/webp",
    extension: metadata.format === "jpeg" ? "jpg" : "webp",
  } as const;
}
