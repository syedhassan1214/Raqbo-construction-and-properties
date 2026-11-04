import { NextRequest, NextResponse } from "next/server";
import { createSession, hashPassword, type UserRole } from "@/lib/server/auth";
import { database, randomUUID } from "@/lib/server/database";
import {
  constantTimeStringEqual,
  errorResponse,
  HttpError,
  logAudit,
  readJson,
  requireSameOrigin,
  requestAddress,
  enforceRateLimit,
} from "@/lib/server/http";
import { adminBootstrapSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    enforceRateLimit(`admin-bootstrap:${requestAddress(request)}`, 5, 60 * 60 * 1000);
    const body = await readJson(request, adminBootstrapSchema);
    const bootstrapKey = process.env.RAQBO_ADMIN_BOOTSTRAP_KEY;
    if (!bootstrapKey || Buffer.byteLength(bootstrapKey) < 32) {
      throw new HttpError(503, "admin_setup_unavailable", "Secure admin setup is not configured.");
    }
    if (!constantTimeStringEqual(body.bootstrapKey, bootstrapKey)) {
      throw new HttpError(403, "invalid_setup_key", "The setup key is not valid.");
    }
    const email = body.email.toLowerCase();
    const userId = randomUUID();
    database.exec("BEGIN IMMEDIATE");
    try {
      const adminCount = database
        .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'")
        .get() as { count: number };
      if (adminCount.count > 0) {
        throw new HttpError(409, "admin_already_initialized", "Initial admin setup has already been completed.");
      }
      if (database.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
        throw new HttpError(409, "account_exists", "This email address is already in use.");
      }
      database.prepare(`
        INSERT INTO users(id, role, email, password_hash, display_name)
        VALUES (?, 'admin', ?, ?, ?)
      `).run(userId, email, hashPassword(body.password), body.displayName);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    logAudit(userId, "admin.bootstrap_completed", "user", userId);

    const response = NextResponse.json(
      { ok: true, user: { id: userId, role: "admin" satisfies UserRole, email } },
      { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
    );
    await createSession(response, userId, "admin");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
