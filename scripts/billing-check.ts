/**
 * Read-only check of every subscriber with a Paddle subscription: what the site stores, what
 * Paddle says about the subscription and customer, and whether "Manage billing" can open for them.
 * Prints subscriber ids, never email addresses. Changes nothing. Usage: npm run billing-check
 */
import { getCustomer, getSubscription } from "../src/lib/billing/paddle";
import { getSql } from "../src/lib/db";
import { normalizeEmail } from "../src/lib/subscribers";

async function main() {
  const sql = getSql();
  const rows = await sql<{ id: number; email: string; billing_status: string | null; paddle_subscription_id: string | null; paddle_customer_id: string | null; verified: boolean; confirmed: boolean }[]>`
    select id::int as id, email, billing_status, paddle_subscription_id, paddle_customer_id,
           paddle_customer_verified_at is not null as verified, confirmed_at is not null as confirmed
    from subscribers where paddle_subscription_id is not null or paddle_customer_id is not null order by id`;
  console.log(`${rows.length} subscriber(s) with Paddle billing. API key set: ${Boolean(process.env.PADDLE_API_KEY)}, env: ${process.env.NEXT_PUBLIC_PADDLE_ENV ?? "(unset)"}`);
  for (const r of rows) {
    const out: string[] = [`#${r.id}`, `site status=${r.billing_status}`, `confirmed=${r.confirmed}`, `sub=${r.paddle_subscription_id ? "yes" : "no"}`, `customer stored=${r.paddle_customer_id ? "yes" : "no"}`, `verified=${r.verified}`];
    let customerId = r.paddle_customer_id;
    if (r.paddle_subscription_id) {
      const t = Date.now();
      try {
        const s = await getSubscription(r.paddle_subscription_id, { timeoutMs: 15000 });
        out.push(`paddle sub=${s.status}${s.scheduled_change ? ` (scheduled ${s.scheduled_change.action})` : ""} in ${Date.now() - t}ms`);
        if (customerId && customerId !== s.customer_id) out.push("STORED CUSTOMER DIFFERS FROM SUBSCRIPTION'S");
        customerId ??= s.customer_id;
      } catch (e) {
        out.push(`subscription read FAILED in ${Date.now() - t}ms: ${(e as Error).message}`);
      }
    }
    if (customerId) {
      const t = Date.now();
      try {
        const c = await getCustomer(customerId, { timeoutMs: 15000 });
        out.push(`customer read in ${Date.now() - t}ms, email ${normalizeEmail(String(c?.email ?? "")) === r.email ? "MATCHES" : "DIFFERS"}`);
      } catch (e) {
        out.push(`customer read FAILED in ${Date.now() - t}ms: ${(e as Error).message}`);
      }
    }
    console.log(out.join(" | "));
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
