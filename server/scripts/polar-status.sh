#!/usr/bin/env bash
# Report the Polar organization's payment-activation status.
set -euo pipefail
python3 <<'PY'
import json, urllib.request, urllib.error
cfg = json.load(open("/home/user/.polar/tokens.json"))["production"]
tok = cfg["token"]; base = "https://api.polar.sh"
H = {"Authorization": f"Bearer {tok}", "Accept": "application/json",
     "User-Agent": "pennai-setup/1.0"}
def get(path):
    req = urllib.request.Request(base + path, headers=H)
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e: return e.code, e.read()[:400].decode(errors="replace")

_, orgs = get("/v1/organizations/?limit=5")
org = orgs["items"][0]
print("org:", org.get("slug"), org["id"])
# Surface any field hinting at activation/review state.
for k in ("status", "details_submitted_at", "is_details_submitted", "onboarding", "account_id"):
    if k in org: print(f"  {k}: {org[k]}")

# The account object carries KYC/activation status.
acct_id = org.get("account_id")
if acct_id:
    _, acct = get(f"/v1/accounts/{acct_id}")
    print("account.status:", acct.get("status"))
    print("account.is_charges_enabled:", acct.get("is_charges_enabled"))
    print("account.is_payouts_enabled:", acct.get("is_payouts_enabled"))
else:
    print("NO payout account linked yet -> org is in test/sandbox-charge mode")
PY
