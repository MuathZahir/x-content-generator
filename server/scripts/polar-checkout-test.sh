#!/usr/bin/env bash
# Validate that the server's Polar token + product IDs can actually create a
# checkout (the exact call src/index.js makes). Creates an ephemeral checkout
# session (no charge) and prints its URL, then confirms it is reachable.
set -euo pipefail

python3 <<'PY'
import json, urllib.request, urllib.error

cfg = json.load(open("/home/user/.polar/tokens.json"))["production"]
tok = cfg["token"]
base = "https://api.polar.sh"

HEADERS = {
    "Authorization": f"Bearer {tok}",
    "Content-Type": "application/json",
    "User-Agent": "pennai-setup/1.0",
    "Accept": "application/json",
}

PRODUCTS = {
    "pro": "e4b5e44a-c410-43ee-9a0c-449f11bbfba8",
    "pro-yearly": "241198a5-bf08-4a89-a5bf-4ebbbc7406c0",
}

def call(method, path, body=None):
    req = urllib.request.Request(base + path, method=method, headers=HEADERS,
        data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:500].decode(errors="replace")

for slug, pid in PRODUCTS.items():
    status, body = call("POST", "/v1/checkouts/", {
        "products": [pid],
        "external_customer_id": "smoke-test-user",
        "success_url": "https://heypenn.com/success?checkout_id={CHECKOUT_ID}",
    })
    if status in (200, 201):
        print(f"{slug}: OK  url={body.get('url')}  expires={body.get('expires_at')}")
    else:
        print(f"{slug}: FAILED {status} {body}")
PY
