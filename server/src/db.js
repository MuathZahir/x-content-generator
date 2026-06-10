import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10
});

// App tables only. Better Auth owns user/session/account/verification and is
// migrated with `npm run migrate` (@better-auth/cli).
export async function bootstrap() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_pairing (
      code text PRIMARY KEY,
      secret_hash text NOT NULL,
      user_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      claimed_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS device_token (
      token_hash text PRIMARY KEY,
      user_id text NOT NULL,
      label text NOT NULL DEFAULT 'chrome-extension',
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz,
      revoked_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS device_token_user_idx ON device_token (user_id);

    CREATE TABLE IF NOT EXISTS billing (
      user_id text PRIMARY KEY,
      plan text NOT NULL DEFAULT 'free',
      status text NOT NULL DEFAULT 'none',
      product_id text,
      current_period_end timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usage_daily (
      user_id text NOT NULL,
      day date NOT NULL,
      calls integer NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
  `);
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function newToken() {
  return `penn_${crypto.randomBytes(32).toString("hex")}`;
}

export function newPairingCode() {
  // 8 chars, unambiguous alphabet, shown to the user in the connect page URL.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// --- Device pairing ----------------------------------------------------------

// The extension keeps `secret` locally and never puts it in a URL; the browser
// tab only ever sees `code`. A long-lived token is minted at claim time only,
// so no plaintext credential is ever at rest.
export async function createPairing() {
  const code = newPairingCode();
  const secret = crypto.randomBytes(24).toString("hex");
  await pool.query("DELETE FROM device_pairing WHERE created_at < now() - interval '1 hour'");
  await pool.query(
    "INSERT INTO device_pairing (code, secret_hash) VALUES ($1, $2)",
    [code, hashToken(secret)]
  );
  return { code, secret };
}

export async function approvePairing(code, userId) {
  const result = await pool.query(
    `UPDATE device_pairing SET user_id = $2
     WHERE code = $1 AND claimed_at IS NULL AND created_at > now() - interval '10 minutes'
     RETURNING code`,
    [code, userId]
  );
  return result.rowCount > 0;
}

export async function claimPairing(code, secret) {
  const result = await pool.query(
    `UPDATE device_pairing SET claimed_at = now()
     WHERE code = $1 AND secret_hash = $2 AND user_id IS NOT NULL AND claimed_at IS NULL
     RETURNING user_id`,
    [code, hashToken(secret)]
  );
  const userId = result.rows[0]?.user_id;
  if (!userId) return null;

  const token = newToken();
  await pool.query(
    "INSERT INTO device_token (token_hash, user_id) VALUES ($1, $2)",
    [hashToken(token), userId]
  );
  return { userId, token };
}

export async function resolveToken(token) {
  if (!token || !token.startsWith("penn_")) return null;
  const result = await pool.query(
    `UPDATE device_token SET last_used_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING user_id`,
    [hashToken(token)]
  );
  return result.rows[0]?.user_id || null;
}

export async function revokeToken(token) {
  await pool.query(
    "UPDATE device_token SET revoked_at = now() WHERE token_hash = $1",
    [hashToken(token)]
  );
}

// --- Billing -------------------------------------------------------------------

export async function getBilling(userId) {
  const result = await pool.query("SELECT * FROM billing WHERE user_id = $1", [userId]);
  const row = result.rows[0];
  if (!row) return { plan: "free", status: "none" };
  const active = row.status === "active" || row.status === "trialing";
  const unexpired = !row.current_period_end || new Date(row.current_period_end) > new Date(Date.now() - 24 * 3600 * 1000);
  return {
    plan: active && unexpired ? "pro" : "free",
    status: row.status,
    currentPeriodEnd: row.current_period_end
  };
}

export async function setBilling(userId, { plan, status, productId, currentPeriodEnd }) {
  await pool.query(
    `INSERT INTO billing (user_id, plan, status, product_id, current_period_end, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE
     SET plan = $2, status = $3, product_id = $4, current_period_end = $5, updated_at = now()`,
    [userId, plan, status, productId || null, currentPeriodEnd || null]
  );
}

// --- Usage ----------------------------------------------------------------------

export async function bumpUsage(userId) {
  const result = await pool.query(
    `INSERT INTO usage_daily (user_id, day, calls) VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET calls = usage_daily.calls + 1
     RETURNING calls`,
    [userId]
  );
  return result.rows[0].calls;
}

export async function getUsage(userId) {
  const result = await pool.query(
    "SELECT calls FROM usage_daily WHERE user_id = $1 AND day = CURRENT_DATE",
    [userId]
  );
  return result.rows[0]?.calls || 0;
}
