#!/usr/bin/env bash
# Inspect Polar account via the CLI's stored token and (optionally) provision
# the penn AI server pieces: webhook endpoint + organization access token.
# Run inside WSL: bash polar-setup.sh [inspect|provision]
set -euo pipefail

MODE="${1:-inspect}"

python3 - "$MODE" <<'PY'
import json, sys, urllib.request, urllib.error

mode = sys.argv[1]
cfg = json.load(open("/home/user/.polar/tokens.json"))["production"]
tok = cfg["token"]
base = "https://api.polar.sh" if cfg.get("server") == "production" else "https://sandbox-api.polar.sh"
env = "production" if "api.polar.sh" in base else "sandbox"

HEADERS = {
    "Authorization": f"Bearer {tok}",
    "Content-Type": "application/json",
    "User-Agent": "pennai-setup/1.0 (+https://heypenn.com)",
    "Accept": "application/json",
}

def call(method, path, body=None):
    req = urllib.request.Request(
        base + path, method=method, headers=HEADERS,
        data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read()[:400].decode(errors="replace")
        raise SystemExit(f"HTTP {e.code} on {method} {path}: {detail}")

orgs = call("GET", "/v1/organizations/?limit=5")
items = orgs.get("items", [])
if not items:
    raise SystemExit("NO_ORGS")
for o in items:
    print(f"org: {o['id']}  slug={o.get('slug')}  name={o.get('name')}")
org_id = items[0]["id"]

products = call("GET", f"/v1/products/?organization_id={org_id}&limit=20")
print("\nPRODUCTS:")
for p in products.get("items", []):
    prices = []
    for pr in p.get("prices", []):
        amt = pr.get("price_amount")
        cur = pr.get("price_currency", "usd")
        interval = pr.get("recurring_interval") or p.get("recurring_interval")
        prices.append(f"{(amt or 0)/100:.2f} {cur} / {interval} (amount_type={pr.get('amount_type')})")
    print(json.dumps({
        "id": p["id"],
        "name": p.get("name"),
        "recurring_interval": p.get("recurring_interval"),
        "is_archived": p.get("is_archived"),
        "prices": prices,
        "benefits": [b.get("description") or b.get("type") for b in p.get("benefits", [])],
        "trial": p.get("trial_interval_count"),
    }, indent=2))

hooks = call("GET", f"/v1/webhooks/endpoints?organization_id={org_id}&limit=10")
print("\nWEBHOOK ENDPOINTS:")
print(json.dumps([{"id": h["id"], "url": h.get("url"), "events": h.get("events"), "format": h.get("format")} for h in hooks.get("items", [])], indent=2))

if mode == "provision":
    target = "https://heypenn.com/api/auth/polar/webhooks"
    existing = [h for h in hooks.get("items", []) if h.get("url") == target]
    if existing:
        print(f"\nwebhook already exists: {existing[0]['id']} (secret only shown at creation; rotate in dashboard if lost)")
    else:
        created = call("POST", "/v1/webhooks/endpoints", {
            "url": target,
            "format": "raw",
            "organization_id": org_id,
            "events": [
                "customer.state_changed",
                "subscription.created",
                "subscription.active",
                "subscription.updated",
                "subscription.canceled",
                "subscription.revoked",
                "order.paid",
            ],
        })
        print(f"\nCREATED_WEBHOOK_ID={created['id']}")
        print(f"POLAR_WEBHOOK_SECRET={created.get('secret', '')}")

    # Organization access token for the server (long-lived, org-scoped).
    oat = call("POST", "/v1/organization-access-tokens/", {
        "organization_id": org_id,
        "comment": "penn-ai railway api server",
        "scopes": [
            "products:read",
            "checkouts:read", "checkouts:write",
            "checkout_links:read",
            "customers:read", "customers:write",
            "customer_sessions:write",
            "subscriptions:read",
            "orders:read",
            "customer_portal:read", "customer_portal:write",
        ],
    })
    print(f"OAT_ID={oat.get('id')}")
    print(f"POLAR_ACCESS_TOKEN={oat.get('token', '')}")

print(f"\nENV={env}")
print(f"ORG_ID={org_id}")
PY
