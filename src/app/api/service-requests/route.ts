import { NextRequest } from "next/server";
import { encryptPrivateValue, getCurrentUser } from "@/lib/server/auth";
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
import { serviceRequestSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    enforceRateLimit(`service-request-ip:${requestAddress(request)}`, 5, 60 * 60 * 1000);
    const body = await readJson(request, serviceRequestSchema);
    const user = await getCurrentUser();
    const id = randomUUID();
    const phoneEncrypted = encryptPrivateValue(body.phone);
    database.prepare(`
      INSERT INTO service_requests(id, requester_id, name, phone_encrypted, city, service_type, message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, user?.id ?? null, body.name, phoneEncrypted, body.city, body.serviceType, body.message);
    logAudit(user?.id ?? null, "service_request.created", "service_request", id, {
      serviceType: body.serviceType,
      city: body.city,
      consentGiven: body.consent,
    });
    return json({ id, status: "submitted", message: "Your request has been securely recorded." }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
