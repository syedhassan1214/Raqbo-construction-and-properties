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
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import {
  enforceRateLimit,
  errorResponse,
  HttpError,
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

    let supabaseAuthId: string | null = null;
    let supabaseClient: Awaited<ReturnType<typeof getSupabaseServerClient>> | null = null;
    if (isSupabaseConfigured()) {
      supabaseClient = await getSupabaseServerClient();
      const { data, error } = await supabaseClient.auth.verifyOtp({
        phone,
        token: body.code,
        type: "sms",
      });
      if (error) {
        if (error.status !== 400 && error.status !== 422 && error.status !== 429) {
          console.error("Supabase phone OTP verification failed:", error.message);
        }
        return json(
          {
            error: error.status === 429 ? "otp_rate_limited" : "otp_invalid_or_expired",
            message: error.status === 429
              ? "Too many verification attempts. Please try again later."
              : error.status === 400 || error.status === 422
                ? "The code is invalid or expired. Request a new one."
                : "Phone verification could not be completed. Please try again.",
          },
          error.status === 429 ? 429 : error.status === 400 || error.status === 422 ? 400 : 502,
        );
      }
      if (!data.user?.id || data.user.phone !== phone) {
        throw new HttpError(502, "otp_identity_missing", "Supabase did not return the verified phone identity.");
      }
      supabaseAuthId = data.user.id;
    } else {
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
    }

    database.exec("BEGIN IMMEDIATE");
    let userId: string;
    let role: UserRole;
    try {
      if (!supabaseAuthId) {
        const challenge = database
          .prepare(`
            SELECT id FROM otp_challenges
            WHERE phone_hash = ? AND consumed_at IS NULL
              AND expires_at > ? AND attempts < 5
            ORDER BY created_at DESC
            LIMIT 1
          `)
          .get(phoneHash, new Date().toISOString()) as { id: string } | undefined;
        if (!challenge) throw new Error("OTP challenge was already consumed or expired.");
        const consumed = database.prepare(`
          UPDATE otp_challenges SET consumed_at = CURRENT_TIMESTAMP
          WHERE id = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < 5
        `).run(challenge.id, new Date().toISOString());
        if (Number(consumed.changes) !== 1) throw new Error("OTP challenge was already consumed or expired.");
      }

      const existingUser = database
        .prepare("SELECT id, role, status FROM users WHERE phone_hash = ? LIMIT 1")
        .get(phoneHash) as { id: string; role: UserRole; status: string } | undefined;
      if (existingUser?.status === "suspended" || existingUser?.status === "deletion_requested") {
        throw new Error("This user account is unavailable.");
      }
      if (existingUser?.status === "deleted") {
        database.prepare("UPDATE users SET phone_hash = NULL, supabase_auth_id = NULL WHERE id = ?").run(existingUser.id);
      }
      const availableUser = existingUser?.status === "deleted" ? undefined : existingUser;
      userId = availableUser?.id ?? randomUUID();
      role = availableUser?.role ?? "buyer";
      if (!availableUser) {
        database.prepare(`
          INSERT INTO users(id, role, phone_hash, supabase_auth_id, phone_encrypted, display_name)
          VALUES (?, 'buyer', ?, ?, ?, ?)
        `).run(userId, phoneHash, supabaseAuthId, encryptPrivateValue(phone), body.displayName ?? "");
      } else {
        database.prepare(`
          UPDATE users SET display_name = COALESCE(NULLIF(?, ''), display_name),
            phone_encrypted = ?, supabase_auth_id = COALESCE(?, supabase_auth_id),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(body.displayName ?? "", encryptPrivateValue(phone), supabaseAuthId, userId);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      if (error instanceof Error && error.message === "This user account is unavailable.") {
        if (supabaseClient) {
          const { error: signOutError } = await supabaseClient.auth.signOut({ scope: "local" });
          if (signOutError) {
            console.error("Could not clear Supabase session for unavailable account:", signOutError.message);
          }
        }
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
