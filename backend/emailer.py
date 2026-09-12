"""Emergent-managed transactional email (Resend proxy).

Server-side templates only — callers pass IDs/values, never raw HTML or recipients
from untrusted input. See the RESEND_EMAIL_PLAYBOOK guardrails.
"""
import os
import re
import ipaddress
import logging
import httpx
from pathlib import Path
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

logger = logging.getLogger(__name__)

# Emergent managed email proxy. Constant — never read from env (survives deploy).
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "Casanéo")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan(); scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str, reply_to: str | None = None,
                     attachments: list | None = None):
    """attachments: liste de {"filename": str, "content": str base64} (ex: facture PDF)."""
    _assert_safe_email(subject, html)
    email_key = os.environ.get("EMERGENT_EMAIL_KEY")
    if not email_key:
        logger.error("EMERGENT_EMAIL_KEY missing — cannot send email")
        raise RuntimeError("Email non configuré")
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if reply_to or EMAIL_REPLY_TO:
        payload["contact_email"] = reply_to or EMAIL_REPLY_TO
    if attachments:
        payload["attachments"] = attachments
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{EMAIL_BASE_URL}/api/v1/email/send",
            headers={"X-Email-Key": email_key},
            json=payload,
        )
    resp.raise_for_status()
    return resp.json().get("id")


def build_reset_email(*, code: str) -> tuple[str, str]:
    """Template serveur pour le code de réinitialisation de mot de passe."""
    subject = f"Votre code de réinitialisation {EMAIL_FROM_NAME}"
    html = (
        '<table role="presentation" width="100%" style="background:#f5f5f7;padding:24px 0">'
        '<tr><td align="center">'
        '<table role="presentation" width="480" style="background:#ffffff;border-radius:16px;'
        'font-family:Arial,Helvetica,sans-serif;overflow:hidden">'
        '<tr><td style="padding:28px 32px 8px">'
        f'<p style="font-size:20px;font-weight:bold;color:#1c1c1e;margin:0">{escape(EMAIL_FROM_NAME)}</p>'
        '</td></tr>'
        '<tr><td style="padding:8px 32px 24px">'
        '<p style="font-size:15px;color:#3a3a3c;line-height:1.5">Voici votre code pour définir '
        'un nouveau mot de passe dans l\'application :</p>'
        f'<p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1c1c1e;'
        f'text-align:center;margin:16px 0">{escape(code)}</p>'
        '<p style="font-size:13px;color:#8e8e93;line-height:1.5">Ce code expire dans 15 minutes. '
        'Si vous n\'êtes pas à l\'origine de cette demande, ignorez cet email — votre mot de passe reste inchangé.</p>'
        f'<p style="font-size:12px;color:#8e8e93;margin-top:16px">Envoyé par {escape(EMAIL_FROM_NAME)} — '
        'nous ne vous demanderons jamais ce code par téléphone ou par email.</p>'
        '</td></tr></table></td></tr></table>')
    return subject, html


def build_invite_email(*, member_name: str, invite_link: str) -> tuple[str, str]:
    """Server-side template for the team-member invitation. Returns (subject, html)."""
    subject = f"Invitation à rejoindre {EMAIL_FROM_NAME}"
    name = escape(member_name or "")
    link = invite_link.strip()
    html = (
        '<table role="presentation" width="100%" style="background:#f5f5f7;padding:24px 0">'
        '<tr><td align="center">'
        '<table role="presentation" width="480" style="background:#ffffff;border-radius:16px;'
        'font-family:Arial,Helvetica,sans-serif;overflow:hidden">'
        '<tr><td style="padding:28px 32px 8px">'
        f'<p style="font-size:20px;font-weight:bold;color:#1c1c1e;margin:0">{escape(EMAIL_FROM_NAME)}</p>'
        '</td></tr>'
        '<tr><td style="padding:8px 32px 0">'
        f'<p style="font-size:16px;color:#1c1c1e;margin:0 0 12px">Bonjour {name},</p>'
        f'<p style="font-size:15px;color:#3a3a3c;line-height:22px;margin:0 0 20px">'
        f'Vous avez été invité(e) à rejoindre l\'espace {escape(EMAIL_FROM_NAME)} de votre équipe. '
        'Cliquez sur le bouton ci-dessous pour créer votre mot de passe et accéder à votre compte.</p>'
        '</td></tr>'
        '<tr><td align="center" style="padding:8px 32px 24px">'
        f'<a href="{link}" style="display:inline-block;background:#1c1c1e;color:#ffffff;'
        'text-decoration:none;font-size:15px;font-weight:bold;padding:14px 28px;border-radius:10px">'
        'Créer mon compte</a>'
        '</td></tr>'
        '<tr><td style="padding:0 32px 28px">'
        '<p style="font-size:12px;color:#8e8e93;line-height:18px;margin:0">'
        'Ce lien est valable 7 jours. Si vous n\'êtes pas concerné(e), ignorez cet email. '
        f'Envoyé par {escape(EMAIL_FROM_NAME)} — nous ne demandons jamais votre mot de passe par email.</p>'
        '</td></tr>'
        '</table></td></tr></table>'
    )
    return subject, html
