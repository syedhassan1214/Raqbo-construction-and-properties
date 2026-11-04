import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { HttpError } from "./http";
import { database, randomUUID } from "./database";

export const SESSION_COOKIE = "raqbo_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type UserRole =
  | "buyer"
  | "owner"
  | "admin"
  | "moderator"
  | "verifier"
  | "support"
  | "finance";

export type CurrentUser = {
  id: string;
  role: UserRole;
  email: string | null;
  displayName: string;
  status: string;
  createdAt: string;
};

function sessionSecret() {
  const secret = process.env.RAQBO_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("RAQBO_SESSION_SECRET must be set to a random secret of at least 32 bytes.");
  }
  return secret;
}

export function hashIdentifier(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

export function constantTimeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string) {
  const [algorithm, saltHex, hashHex] = stored.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function encryptPrivateValue(value: string) {
  const key = createHash("sha256")
    .update("raqbo-private-data-v1\0")
    .update(sessionSecret())
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptPrivateValue(value: string) {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Stored private value has an unsupported format.");
  }
  const key = createHash("sha256")
    .update("raqbo-private-data-v1\0")
    .update(sessionSecret())
    .digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function normalizePhone(phone: string) {
  const normalized = phone.replace(/[\s()-]/g, "");
  const international = normalized.startsWith("+") ? normalized : `+${normalized}`;
  if (!/^\+[1-9]\d{7,14}$/.test(international)) {
    throw new HttpError(400, "invalid_phone", "Enter a valid phone number in international format.");
  }
  return international;
}

export function makeOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function createSession(response: NextResponse, userId: string, role: UserRole) {
  const token = randomBytes(32).toString("base64url");
  const ttl = role === "buyer" || role === "owner" ? SESSION_TTL_SECONDS : 8 * 60 * 60;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  database
    .prepare("INSERT INTO sessions(id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), userId, hashIdentifier(token), expiresAt);

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ttl,
  });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const user = database
    .prepare(`
      SELECT users.id, users.role, users.email, users.display_name, users.status, users.created_at
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
        AND sessions.revoked_at IS NULL
        AND sessions.expires_at > ?
        AND users.status = 'active'
      LIMIT 1
    `)
    .get(hashIdentifier(token), new Date().toISOString()) as
    | {
        id: string;
        role: UserRole;
        email: string | null;
        display_name: string;
        status: string;
        created_at: string;
      }
    | undefined;

  if (!user) return null;
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    displayName: user.display_name,
    status: user.status,
    createdAt: user.created_at,
  };
}

export async function requireUser(roles?: UserRole[]) {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "unauthorized", "Sign in to continue.");
  if (user.status !== "active") throw new HttpError(403, "account_unavailable", "This account is unavailable.");
  if (roles && !roles.includes(user.role)) {
    throw new HttpError(403, "forbidden", "You do not have permission to perform this action.");
  }
  return user;
}

export async function revokeCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return;
  database
    .prepare("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL")
    .run(hashIdentifier(token));
}
