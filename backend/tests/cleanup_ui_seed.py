"""Iteration 19 cleanup: delete seed reservation, restore deposit_link to '', restore sync_interval to 30."""
import requests
BASE = "https://rental-hub-manager.preview.emergentagent.com"
tok = requests.post(f"{BASE}/api/auth/login",
                    json={"email":"qa.admin@casaneo.test","password":"CasaneoQA2026!"}).json()
TOK = tok.get("session_token") or tok.get("token")
H = {"Authorization": f"Bearer {TOK}", "Content-Type":"application/json"}

RID = "50423fdf-e341-45b7-8eb8-f21ea11b8567"
PID = "d4b761bc-7fde-47a8-810f-92ff83a48973"

# Delete reservation
r = requests.delete(f"{BASE}/api/reservations/{RID}", headers=H)
print("Delete reservation:", r.status_code)

# Restore deposit_link to ''
p = requests.get(f"{BASE}/api/properties/{PID}", headers=H).json()
fields = ["name","address","address_complement","description","rooms","amenities","seasons","ical_links",
          "welcome_book_url","management_fee_pct","default_cleaning_fee","default_tourist_tax",
          "tourist_tax_pct","regional_tax_pct","key_instructions","key_photos","deposit_link",
          "lodgify_id","owner_id"]
body = {}
for f in fields:
    v = p.get(f)
    if v is None and f in ("lodgify_id","owner_id"): continue
    if v is None:
        v = "" if f in ("name","address","address_complement","description","welcome_book_url","key_instructions","deposit_link") else 0 if f in ("management_fee_pct","default_cleaning_fee","default_tourist_tax","tourist_tax_pct","regional_tax_pct") else []
    body[f] = v
body["deposit_link"] = ""
r = requests.put(f"{BASE}/api/properties/{PID}", headers=H, json=body)
print("Restore deposit_link:", r.status_code, "value=", r.json().get("deposit_link"))

# Restore sync_interval to 30
r = requests.patch(f"{BASE}/api/channel/sync-interval", headers=H, json={"minutes":30})
print("Restore sync_interval_min:", r.status_code, r.json())

# Verify /deposits/pending doesn't include our rid anymore
lst = requests.get(f"{BASE}/api/deposits/pending", headers=H).json()
mine = [x for x in lst if x.get("reservation_id")==RID]
print("Still in pending:", bool(mine))
