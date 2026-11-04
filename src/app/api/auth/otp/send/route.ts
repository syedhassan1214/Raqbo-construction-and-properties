import { NextRequest } from "next/server";
import { makeOtp, hashIdentifier, normalizePhone } from "@/lib/server/auth";
import { database, randomUUID } from "@/lib/server/database";
import { enforceRateLimit, errorResponse, json, readJson, requireSameOrigin, HttpError, requestAddress } from "@/lib/server/http";
import { otpSendSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const body = await readJson(request, otpSendSchema);
    const phone = normalizePhone(body.phone);
    const phoneHash = hashIdentifier(phone);

    enforceRateLimit(`otp-ip:${requestAddress(request)}`, 12, 60 * 60 * 1000);
    enforceRateLimit(`otp-phone:${phoneHash}`, 3, 15 * 60 * 1000);

    const otpEnabledInDevelopment =
      process.env.NODE_ENV !== "production" && process.env.RAQBO_ALLOW_DEV_OTP === "true";
    if (!otpEnabledInDevelopment) {
      throw new HttpError(
        503,
        "otp_provider_unavailable",
        "Phone verification is not configured yet. Contact the RAQBO team.",
      );
    }

    const code = makeOtp();
    const codeHash = hashIdentifier(`${phoneHash}:${code}`);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const challenge = database.prepare(`
      INSERT INTO otp_challenges(id, phone_hash, code_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    const invalidatePrevious = database.prepare(`
      UPDATE otp_challenges SET consumed_at = CURRENT_TIMESTAMP
      WHERE phone_hash = ? AND consumed_at IS NULL
    `);
    database.exec("BEGIN IMMEDIATE");
    try {
      invalidatePrevious.run(phoneHash);
      challenge.run(randomUUID(), phoneHash, codeHash, expiresAt);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    const response: { ok: true; message: string; developmentCode?: string } = {
      ok: true,
      message: "A verification code has been requested.",
    };
    if (otpEnabledInDevelopment) {
      response.developmentCode = code;
    }
    return json(response, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
