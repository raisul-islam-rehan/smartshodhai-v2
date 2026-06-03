import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/user-role";

export const PRODUCT_SELECT_FULL_OWNER =
  "id, name, stock_qty, unit, reorder_level, cost_price, selling_price, category, barcode, created_at" as const;
export const PRODUCT_SELECT_FULL_STAFF =
  "id, name, stock_qty, unit, reorder_level, selling_price, category, barcode, created_at" as const;

const PRODUCT_SELECT_COMPACT_OWNER =
  "id, name, stock_qty, unit, reorder_level, cost_price, selling_price" as const;
const PRODUCT_SELECT_COMPACT_STAFF =
  "id, name, stock_qty, unit, reorder_level, selling_price" as const;

export type ProductSelectVariant = "full" | "compact";

export function productSelectFields(
  role: UserRole,
  variant: ProductSelectVariant = "full"
):
  | typeof PRODUCT_SELECT_FULL_OWNER
  | typeof PRODUCT_SELECT_FULL_STAFF
  | typeof PRODUCT_SELECT_COMPACT_OWNER
  | typeof PRODUCT_SELECT_COMPACT_STAFF {
  if (variant === "compact") {
    return role === "owner" ? PRODUCT_SELECT_COMPACT_OWNER : PRODUCT_SELECT_COMPACT_STAFF;
  }
  return role === "owner" ? PRODUCT_SELECT_FULL_OWNER : PRODUCT_SELECT_FULL_STAFF;
}

export function productsSelectQuery(
  supabase: SupabaseClient,
  ownerId: string,
  role: UserRole,
  variant: ProductSelectVariant = "full"
) {
  if (variant === "compact") {
    if (role === "owner") {
      return supabase
        .from("products")
        .select(PRODUCT_SELECT_COMPACT_OWNER)
        .eq("owner_id", ownerId);
    }
    return supabase
      .from("products")
      .select(PRODUCT_SELECT_COMPACT_STAFF)
      .eq("owner_id", ownerId);
  }

  if (role === "owner") {
    return supabase.from("products").select(PRODUCT_SELECT_FULL_OWNER).eq("owner_id", ownerId);
  }
  return supabase.from("products").select(PRODUCT_SELECT_FULL_STAFF).eq("owner_id", ownerId);
}
