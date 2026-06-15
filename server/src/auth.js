import { betterAuth } from "better-auth";
import pg from "pg";

const { Pool } = pg;

// Polar is optional at boot so the server can deploy before billing
// credentials exist; checkout/portal routes appear once POLAR_ACCESS_TOKEN is
// set. Everything degrades to the free plan until then.
async function buildPolarPlugin() {
  if (!process.env.POLAR_ACCESS_TOKEN) return null;

  const { polar, checkout, portal, webhooks } = await import("@polar-sh/better-auth");
  const { Polar } = await import("@polar-sh/sdk");
  const { setBilling } = await import("./db.js");

  const polarClient = new Polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN,
    server: process.env.POLAR_SERVER === "production" ? "production" : "sandbox"
  });

  const products = [];
  if (process.env.POLAR_PRODUCT_PRO_MONTHLY) {
    products.push({ productId: process.env.POLAR_PRODUCT_PRO_MONTHLY, slug: "pro" });
  }
  if (process.env.POLAR_PRODUCT_PRO_YEARLY) {
    products.push({ productId: process.env.POLAR_PRODUCT_PRO_YEARLY, slug: "pro-yearly" });
  }

  const use = [
    checkout({
      products,
      successUrl: "/success?checkout_id={CHECKOUT_ID}",
      authenticatedUsersOnly: true,
      theme: "dark"
    }),
    portal()
  ];

  if (process.env.POLAR_WEBHOOK_SECRET) {
    use.push(
      webhooks({
        secret: process.env.POLAR_WEBHOOK_SECRET,
        onCustomerStateChanged: async (payload) => {
          const state = payload.data || payload;
          const userId = state.externalId || state.external_id;
          if (!userId) return;
          const subs = (state.activeSubscriptions || state.active_subscriptions || []);
          const active = subs[0];
          await setBilling(userId, {
            plan: active ? "pro" : "free",
            status: active ? (active.status || "active") : "none",
            productId: active?.productId || active?.product_id || null,
            currentPeriodEnd: active?.currentPeriodEnd || active?.current_period_end || null
          });
        }
      })
    );
  }

  return polar({
    client: polarClient,
    createCustomerOnSignUp: true,
    use
  });
}

const plugins = [];
const polarPlugin = await buildPolarPlugin();
if (polarPlugin) plugins.push(polarPlugin);

// Sign-in is always initiated from a hosted page (heypenn.com/connect), but the
// same service is also reachable at its Railway-generated URL. Better Auth
// rejects any request whose Origin isn't trusted ("invalid origin"); by default
// it trusts only baseURL, so a baseURL/page-origin mismatch breaks sign-in.
// Trust both public domains so the flow works regardless of which one served
// the page. Extra origins can be appended via TRUSTED_ORIGINS (comma-separated).
const trustedOrigins = [
  process.env.BETTER_AUTH_URL,
  "https://heypenn.com",
  "https://api-production-98f2.up.railway.app",
  ...(process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) || [])
].filter(Boolean);

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins,
  secret: process.env.BETTER_AUTH_SECRET,
  database: new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }),
  socialProviders: process.env.GOOGLE_CLIENT_ID
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET
        }
      }
    : {},
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24
  },
  plugins
});
