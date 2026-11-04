import { NextRequest, NextResponse } from "next/server";
import { createSession, verifyPassword, type UserRole } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import {
  enforceRateLimit,
  errorResponse,
  json,
  logAudit,
  readJson,
  requireSameOrigin,
  requestAddress,
} from "@/lib/server/http";
import { adminLoginSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const body = await readJson(request, adminLoginSchema);
    const email = body.email.toLowerCase();
    enforceRateLimit(`admin-login-ip:${requestAddress(request)}`, 15, 15 * 60 * 1000);
    enforceRateLimit(`admin-login-email:${email}`, 8, 15 * 60 * 1000);

    const user = database
      .prepare(`
        SELECT id, role, email, password_hash
        FROM users
        WHERE email = ? AND role IN ('admin', 'moderator', 'verifier', 'support', 'finance')
          AND status = 'active'
        LIMIT 1
      `)
      .get(email) as
      | { id: string; role: UserRole; email: string; password_hash: string }
      | undefined;

    if (!user || !verifyPassword(body.password, user.password_hash)) {
      return json({ error: "invalid_credentials", message: "Email or password is incorrect." }, 401);
    }
    logAudit(user.id, "auth.admin_login", "user", user.id);
    const response = NextResponse.json(
      { ok: true, user: { id: user.id, role: user.role, email: user.email } },
      { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
    );
    await createSession(response, user.id, user.role);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
