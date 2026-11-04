import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import {
  errorResponse,
  HttpError,
  json,
  logAudit,
  readJson,
  requireSameOrigin,
} from "@/lib/server/http";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type VerificationContext = { params: Promise<{ caseId: string }> };

const reviewSchema = z.object({
  decision: z.enum(["confirmed", "unconfirmed", "issue_identified", "not_checked", "revoke"]),
  evidenceSummary: z.string().trim().min(10).max(2000),
  expiresAt: z.iso.datetime().optional(),
});

const highRiskChecks = new Set([
  "authority",
  "title_documents",
  "project_approval",
  "legal_opinion",
]);

const verificationStatus = {
  identity: "identity_checked",
  authority: "authority_checked",
  title_documents: "documents_reviewed",
  project_approval: "approval_document_reviewed",
  legal_opinion: "legal_opinion_issued",
} as const;

const verificationPriority = [
  "legal_opinion_issued",
  "documents_reviewed",
  "approval_document_reviewed",
  "authority_checked",
  "identity_checked",
  "phone_confirmed",
  "not_verified",
];

export async function POST(request: NextRequest, context: VerificationContext) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(["admin", "verifier"]);
    const { caseId } = await context.params;
    const body = await readJson(request, reviewSchema);
    const verificationCase = database.prepare(`
      SELECT verification_cases.id, verification_cases.listing_id, verification_cases.check_type,
        verification_cases.status, verification_cases.reviewer_id, verification_cases.second_reviewer_id,
        listings.creator_id, listings.is_demo
      FROM verification_cases
      JOIN listings ON listings.id = verification_cases.listing_id
      WHERE verification_cases.id = ? LIMIT 1
    `).get(caseId) as {
      id: string;
      listing_id: string;
      check_type: string;
      status: string;
      reviewer_id: string | null;
      second_reviewer_id: string | null;
      creator_id: string | null;
      is_demo: number;
    } | undefined;

    if (!verificationCase || verificationCase.is_demo) {
      throw new HttpError(404, "verification_case_not_found", "This real verification case was not found.");
    }
    if (!["requested", "in_review", "pending_second_review"].includes(verificationCase.status)) {
      throw new HttpError(409, "verification_case_closed", "This verification case is no longer open.");
    }
    if (verificationCase.creator_id === user.id) {
      throw new HttpError(403, "self_review_forbidden", "You cannot review a verification case for your own listing.");
    }

    const highRisk = highRiskChecks.has(verificationCase.check_type);
    const secondReview = verificationCase.status === "pending_second_review";
    if (secondReview && verificationCase.reviewer_id === user.id) {
      throw new HttpError(403, "independent_review_required", "A different reviewer must complete the second sign-off.");
    }
    if (secondReview && body.decision === "confirmed") {
      const result = database.prepare(`
        UPDATE verification_cases SET status = 'confirmed', evidence_summary = ?,
          second_reviewer_id = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending_second_review'
          AND second_reviewer_id IS NULL AND reviewer_id != ?
      `).run(body.evidenceSummary, user.id, body.expiresAt ?? null, caseId, user.id);
      if (Number(result.changes) !== 1) {
        throw new HttpError(409, "verification_case_changed", "This case was already reviewed by another verifier.");
      }
      updateListingVerification(verificationCase.listing_id);
      logAudit(user.id, "verification.second_approval", "verification_case", caseId, {
        listingId: verificationCase.listing_id,
      });
      return json({ id: caseId, status: "confirmed", secondApproval: true });
    }
    if (secondReview && body.decision === "revoke") {
      const result = database.prepare(`
        UPDATE verification_cases SET status = 'revoked', evidence_summary = ?,
          second_reviewer_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending_second_review'
          AND second_reviewer_id IS NULL AND reviewer_id != ?
      `).run(body.evidenceSummary, user.id, caseId, user.id);
      if (Number(result.changes) !== 1) {
        throw new HttpError(409, "verification_case_changed", "This case was already reviewed by another verifier.");
      }
      updateListingVerification(verificationCase.listing_id);
      logAudit(user.id, "verification.revoked", "verification_case", caseId, {
        listingId: verificationCase.listing_id,
      });
      return json({ id: caseId, status: "revoked" });
    }
    if (secondReview) {
      throw new HttpError(409, "second_review_pending", "Only confirm or revoke is allowed during second-review sign-off.");
    }
    if (verificationCase.reviewer_id && verificationCase.reviewer_id !== user.id) {
      throw new HttpError(409, "reviewer_assigned", "Another reviewer has started this case.");
    }

    const nextStatus =
      body.decision === "revoke" ? "revoked" :
        highRisk && body.decision === "confirmed" ? "pending_second_review" : body.decision;
    const reviewedAt = nextStatus === "pending_second_review" ? null : new Date().toISOString();
    const result = database.prepare(`
      UPDATE verification_cases SET status = ?, evidence_summary = ?, reviewer_id = ?,
        reviewed_at = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN ('requested', 'in_review', 'pending_second_review')
        AND (reviewer_id IS NULL OR reviewer_id = ?)
    `).run(nextStatus, body.evidenceSummary, user.id, reviewedAt, body.expiresAt ?? null, caseId, user.id);
    if (Number(result.changes) !== 1) {
      throw new HttpError(409, "verification_case_changed", "Another verifier has updated this case.");
    }

    if (nextStatus !== "pending_second_review") {
      updateListingVerification(verificationCase.listing_id);
    }
    logAudit(user.id, `verification.${body.decision}`, "verification_case", caseId, {
      listingId: verificationCase.listing_id,
      secondReviewRequired: nextStatus === "pending_second_review",
    });
    return json({
      id: caseId,
      status: nextStatus,
      secondReviewRequired: nextStatus === "pending_second_review",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function updateListingVerification(listingId: string) {
  const activeCases = database.prepare(`
    SELECT check_type FROM verification_cases
    WHERE listing_id = ? AND status = 'confirmed'
      AND (expires_at IS NULL OR expires_at > ?)
  `).all(listingId, new Date().toISOString()) as { check_type: string }[];
  const creator = database.prepare(`
    SELECT users.phone_hash FROM listings
    JOIN users ON users.id = listings.creator_id
    WHERE listings.id = ?
  `).get(listingId) as { phone_hash: string | null } | undefined;
  const candidates = [
    ...(creator?.phone_hash ? ["phone_confirmed"] : []),
    ...activeCases
      .map((item) => verificationStatus[item.check_type as keyof typeof verificationStatus])
      .filter(Boolean),
  ];
  const next = verificationPriority.find((status) => candidates.includes(status)) ?? "not_verified";
  database.prepare("UPDATE listings SET verification_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(next, listingId);
}
