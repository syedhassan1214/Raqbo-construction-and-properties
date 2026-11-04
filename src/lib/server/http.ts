import "server-only";

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { database } from "./database";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    },
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return json({ error: error.code, message: error.message }, error.status);
  }
  if (error instanceof ZodError) {
    return json(
      {
        error: "validation_error",
        message: "Please correct the highlighted information.",
        details: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      400,
    );
  }
  console.error(
    "Unhandled API error:",
    error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  );
  return json({ error: "internal_error", message: "The request could not be completed." }, 500);
}

export async function readJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  return schema.parse(value);
}

export function requireSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    throw new HttpError(403, "invalid_origin", "Request origin is not allowed.");
  }

  const requestHost = request.headers.get("host")?.toLowerCase();
  if (!requestHost || !constantTimeStringEqual(originHost, requestHost)) {
    throw new HttpError(403, "invalid_origin", "Request origin is not allowed.");
  }
}

export function requestAddress(request: NextRequest) {
  const trustedProxyAddress = request.headers.get("x-real-ip");
  if (trustedProxyAddress) return trustedProxyAddress.slice(0, 100);
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return (forwarded.split(",")[0]?.trim() ?? "unknown").slice(0, 100);
  return "local";
}

export function enforceRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const existing = database
    .prepare("SELECT window_started_at, request_count FROM rate_limits WHERE rate_key = ?")
    .get(key) as { window_started_at: number; request_count: number } | undefined;

  if (!existing || now - existing.window_started_at >= windowMs) {
    database
      .prepare(`
        INSERT INTO rate_limits(rate_key, window_started_at, request_count)
        VALUES (?, ?, 1)
        ON CONFLICT(rate_key) DO UPDATE SET
          window_started_at = excluded.window_started_at,
          request_count = 1
      `)
      .run(key, now);
    return;
  }

  if (existing.request_count >= limit) {
    throw new HttpError(429, "rate_limited", "Too many requests. Please try again later.");
  }

  database
    .prepare("UPDATE rate_limits SET request_count = request_count + 1 WHERE rate_key = ?")
    .run(key);
}

export function constantTimeStringEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function logAudit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  database
    .prepare(`
      INSERT INTO audit_logs(id, actor_id, action, entity_type, entity_id, details_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      crypto.randomUUID(),
      actorId,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
    );
}
