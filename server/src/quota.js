import { getBilling, getUsage, bumpUsage } from "./db.js";

// Value ladder: replying is free forever (capped daily, fast model). Pro
// unlocks the growth surface: original posts, product promotion, web-grounded
// drafts, model choice, and a cap nobody honest will hit.
export const PLANS = {
  free: {
    name: "Free",
    dailyCalls: 5,
    models: ["gpt-5.4-mini"],
    defaultModel: "gpt-5.4-mini",
    webSearch: false,
    compose: false
  },
  pro: {
    name: "Pro",
    dailyCalls: 400,
    models: ["gpt-5.4", "gpt-5.4-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
    defaultModel: "gpt-5.4",
    webSearch: true,
    compose: true
  }
};

export class QuotaError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function getEntitlements(userId) {
  const billing = await getBilling(userId);
  const plan = PLANS[billing.plan] || PLANS.free;
  const used = await getUsage(userId);
  return {
    plan: billing.plan,
    status: billing.status,
    currentPeriodEnd: billing.currentPeriodEnd || null,
    limits: {
      dailyCalls: plan.dailyCalls,
      models: plan.models,
      webSearch: plan.webSearch,
      compose: plan.compose
    },
    usedToday: used,
    remainingToday: Math.max(0, plan.dailyCalls - used)
  };
}

// Resolves the request into {model, webSearch} the user is entitled to, and
// consumes one call. Throws QuotaError with a stable code the extension maps
// to UI (upgrade prompt vs. plain error).
export async function authorizeCall(userId, { kind, requestedModel, webSearch }) {
  const billing = await getBilling(userId);
  const plan = PLANS[billing.plan] || PLANS.free;

  if (kind === "compose" && !plan.compose) {
    throw new QuotaError(
      "upgrade_required",
      "Writing original posts and promoting products is a Pro feature. Replies stay free."
    );
  }

  const used = await getUsage(userId);
  if (used >= plan.dailyCalls) {
    throw new QuotaError(
      billing.plan === "free" ? "free_limit_reached" : "rate_limited",
      billing.plan === "free"
        ? `You've used today's ${plan.dailyCalls} free generations. Upgrade to Pro for ${PLANS.pro.dailyCalls}/day, posts, and the best model.`
        : "Daily fair-use limit reached. It resets at midnight UTC."
    );
  }

  await bumpUsage(userId);

  const model = plan.models.includes(requestedModel) ? requestedModel : plan.defaultModel;
  return {
    model,
    webSearch: Boolean(webSearch) && plan.webSearch,
    plan: billing.plan
  };
}
