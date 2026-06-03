import type { SupabaseClient } from "@supabase/supabase-js";

export type UserRole = "owner" | "staff";

export function normalizeUserRole(role: string | null | undefined): UserRole {
  return role === "staff" ? "staff" : "owner";
}

export async function fetchUserRole(
  supabase: SupabaseClient,
  userId: string
): Promise<UserRole> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  return normalizeUserRole(profile?.role);
}

/** Clears legacy client-side role cache from older app versions. */
export function clearLegacyUserRoleCache() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("userRole");
}
