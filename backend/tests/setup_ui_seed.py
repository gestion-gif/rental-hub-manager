"""One-off seed helper for iteration_19 UI test.
Sets deposit_link on Cosy Cocoon and ensures a manual Direct future reservation exists.
Prints rid + pid + deposit_link on stdout."""
import os, sys, json, requests
from datetime import date, timedelta

BASE = "https://rental-hub-manager.preview.emergentagent.com"
tok = requests.post(f"{BASE}/api/auth/login",
                    json={"email":"qa.admin@casaneo.test","password":"CasaneoQA2026!"}, timeout=30).json()
TOK = tok.get("session_token") or tok.get("token")
H = {"Authorization": f"Bearer {TOK}", "Content-Type": "application/json"}

# 1) Get target property
props = requests.get(f"{BASE}/api/properties", headers=H).json()
# Cosy Cocoon
pid = "d4b761bc-7fde-47a8-810f-92ff83a48973"
p = requests.get(f"{BASE}/api/properties/{pid}", headers=H).json()
original_link = p.get("deposit_link") or ""

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
body["deposit_link"] = "https://pay.test.casaneo/qa-frontend-caution"

r = requests.put(f"{BASE}/api/properties/{pid}", headers=H, json=body)
print("PUT status", r.status_code, "deposit_link=", r.json().get("deposit_link"))

# 2) Create a manual Direct future reservation
ci = (date.today()+timedelta(days=10)).isoformat()
co = (date.today()+timedelta(days=12)).isoformat()
payload = {
    "property_id": pid,
    "guest_name":"TEST_Deposit UI QA","guest_first_name":"TEST","guest_last_name":"DepUI",
    "guest_email":"TEST_dep_ui@example.com","platform":"Direct",
    "check_in": ci, "check_out": co, "guests":2,
    "nights_total":200, "cleaning_fee":40, "tourist_tax":4, "total_price":244,
}
rc = requests.post(f"{BASE}/api/reservations", headers=H, json=payload)
res = rc.json()
rid = res.get("id")
print("RID=", rid, "platform=", res.get("platform"), "source=", res.get("source"))
print("ORIGINAL_LINK=", original_link)

# Verify deposits/pending
lst = requests.get(f"{BASE}/api/deposits/pending", headers=H).json()
mine = [x for x in lst if x.get("reservation_id")==rid]
print("Pending contains rid:", bool(mine), "total pending:", len(lst))
