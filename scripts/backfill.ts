// One-time backfill: copy existing Stripe PaymentIntents into the orders table.
//
//   npm run backfill -- --dry-run   # show what would happen, write nothing
//   npm run backfill                # actually insert
//
// Idempotent — re-running skips rows that already exist (payment_intent_id is
// unique and we upsert with ignoreDuplicates), so it is safe to run again if it
// dies partway through a large history.
//
// THE IMPORTANT PART: every backfilled row gets alert_played_at set to now().
// Historic tips must never be announced on stream. Without this, the first time
// the alert widget runs its reconciliation poll after cutover it would find your
// entire back catalogue "unplayed" and read all of it aloud.

import { stripe } from "../lib/stripe";
import { supabase, statusFromStripe } from "../lib/supabase";
import { isCurrency } from "../lib/money";

const DRY_RUN = process.argv.includes("--dry-run");
const PAGE_SIZE = 100;

type Insert = {
  payment_intent_id: string;
  customer_name: string;
  message: string | null;
  amount_minor: number;
  currency: string;
  show_on_screen: boolean;
  status: string;
  alert_played_at: string;
  created_at: string;
};

async function main() {
  console.log(DRY_RUN ? "DRY RUN — nothing will be written\n" : "Backfilling orders from Stripe…\n");

  let startingAfter: string | undefined;
  let scanned = 0;
  let skippedAbandoned = 0;
  let skippedCurrency = 0;
  let inserted = 0;
  const now = new Date().toISOString();

  for (;;) {
    const page = await stripe.paymentIntents.list({
      limit: PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    const rows: Insert[] = [];
    for (const pi of page.data) {
      scanned++;

      // A card intent that was created but never confirmed. It represents a
      // payer who opened the form and left — noise, not an order. The old
      // dashboard filtered these out too.
      if (pi.status === "requires_payment_method") {
        skippedAbandoned++;
        continue;
      }

      if (!isCurrency(pi.currency)) {
        console.warn(`  ! ${pi.id}: unsupported currency "${pi.currency}" — skipped`);
        skippedCurrency++;
        continue;
      }

      rows.push({
        payment_intent_id: pi.id,
        customer_name: pi.metadata?.customer_name || "Anonymous",
        message: pi.metadata?.message || null,
        amount_minor: pi.amount,
        currency: pi.currency,
        show_on_screen: pi.metadata?.show_on_screen !== "false",
        status: statusFromStripe(pi.status),
        alert_played_at: now, // never re-announce history
        created_at: new Date(pi.created * 1000).toISOString(),
      });
    }

    if (rows.length && !DRY_RUN) {
      const { data, error } = await supabase
        .from("orders")
        .upsert(rows, { onConflict: "payment_intent_id", ignoreDuplicates: true })
        // Count the rows PostgREST actually returns rather than trusting a
        // count header. With ignoreDuplicates the header can come back null,
        // which made a perfectly good run report "inserted 0" — indistinguish-
        // able from a broken one. Returned rows exclude skipped duplicates, so
        // this number is the truth on a re-run too.
        .select("payment_intent_id");
      if (error) {
        console.error("\nInsert failed:", error.message);
        process.exit(1);
      }
      inserted += data?.length ?? 0;
    } else {
      inserted += rows.length;
    }

    process.stdout.write(`\r  scanned ${scanned}…`);

    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  console.log("\n");
  console.log(`  scanned             ${scanned}`);
  console.log(`  skipped (abandoned) ${skippedAbandoned}`);
  if (skippedCurrency) console.log(`  skipped (currency)  ${skippedCurrency}`);
  console.log(`  ${DRY_RUN ? "would insert" : "inserted"}        ${inserted}`);

  if (DRY_RUN) {
    console.log("\nDry run complete — nothing was written.");
    console.log("Run `npm run backfill` (no --dry-run) to actually insert.");
    return;
  }

  // Read back from the database rather than reporting only what we believe we
  // sent. If this says 0 after a successful-looking run, the problem is the
  // connection or the schema, not the Stripe side — and you learn that here
  // instead of when the dashboard turns up empty.
  const { count: total, error: countError } = await supabase
    .from("orders")
    .select("payment_intent_id", { count: "exact", head: true });

  if (countError) {
    console.log(`\nInserted, but could not verify: ${countError.message}`);
  } else {
    console.log(`  rows now in orders  ${total ?? "?"}`);
  }

  const { count: unplayed } = await supabase
    .from("orders")
    .select("payment_intent_id", { count: "exact", head: true })
    .is("alert_played_at", null);

  console.log("\nDone.");
  // The one thing that must be zero. A backfilled row with a null
  // alert_played_at would be announced on stream the next time the widget
  // polls — your entire back catalogue, read aloud.
  if (unplayed && unplayed > 0) {
    console.log(
      `WARNING: ${unplayed} row(s) have alert_played_at = NULL and WILL announce on stream.`
    );
  } else {
    console.log("All rows have alert_played_at set — nothing will announce on stream.");
  }
}

main().catch((err) => {
  console.error("\nBackfill failed:", err);
  process.exit(1);
});
