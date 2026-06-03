# SmartShodhai Security Notes

## Supabase Row Level Security (RLS)

**Manual action required in the Supabase dashboard:** enable RLS on all tables and add policies scoped to `auth.uid()`:

- `products`
- `baki`
- `sales_log`
- `profiles`
- `baki_payments` (if used)

Without RLS, the anon key alone does not protect tenant data.

## Staff roles and sensitive fields

The UI loads `role` from the `profiles` table per session (`lib/user-role.ts`) and hides `cost_price` and profit KPIs for `staff`. **Client-side checks are not sufficient on their own.**

Staff users must also be blocked at the **Supabase query/RLS level** (e.g. exclude `cost_price` via a view, column-level policy, or server-side role check). Product reads use `lib/products-query.ts` to omit `cost_price` from SELECT for staff.

## API rate limiting

Gemini calls in `/app/api/chat` and `/app/api/ocr` should be rate-limited per authenticated user in production (e.g. Upstash Redis, Vercel KV, or edge middleware).
