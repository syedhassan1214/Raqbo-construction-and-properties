import { NextRequest, NextResponse } from "next/server";
import { revokeCurrentSession, SESSION_COOKIE } from "@/lib/server/auth";
import { errorResponse, HttpError, requireSameOrigin } from "@/lib/server/http";
import { getSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    if (isSupabaseConfigured()) {
      const supabase = await getSupabaseServerClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        console.error("Supabase sign-out failed:", error.message);
        throw new HttpError(502, "sign_out_failed", "Could not end the Supabase session. Please try again.");
      }
    }
    await revokeCurrentSession();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
