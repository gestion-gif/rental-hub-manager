"""Génération de la facture client (PDF) — fpdf2."""
import io
import os
from fpdf import FPDF

_FONT_DIR = "/usr/share/fonts/truetype/liberation"
_FONT_REG = os.path.join(_FONT_DIR, "LiberationSans-Regular.ttf")
_FONT_BOLD = os.path.join(_FONT_DIR, "LiberationSans-Bold.ttf")

DARK = (28, 28, 30)
GREY = (110, 110, 115)
LIGHT = (243, 243, 246)
LINE = (225, 225, 230)


def fr_date(iso: str) -> str:
    """'2026-06-10' -> '10/06/2026'."""
    try:
        y, m, d = str(iso or "")[:10].split("-")
        return f"{d}/{m}/{y}"
    except Exception:
        return str(iso or "")


def _eur(v: float) -> str:
    s = f"{float(v or 0):,.2f}".replace(",", "\u00a0").replace(".", ",")
    return f"{s} €"


def _company_lines(company: dict) -> list:
    lines = []
    if company.get("address"):
        lines.append(company["address"])
    cp_city = " ".join(x for x in (company.get("postal_code"), company.get("city")) if x)
    if cp_city:
        lines.append(cp_city)
    for key, label in (("phone", "Tél. : "), ("email", ""), ("website", "")):
        if company.get(key):
            lines.append(f"{label}{company[key]}")
    return lines


def build_invoice_pdf(*, number: str, issue_date: str, company: dict, vat_subjected: bool,
                      guest: dict, stay: dict, items: list, total_ttc: float,
                      logo_bytes: bytes | None = None) -> bytes:
    """Facture A4. items = [{label, ttc, vat_rate}] (montants TTC)."""
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    unicode_ok = os.path.exists(_FONT_REG) and os.path.exists(_FONT_BOLD)
    if unicode_ok:
        pdf.add_font("Main", "", _FONT_REG)
        pdf.add_font("Main", "B", _FONT_BOLD)
        fam = "Main"
    else:
        fam = "helvetica"

    def t(s):
        s = str(s or "")
        if unicode_ok:
            return s
        return s.replace("€", "EUR").encode("latin-1", "replace").decode("latin-1")

    def font(size, bold=False, color=DARK):
        pdf.set_font(fam, "B" if bold else "", size)
        pdf.set_text_color(*color)

    left, right = 15, 195
    width = right - left

    # ---------------- En-tête ----------------
    y = 14
    if logo_bytes:
        try:
            pdf.image(io.BytesIO(logo_bytes), x=left, y=y, h=14)
            y += 18
        except Exception:
            pass
    pdf.set_xy(left, y)
    font(13, bold=True)
    pdf.cell(105, 6, t(company.get("name") or ""), new_x="LMARGIN", new_y="NEXT")
    font(9, color=GREY)
    for line in _company_lines(company):
        pdf.set_x(left)
        pdf.cell(105, 4.6, t(line), new_x="LMARGIN", new_y="NEXT")
    if company.get("siret"):
        pdf.set_x(left)
        pdf.cell(105, 4.6, t(f"SIRET : {company['siret']}"), new_x="LMARGIN", new_y="NEXT")
    if vat_subjected and company.get("vat"):
        pdf.set_x(left)
        pdf.cell(105, 4.6, t(f"N° TVA : {company['vat']}"), new_x="LMARGIN", new_y="NEXT")
    header_bottom = pdf.get_y()

    # Bloc FACTURE (droite)
    pdf.set_xy(125, 14)
    font(19, bold=True)
    pdf.cell(70, 9, "FACTURE", align="R", new_x="LEFT", new_y="NEXT")
    font(10, color=GREY)
    pdf.set_x(125)
    pdf.cell(70, 5.4, t(f"N° {number}"), align="R", new_x="LEFT", new_y="NEXT")
    pdf.set_x(125)
    pdf.cell(70, 5.4, t(f"Date : {issue_date}"), align="R", new_x="LEFT", new_y="NEXT")

    # ---------------- Facturé à / Séjour ----------------
    y = max(header_bottom, pdf.get_y()) + 10
    pdf.set_xy(left, y)
    font(8.5, bold=True, color=GREY)
    pdf.cell(90, 5, t("FACTURÉ À"))
    pdf.set_xy(left + 95, y)
    pdf.cell(85, 5, t("SÉJOUR"))

    pdf.set_xy(left, y + 6)
    font(11, bold=True)
    pdf.cell(90, 5.6, t(guest.get("name") or ""))
    font(9, color=GREY)
    gy = y + 12
    for line in (guest.get("email"), guest.get("phone")):
        if line:
            pdf.set_xy(left, gy)
            pdf.cell(90, 4.8, t(line))
            gy += 4.8

    pdf.set_xy(left + 95, y + 6)
    font(11, bold=True)
    pdf.cell(85, 5.6, t(stay.get("property_name") or ""))
    font(9, color=GREY)
    sy = y + 12
    nights = int(stay.get("nights") or 0)
    guests = int(stay.get("guests") or 0)
    stay_lines = [
        f"Du {stay.get('check_in')} au {stay.get('check_out')}",
        f"{nights} nuit{'s' if nights > 1 else ''} · {guests} voyageur{'s' if guests > 1 else ''}",
    ]
    for line in stay_lines:
        pdf.set_xy(left + 95, sy)
        pdf.cell(85, 4.8, t(line))
        sy += 4.8

    # ---------------- Tableau ----------------
    table_y = max(gy, sy) + 10
    pdf.set_y(table_y)
    if vat_subjected:
        widths = [80, 26, 14, 26, 34]
        headers = ["Désignation", "Montant HT", "TVA %", "TVA", "Montant TTC"]
        aligns = ["L", "R", "R", "R", "R"]
    else:
        widths = [130, 50]
        headers = ["Désignation", "Montant"]
        aligns = ["L", "R"]

    pdf.set_fill_color(*LIGHT)
    font(9, bold=True, color=GREY)
    pdf.set_x(left)
    for h, w, a in zip(headers, widths, aligns):
        pdf.cell(w, 8, t(h), align=a, fill=True)
    pdf.ln(8)

    total_ht = 0.0
    total_vat = 0.0
    pdf.set_draw_color(*LINE)
    for it in items:
        ttc = round(float(it.get("ttc") or 0), 2)
        rate = float(it.get("vat_rate") or 0)
        ht = round(ttc / (1 + rate / 100.0), 2) if rate else ttc
        vat = round(ttc - ht, 2)
        total_ht += ht
        total_vat += vat
        font(9.5)
        pdf.set_x(left)
        if vat_subjected:
            cells = [it.get("label"), _eur(ht), f"{rate:g} %", _eur(vat), _eur(ttc)]
        else:
            cells = [it.get("label"), _eur(ttc)]
        for c, w, a in zip(cells, widths, aligns):
            pdf.cell(w, 8, t(c), align=a)
        pdf.ln(8)
        pdf.line(left, pdf.get_y(), right, pdf.get_y())

    # ---------------- Totaux ----------------
    pdf.ln(4)
    label_w, val_w = 46, 34
    x0 = right - label_w - val_w

    def total_row(label, value, bold=False, size=10):
        font(size, bold=bold, color=DARK if bold else GREY)
        pdf.set_x(x0)
        pdf.cell(label_w, 7, t(label), align="R")
        font(size, bold=bold)
        pdf.cell(val_w, 7, t(_eur(value)), align="R")
        pdf.ln(7)

    if vat_subjected:
        total_row("Total HT", round(total_ht, 2))
        total_row("Total TVA", round(total_vat, 2))
        total_row("Total TTC", round(total_ttc, 2), bold=True, size=12)
    else:
        total_row("Total", round(total_ttc, 2), bold=True, size=12)

    # ---------------- Mentions ----------------
    pdf.ln(6)
    font(8.5, color=GREY)
    if not vat_subjected:
        pdf.set_x(left)
        pdf.cell(width, 5, t("TVA non applicable, art. 293 B du CGI"), new_x="LMARGIN", new_y="NEXT")
    if any(float(it.get("vat_rate") or 0) == 0 and "taxe" in str(it.get("label", "")).lower() for it in items):
        pdf.set_x(left)
        pdf.cell(width, 5, t("La taxe de séjour n'est pas soumise à TVA."), new_x="LMARGIN", new_y="NEXT")

    # ---------------- Pied de page ----------------
    footer = " · ".join(x for x in (
        company.get("name"),
        f"SIRET {company['siret']}" if company.get("siret") else "",
        " ".join(p for p in (company.get("address"), company.get("postal_code"), company.get("city")) if p),
    ) if x)
    if footer:
        pdf.set_auto_page_break(auto=False)
        pdf.set_y(-18)
        font(7.5, color=GREY)
        pdf.cell(width, 4.5, t(footer), align="C")

    return bytes(pdf.output())
