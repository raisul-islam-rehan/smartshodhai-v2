import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/** Returns an authenticated Supabase client bound to the caller's session, or a 401 response. */
export async function requireAuthenticatedApiUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      supabase: null,
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  return { supabase, user, unauthorized: null };
}
