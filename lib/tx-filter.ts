// Shared message-panel filters for the transactions list + its CSV export.
//
// EXPIRED is deliberately excluded from "all" (and never gets its own tab) — an
// expired QR that was never paid is noise in the owner's message panel. Each mode
// is a complete WHERE the caller can't otherwise reach:
//   all      everything except EXPIRED
//   shown    succeeded, on-screen, and already played on stream
//   private  the payer kept it off-screen (show_on_screen = false)
//   queue    succeeded, on-screen, not yet played (waiting for the overlay)
//   pending  payment not settled yet (PENDING)

export type TxFilter = "all" | "shown" | "private" | "queue" | "pending";

const FILTERS = new Set<TxFilter>(["all", "shown", "private", "queue", "pending"]);

export function parseTxFilter(value: string | null): TxFilter {
  return value && FILTERS.has(value as TxFilter) ? (value as TxFilter) : "all";
}

// Applies the filter's WHERE clauses to a Supabase query builder. Typed loosely
// because the builder's chained methods each return a fresh builder type; the
// concrete type is preserved for the caller via the generic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyTxFilter<T extends { neq: any; eq: any; is: any; not: any }>(query: T, filter: TxFilter): T {
  switch (filter) {
    case "shown":
      return query.eq("status", "SUCCESS").eq("show_on_screen", true).not("alert_played_at", "is", null);
    case "private":
      return query.eq("show_on_screen", false).neq("status", "EXPIRED");
    case "queue":
      return query.eq("status", "SUCCESS").eq("show_on_screen", true).is("alert_played_at", null);
    case "pending":
      return query.eq("status", "PENDING");
    default:
      return query.neq("status", "EXPIRED");
  }
}
