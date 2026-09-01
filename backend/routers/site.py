# ruff: noqa: F403, F405
"""Page vitrine publique de Casanéo (présentation commerciale).
Sert de site officiel pour la validation d'organisation (Google Play / Apple)
et de page d'atterrissage quand le domaine casaneo.pro pointe vers l'app."""
from core import *  # noqa: F401
from fastapi.responses import HTMLResponse

_SITE_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Casanéo — Le channel manager des conciergeries</title>
<meta name="description" content="Casanéo : l'application tout-en-un des conciergeries et gestionnaires de locations saisonnières. Réservations Booking & Airbnb, calendrier, tarifs, messagerie, relevés propriétaires.">
<style>
:root{--navy:#020830;--blue:#0E2364;--accent:#4468F0;--bg:#F6F8FC;--txt:#1A2340;--muted:#5A6684}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:var(--txt);background:var(--bg)}
.hero{background:linear-gradient(160deg,var(--navy) 0%,var(--blue) 70%,#1A3A9E 100%);color:#fff;padding:72px 24px 88px;text-align:center}
.logo{display:inline-flex;align-items:center;gap:12px;margin-bottom:28px}
.logo img{width:56px;height:56px;border-radius:14px}
.logo span{font-size:26px;font-weight:800;letter-spacing:.5px}
.hero h1{font-size:clamp(28px,5vw,44px);font-weight:800;max-width:760px;margin:0 auto 16px;line-height:1.2}
.hero p{font-size:18px;opacity:.85;max-width:640px;margin:0 auto 32px;line-height:1.6}
.badges{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.badge{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:8px 18px;font-size:14px;font-weight:600}
section{max-width:1020px;margin:0 auto;padding:56px 24px}
h2{font-size:28px;font-weight:800;text-align:center;margin-bottom:36px;color:var(--navy)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.card{background:#fff;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(2,8,48,.06)}
.card .ico{font-size:28px;margin-bottom:12px}
.card h3{font-size:17px;margin-bottom:8px;color:var(--navy)}
.card p{font-size:14.5px;color:var(--muted);line-height:1.55}
.pricing{background:#fff}
.tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}
.tier{border:1.5px solid #E3E8F4;border-radius:16px;padding:24px;text-align:center}
.tier.star{border-color:var(--accent);position:relative}
.tier.star::before{content:"Recommandé";position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-size:12px;font-weight:700;padding:3px 14px;border-radius:999px}
.tier h3{font-size:16px;color:var(--navy)}
.tier .price{font-size:34px;font-weight:800;color:var(--navy);margin:10px 0 2px}
.tier .price small{font-size:14px;font-weight:500;color:var(--muted)}
.tier p{font-size:13.5px;color:var(--muted);line-height:1.5;margin-top:10px}
.cta{background:var(--navy);color:#fff;text-align:center;padding:64px 24px}
.cta h2{color:#fff}
.cta a.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;padding:14px 34px;border-radius:12px;margin-top:8px}
.cta p{opacity:.75;margin-top:18px;font-size:14px}
footer{background:#050C24;color:#8E97B8;text-align:center;padding:28px 24px;font-size:13.5px}
footer a{color:#B9C3E4;text-decoration:none;margin:0 10px}
</style>
</head>
<body>
<div class="hero">
  <div class="logo"><img src="/api/assets/casaneo-logo.png" alt="Casanéo"><span>Casanéo</span></div>
  <h1>Le channel manager tout-en-un des conciergeries de location saisonnière</h1>
  <p>Réservations Booking.com &amp; Airbnb synchronisées, calendrier multi-logements, tarifs, messagerie voyageurs, relevés propriétaires et comptabilité — sur mobile comme sur ordinateur.</p>
  <div class="badges"><span class="badge">📱 App iOS &amp; Android</span><span class="badge">🔄 Synchro Channex</span><span class="badge">🇫🇷 100 % en français</span><span class="badge">✨ Assistant IA</span></div>
</div>

<section>
  <h2>Tout votre quotidien, au même endroit</h2>
  <div class="grid">
    <div class="card"><div class="ico">📅</div><h3>Réservations centralisées</h3><p>Booking.com, Airbnb et réservations directes synchronisées automatiquement. Fini les doubles réservations.</p></div>
    <div class="card"><div class="ico">💬</div><h3>Messagerie voyageurs</h3><p>Répondez aux messages Booking &amp; Airbnb dans l'app, avec traduction automatique et brouillons rédigés par IA.</p></div>
    <div class="card"><div class="ico">🧹</div><h3>Opérations terrain</h3><p>Arrivées, départs, ménages planifiés automatiquement, états des lieux photos et gestion d'équipe avec rôles.</p></div>
    <div class="card"><div class="ico">💶</div><h3>Finances &amp; propriétaires</h3><p>Relevés propriétaires en un clic, comptabilité, commissions plateformes, exports PDF/CSV.</p></div>
    <div class="card"><div class="ico">🌐</div><h3>Site de réservation direct</h3><p>Votre propre site de réservation en ligne avec paiement sécurisé Stripe, sans commission.</p></div>
    <div class="card"><div class="ico">⭐</div><h3>Avis clients</h3><p>Tous vos avis Booking &amp; Airbnb regroupés par logement, réponse publique en un clic avec suggestion IA.</p></div>
  </div>
</section>

<section class="pricing">
  <h2>Des tarifs simples, sans commission</h2>
  <div class="tiers">
    <div class="tier"><h3>Starter</h3><div class="price">39 €<small>/mois</small></div><p>Jusqu'à 3 logements<br>Toutes les fonctionnalités</p></div>
    <div class="tier star"><h3>Essentiel</h3><div class="price">79 €<small>/mois</small></div><p>Jusqu'à 10 logements<br>Équipe illimitée, relevés, IA</p></div>
    <div class="tier"><h3>Pro</h3><div class="price">149 €<small>/mois</small></div><p>Jusqu'à 25 logements<br>Encaissement auto, comptabilité</p></div>
    <div class="tier"><h3>Scale</h3><div class="price">249 €<small>/mois</small></div><p>Jusqu'à 50 logements<br>Support prioritaire, migration</p></div>
  </div>
  <p style="text-align:center;color:var(--muted);font-size:14px;margin-top:22px">14 jours d'essai gratuit, sans carte bancaire. Au-delà de 50 logements : sur devis.</p>
</section>

<div class="cta">
  <h2>Essayez Casanéo gratuitement</h2>
  <a class="btn" href="mailto:gestion@mhpimmo.fr?subject=Essai%20Casan%C3%A9o">Demander un accès</a>
  <p>Application disponible prochainement sur l'App Store et Google Play.</p>
</div>

<footer>
  © 2026 MHP Immo — Casanéo
  <div style="margin-top:10px">
    <a href="/api/privacy">Politique de confidentialité</a>
    <a href="mailto:gestion@mhpimmo.fr">Contact</a>
  </div>
</footer>
</body>
</html>"""


@api_router.get("/site")
async def public_showcase_site():
    """Page vitrine publique Casanéo."""
    return HTMLResponse(content=_SITE_HTML)
