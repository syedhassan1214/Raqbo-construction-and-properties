import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  constantTimeStringEqual,
  encryptPrivateValue,
  hashIdentifier,
  normalizePhone,
  type UserRole,
} from "@/lib/server/auth";
import { database, randomUUID } from "@/lib/server/database";
import {
  enforceRateLimit,
  errorResponse,
  json,
  logAudit,
  readJson,
  requireSameOrigin,
  requestAddress,
} from "@/lib/server/http";
import { otpVerifySchema } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const body = await readJson(request, otpVerifySchema);
    const phone = normalizePhone(body.phone);
    const phoneHash = hashIdentifier(phone);

    enforceRateLimit(`otp-verify-ip:${requestAddress(request)}`, 20, 60 * 60 * 1000);
    enforceRateLimit(`otp-verify-phone:${phoneHash}`, 8, 15 * 60 * 1000);

    const challenge = database
      .prepare(`
        SELECT id, code_hash, expires_at, attempts
        FROM otp_challenges
        WHERE phone_hash = ? AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get(phoneHash) as
      | { id: string; code_hash: string; expires_at: string; attempts: number }
      | undefined;

    if (!challenge || challenge.expires_at <= new Date().toISOString() || challenge.attempts >= 5) {
      return json(
        { error: "otp_invalid_or_expired", message: "The code is invalid or expired. Request a new one." },
        400,
      );
    }

    const submittedHash = hashIdentifier(`${phoneHash}:${body.code}`);
    if (!constantTimeStringEqual(submittedHash, challenge.code_hash)) {
      database.prepare(`
        UPDATE otp_challenges SET attempts = attempts + 1
        WHERE id = ? AND consumed_at IS NULL AND attempts < 5
      `)
        .run(challenge.id);
      return json({ error: "otp_invalid", message: "The verification code is incorrect." }, 400);
    }

    database.exec("BEGIN IMMEDIATE");
    let userId: string;
    let role: UserRole;
    try {
      const consumed = database.prepare(`
        UPDATE otp_challenges SET consumed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < 5
      `).run(challenge.id, new Date().toISOString());
      if (Number(consumed.changes) !== 1) {
        throw new Error("OTP challenge was already consumed or expired.");
      }

      const existingUser = database
        .prepare("SELECT id, role, status FROM users WHERE phone_hash = ? LIMIT 1")
        .get(phoneHash) as { id: string; role: UserRole; status: string } | undefined;
      if (existingUser?.status === "suspended" || existingUser?.status === "deletion_requested") {
        throw new Error("This user account is unavailable.");
      }
      if (existingUser?.status === "deleted") {
        database.prepare("UPDATE users SET phone_hash = NULL WHERE id = ?").run(existingUser.id);
      }
      const availableUser = existingUser?.status === "deleted" ? undefined : existingUser;
      userId = availableUser?.id ?? randomUUID();
      role = availableUser?.role ?? "buyer";
      if (!availableUser) {
        database.prepare(`
          INSERT INTO users(id, role, phone_hash, phone_encrypted, display_name)
          VALUES (?, 'buyer', ?, ?, ?)
        `).run(userId, phoneHash, encryptPrivateValue(phone), body.displayName ?? "");
      } else {
        database.prepare(`
          UPDATE users SET display_name = COALESCE(NULLIF(?, ''), display_name),
            phone_encrypted = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(body.displayName ?? "", encryptPrivateValue(phone), userId);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      if (error instanceof Error && error.message === "This user account is unavailable.") {
        return json({ error: "account_unavailable", message: "This account is unavailable." }, 403);
      }
      if (error instanceof Error && error.message === "OTP challenge was already consumed or expired.") {
        return json({ error: "otp_invalid_or_expired", message: "The code is invalid or expired. Request a new one." }, 400);
      }
      throw error;
    }

    logAudit(userId, "auth.phone_verified", "user", userId);
    const response = NextResponse.json({ ok: true, user: { id: userId, role } }, {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
    await createSession(response, userId, role);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
