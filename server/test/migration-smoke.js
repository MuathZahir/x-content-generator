// Live-DB smoke test for the cost/abuse-hardening migration and the new usage
// counters. Unlike server-test.js (pure, no DB), this needs a real Postgres:
//
//   DATABASE_URL=postgres://... node test/migration-smoke.js
//
// It is safe to run against staging or prod: it touches only throwaway rows in
// usage_daily keyed to a unique smoke-test user id, and deletes them at the end.
// Run it once after deploying the migration to confirm the ALTER TABLE applied
// and the counters behave (the load-bearing one: refunding a call must NOT hand
// back a Discover attempt).
import assert from "node:assert/strict";
import {
  pool,
  bootstrap,
  bumpUsage,
  getUsage,
  refundUsage,
  getMonthlyUsage,
  addTokens,
  getTokenUsage,
  bumpDiscover,
  getDiscoverUsage
} from "../src/db.js";

if (!process.env.DATABASE_URL) {
  console.error("migration-smoke: set DATABASE_URL to a (staging) Postgres first.");
  process.exit(1);
}

const userId = `smoke-test-${Date.now()}`;

async function cleanup() {
  await pool.query("DELETE FROM usage_daily WHERE user_id = $1", [userId]);
}

try {
  // 1. The migration applies and is idempotent.
  await bootstrap();
  await bootstrap();

  // 2. The new columns exist on usage_daily.
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'usage_daily'`
  );
  const names = cols.rows.map((r) => r.column_name);
  assert.ok(names.includes("discovers"), "usage_daily.discovers column missing");
  assert.ok(names.includes("tokens"), "usage_daily.tokens column missing");

  // 3. addTokens before any row is a harmless no-op (no row to update yet).
  await addTokens(userId, 1000);
  assert.equal(await getTokenUsage(userId), 0, "tokens should be 0 before the call row exists");

  // 4. Call counter: reserve, then refund.
  assert.equal(await bumpUsage(userId), 1);
  assert.equal(await getUsage(userId), 1);
  assert.equal(await getMonthlyUsage(userId), 1, "monthly sum should include today");

  // 5. Token accounting accumulates against today's row.
  await addTokens(userId, 1500);
  await addTokens(userId, 500);
  assert.equal(await getTokenUsage(userId), 2000, "tokens should accumulate");

  // 6. Discover counter is independent of the call counter.
  assert.equal(await getDiscoverUsage(userId), 0);
  assert.equal(await bumpDiscover(userId), 1);
  assert.equal(await bumpDiscover(userId), 2);
  assert.equal(await getDiscoverUsage(userId), 2);

  // 7. THE LOAD-BEARING INVARIANT: refunding a call gives back the call, but
  // NEVER a Discover attempt (this is what closes the no-result retry loop).
  await refundUsage(userId);
  assert.equal(await getUsage(userId), 0, "refund should return the call");
  assert.equal(await getDiscoverUsage(userId), 2, "refund must NOT return a Discover attempt");
  assert.equal(await getTokenUsage(userId), 2000, "refund must NOT zero token accounting");

  // 8. Refund is clamped at zero (never negative).
  await refundUsage(userId);
  assert.equal(await getUsage(userId), 0, "refund must clamp at zero");

  await cleanup();
  console.log("migration smoke ok");
  await pool.end();
} catch (error) {
  await cleanup().catch(() => {});
  await pool.end().catch(() => {});
  console.error(`migration smoke FAILED: ${error.message}`);
  process.exit(1);
}
