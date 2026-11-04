import { requireUser } from "@/lib/server/auth";
import { database } from "@/lib/server/database";
import { errorResponse, json } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function count(sql: string) {
  const result = database.prepare(sql).get() as { count: number };
  return result.count;
}

export async function GET() {
  try {
    const user = await requireUser(["admin", "moderator", "verifier", "support", "finance"]);
    return json({
      user: { id: user.id, role: user.role, email: user.email },
      counts: {
        liveListings: count("SELECT COUNT(*) AS count FROM listings WHERE status = 'live' AND is_demo = 0"),
        demoListings: count("SELECT COUNT(*) AS count FROM listings WHERE status = 'live' AND is_demo = 1"),
        pendingListings: count("SELECT COUNT(*) AS count FROM listings WHERE status = 'submitted'"),
        rejectedListings: count("SELECT COUNT(*) AS count FROM listings WHERE status = 'rejected'"),
        pausedListings: count("SELECT COUNT(*) AS count FROM listings WHERE status = 'paused'"),
        closedListings: count("SELECT COUNT(*) AS count FROM listings WHERE status IN ('sold', 'rented', 'archived')"),
        totalUsers: count("SELECT COUNT(*) AS count FROM users WHERE status != 'deleted'"),
        totalInquiries: count("SELECT COUNT(*) AS count FROM inquiries"),
        totalFavorites: count("SELECT COUNT(*) AS count FROM favorites"),
        openReports: count("SELECT COUNT(*) AS count FROM reports WHERE status IN ('open', 'investigating')"),
        openServiceRequests: count("SELECT COUNT(*) AS count FROM service_requests WHERE status NOT IN ('completed', 'closed')"),
        openVerificationCases: count("SELECT COUNT(*) AS count FROM verification_cases WHERE status IN ('requested', 'in_review', 'pending_second_review')"),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
