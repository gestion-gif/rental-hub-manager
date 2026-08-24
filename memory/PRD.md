# StayPilot — Channel Manager pour la location saisonnière

## Problème initial
"Je souhaite créer mon channel manager pour la location saisonnière" — un outil mobile pour gérer réservations, logements, disponibilités et tarifs de locations saisonnières.

## Choix utilisateur
- Fonctionnalités: toutes (réservations, logements + calendrier, tarifs par saison)
- Sync plateformes: via API → approche réaliste retenue = liens iCal (Airbnb/Booking/Vrbo) + saisie manuelle
- Auth: connexion Google (Emergent-managed Google OAuth)
- Assistant IA: oui (Claude Sonnet 4.6) — suggestions de tarifs + rédaction de réponses voyageurs
- Visuel: simple, avec code couleur par étape de réservation

## Architecture
- Frontend: Expo Router (React Native), police Geist, Ionicons, expo-image, expo-linear-gradient, react-native-keyboard-controller
- Backend: FastAPI + MongoDB (motor), routes préfixées /api
- Auth: Emergent Google OAuth (Bearer session_token, 7j)
- IA: emergentintegrations + EMERGENT_LLM_KEY (Claude Sonnet 4.6)

## Personas
- Hôte / propriétaire de locations saisonnières gérant 1 à plusieurs logements.

## Modèle de données
- users, user_sessions (auth)
- properties: name, location, image_url, base_price, capacity, bedrooms, seasons[], ical_links[]
- reservations: property_id, guest_name, guest_email, platform, check_in, check_out, guests, total_price, status, notes
- Statuts (code couleur): demande (orange), confirmee (vert), arrivee (bleu), depart (gris), annulee (rouge)

## Implémenté (2026-06)
- Connexion Google + gestion de session (mobile + web)
- Dashboard: taux d'occupation, revenus du mois, nb logements, à venir, arrivées/départs du jour, bannière IA
- Réservations: liste + filtres par statut (chips), création/édition/suppression, changement de statut
- Logements: liste (cartes héro), création/édition/suppression, détail
- Tarifs par saison + liens iCal gérés par logement
- Assistant IA: onglet Messages (réponse voyageur + copier) et onglet Tarifs (recommandation prix + copier)
- Backend testé: 27/27 pytest verts

### Ajout Planning (2026-06)
- Nouvel onglet **Planning** (la liste Réservations est conservée)
- Bascule **Réglette** (timeline lignes=logements, colonnes=jours, barres colorées) / **Mois** (grille mensuelle)
- Mode **Tous les logements** (pastilles de statut par jour) ou **par logement** (jours occupés/libres colorés)
- Navigation mois précédent/suivant, tap sur une barre/journée → réservation
- **Couleurs des statuts personnalisables** : palette de 10 couleurs assignables à chacun des 5 statuts, stockées par utilisateur (GET/PUT /api/preferences), appliquées partout (badges, planning, formulaire)
- Backend testé: 33/33 pytest verts

## Backlog priorisé
- P1: Vraie synchronisation iCal (parsing des .ics → import automatique des réservations)
- P1: Sélecteur de dates natif (calendrier) au lieu de saisie texte
- P2: Vue calendrier mensuelle visuelle (grille) par logement
- P2: Statistiques/revenus par logement et par période
- P2: Multi-devise, taxes de séjour
- P2: Upload photo logement (Emergent Object Storage) au lieu d'URL

## Prochaines tâches
- Synchronisation iCal automatique
- Sélecteur de dates natif
- Vue calendrier grille mensuelle

## Ajout Channel Manager Lodgify + Boîte de réception (2026-08)
- Intégration Lodgify Public API v2 (header X-ApiKey), architecture provider-neutre (LodgifyAdapter) prête pour un futur passage à Channex.
- `channel_settings` (par utilisateur) : provider, api_key, properties_count, last_sync.
- Endpoints backend :
  - POST /api/channel/connect (valide + stocke la clé), GET /api/channel/status, POST /api/channel/disconnect
  - GET /api/channel/remote-properties, POST /api/channel/import-properties (idempotent par lodgify_id)
  - POST /api/channel/sync (bookings Lodgify -> reservations, dedup lodgify_id, statut mappé, ménage auto, conversations depuis thread_uid)
  - GET /api/inbox, GET /api/inbox/{thread_uid} (messages voyageurs live via Lodgify, HTML nettoyé)
- Property.lodgify_id ajouté ; update_property préserve le mapping si le champ est omis.
- Frontend : refonte channel-manager (connexion Lodgify, import logements, sync réservations), écrans Boîte de réception (liste + fil de discussion) avec réponse assistée par IA (copier).
- Testé : 87/87 tests backend verts (iteration_8), validé avec la vraie clé Lodgify (24 logements, 359 réservations importées).

## Ajout Navigation drawer + Paramètres + Envoi messages (2026-08)
- Navigation : passage de la barre d'onglets horizontale à un **menu latéral coulissant (drawer/hamburger)** avec en-tête utilisateur et accès Boîte de réception, Paramètres, Déconnexion. (fix version @react-navigation/drawer -> 7.3.9 pour compat native 7.2.5).
- Logements : cartes en **grille carrée 2 colonnes** (image aspectRatio 1) pour un rendu plus fluide.
- **Écran Paramètres** (`app/settings/`) : Intervenants (CRUD), Propriétaires (CRUD + relevé revenus/graphe par mois + logements liés), Clé API Lodgify (changement), Couleurs des statuts.
- Backend : collections `staff` et `owners` (+ owner_id sur Property, /owners/{id}/summary). Envoi de réponse voyageur via Lodgify v1 (POST /api/inbox/{thread}/reply) avec validation brouillon côté UI.
- Dashboard : section Interventions **repliable** (menu déroulant).
- Testé : 116/116 tests backend verts (iteration_9).

## Ajout Marqueurs & Messages automatiques (2026-08)
- Nouveau modèle `message_templates` (par utilisateur) : name, body, color, kind (payment|message), trigger_event, trigger_days, enabled, order + marker_key. Défauts auto-seed : Payée (vert, auto via paiement), Livret d'accueil (bleu, 3j avant, désactivé), Instructions clés (violet, 1j avant, désactivé).
- Réservations : champs `markers` (liste) + `marker_color` (couleur du marqueur d'ordre le plus élevé). Le calendrier (réglette + mois) affiche `marker_color` en priorité sur la couleur de statut.
- Marqueur « Payée » calculé automatiquement pendant la synchro Lodgify (amount_paid/amount_due).
- Planificateur en arrière-plan (toutes les 30 min) : envoie les messages des modèles ACTIVÉS aux voyageurs via Lodgify X jours avant l'arrivée, puis pose le marqueur (couleur). Désactivés par défaut pour éviter tout envoi involontaire. Endpoint manuel POST /api/automations/run.
- Écran Paramètres → Messages automatiques : CRUD des modèles, palette de couleurs, activation, délai avant arrivée, message avec variables {guest}/{property}.
- CRUD /api/message-templates. Testé : synchro applique 163 marqueurs Payée ; automations/run = 0 envoi (défauts désactivés).

## Ajout Statuts auto par date, Détails financiers, Caution/Photos, Palette (2026-08)
- **Palette couleurs** élargie à 24 teintes (PreferencesContext.COLOR_PALETTE) pour les statuts.
- **Statut auto par date** : backend calcule `display_status`/`display_color` sur GET /reservations et dashboard — aujourd'hui dans [arrivée, départ[ → « Arrivée » (bleu), jour de départ/passé → « Départ ». Avant l'arrivée : marqueur (payée) ou statut. Le calendrier (réglette + mois) et la liste utilisent display_color/display_status.
- **Détails financiers Lodgify** : stockés en synchro (finance: total/paid/due/stay/fees/taxes/addons/promotions + quote_status + policy ; guest_phone, language, confirmation_code, checkin/out_time). Affichés dans reservation-form (Payé/Dû/Total + devis + invité + politique).
- **Interventions** : nouveaux types `remise_cles` et `caution`. Caution avec montant, interrupteur « débitée », et **photos d'état des lieux** (upload).
- **Stockage d'images** (Emergent Object Storage) : POST /api/upload (multipart), GET /api/files/{path}?token= (auth + ownership via collection `uploads`). App name = staypilot. expo-image-picker côté app. Permissions photo ajoutées à app.json.
- Testé backend : upload 200, caution intervention OK, download avec token 200 / sans token 401, finance stockée, display_status calculé.

## Ajout Logo Airbnb réel, filtre départs, Commissions plateformes (2026-06)
- **Logo Airbnb** : image réelle (symbole bélo recadré, assets/images/airbnb.png) affichée dans PlatformLogo → liste Réservations + réglette du calendrier.
- **Liste Réservations** : masque les réservations au display_status « depart » (séjours terminés).
- **Barres réglette** : chaque réservation va du milieu de la case d'arrivée au milieu de la case de départ (pas de chevauchement départ/arrivée le même jour).
- **Commissions plateformes** : Lodgify n'expose PAS la commission OTA dans son API (vérifié sur bookings v2 : subtotals = stay/fees/taxes/addons/vat/promotions uniquement). Solution retenue = taux configurables par plateforme, stockés dans preferences.commission_rates (défauts Airbnb 15,5 %, Booking 15 %, Vrbo 8 %, Direct/Site web 0 %). GET/PUT /api/preferences étendu (PUT partiel : ne réinitialise plus les statuts). Nouvel écran Paramètres → Commissions. Le détail réservation affiche « Commission plateforme » (auto-calculée sur le total, modifiable via PATCH /api/reservations/{id}/commission, conservée en synchro) + « Revenu net ».

## Ajout Stripe, Statistiques, Logements 5/ligne, divers (2026-06)
- **Stripe (Emergent managed, emergentintegrations.payments.stripe.checkout)** : STRIPE_API_KEY ajouté à backend/.env (placeholder routé via proxy). POST /api/reservations/{id}/checkout {kind:payment|deposit, amount?, origin_url} → session Checkout hébergée (compatible Expo Go + web). GET /api/checkout/status/{session_id} (idempotent, applique acompte ou caution). POST /api/webhook/stripe. Collection payment_transactions. Frontend : boutons « Payer par carte » (dû) + « Caution » dans reservation-form (expo-web-browser natif, redirection window web, polling status). NB : l'intégration managée ne gère PAS le hold/capture manuelle → la caution est un encaissement, remboursable manuellement dans Stripe.
- **Statistiques** : GET /api/analytics/revenue?year=YYYY (revenus + occupation par logement et par mois, revenu réparti au prorata des nuits). Écran /analytics (barres maison, sans dépendance chart) accessible via le drawer « Statistiques ». Sélecteur année, bascule Revenus/Occupation, filtre logement.
- **Finance réservations manuelles** : POST/PUT /api/reservations initialise/maintient finance (total/paid/due) → paiements, commission, Stripe fonctionnent aussi hors Lodgify.
- **Logements** : grille **5 par ligne** + tri **A→Z** (bouton). 
- **Intervenants** : champ **email** ajouté (StaffIn.email).
- **Propriétaires** : owner_summary renvoie désormais **per_property** (revenus + nuitées + par mois par logement) ; affiché dans la fiche propriétaire.
- **Livret d'accueil** : Property.welcome_book_url ajouté (formulaire logement + affichage/ouverture sur la fiche logement).
- **Récupération** : réimport Lodgify des logements supprimés par erreur (23 → 24).
- Backend testé : 148/148 pytest verts (iteration_11) + auto-tests curl (staff email, owner per_property, Stripe session).

## Ajout Propriétaire édition/documents, Livret auto, Refonte backend phase 1 (2026-06)
- **Propriétaire** : édition (modal) + **import de documents** (PDF/doc/xls/images) via expo-document-picker → upload Object Storage → POST/DELETE /api/owners/{id}/documents. Upload élargi aux types documents. Sélection du propriétaire dans le formulaire logement passée en **menu déroulant** (composant PropertyPicker réutilisé). Testé backend (edit + add doc).
- **Envoi auto du livret d'accueil** : nouvelle variable `{welcome_book}` (URL welcome_book_url du logement) substituée dans les messages automatiques ; modèle par défaut « Livret d'accueil » mis à jour. Activable dans Paramètres → Messages automatiques (désactivé par défaut).
- **Stripe** : paiement testé en RÉEL (carte 4242 sur checkout hébergé) → status paid, réservation paid=total/due=0, acompte « Paiement Stripe » enregistré.
- **Bug résolu** : « Loù Cabanoù » (réimporté) resynchronisé → 40 réservations recréées.
- **Refonte backend (phase 1)** : couche Lodgify extraite dans `backend/lodgify.py` (LodgifyAdapter, source_label, strip_html, map_lodgify_property, constantes). server.py l'importe. 148/148 pytest verts après extraction. Les routes restent dans server.py (découpage en routers à poursuivre en phase 2).

## Ajout Module Utilisateurs — rôles & autorisations (2026-06)
- **Nouvelle collection `members`** (par utilisateur) : first_name, last_name, email, phone, language, role, permissions[], active. CRUD complet : GET/POST /api/members, GET/PUT/DELETE /api/members/{id} (404 si absent), isolé par user_id.
- **Écran Paramètres → Utilisateurs** (`settings/members.tsx`) : liste avec rôle + nb d'autorisations, FAB d'ajout, badge Inactif.
- **Formulaire utilisateur** (`settings/member-form.tsx`) en 3 encarts : Coordonnées (Nom/Prénom/Mail/Téléphone), Informations complémentaires (Langue préférée — 12 langues), Rôle et autorisations (7 rôles : Administrateur, Gestionnaire de location, Propriétaire, Personnel de nettoyage, Personnel accueil, Intervenant, Membre + case Actif). Le choix du rôle applique des autorisations par défaut (ROLE_DEFAULTS).
- **Autorisations à cocher** : 15 « Autorisations générales » + 28 « Autorisations des PM Modules » (catalogue `src/permissions.ts` avec titre + description). Composant `Picker` générique réutilisable.
- Réponses auto voyageurs IA (Claude Sonnet 4.6) : choix utilisateur = brouillon à valider + notification (à implémenter dans une prochaine itération).
- Testé backend : 163/163 pytest verts (iteration_12, dont 15 nouveaux tests members : CRUD, tri, 404, isolation multi-utilisateur, auth guard).

## Ajout Accès logements + Invitation email + Auth mot de passe (2026-06)
- **Accès par logement** : `Member.property_ids[]`. Un membre ne voit QUE les logements cochés — filtrage réel appliqué côté backend sur /properties, /properties/{id}, /reservations, /interventions, /dashboard, /analytics/revenue, /inbox (via `_prop_scope`). L'owner (Google) voit tout.
- **Sessions membres** : `get_current_user` gère les sessions `kind:"member"` → renvoie user_id = owner (données), role="member", allowed_property_ids. Stockées dans user_sessions (30j).
- **Invitation email** (Emergent-managed / Resend, `backend/emailer.py`) : bouton « Envoyer l'invitation » sur la fiche → POST /api/members/{id}/invite {origin_url} génère un token à usage unique (sha256, 7j), envoie un email HTML (template serveur, gate anti-phishing) avec lien `{origin}/accept-invite?token=...`. EMERGENT_EMAIL_KEY + EMAIL_FROM_NAME=StayPilot dans backend/.env.
- **Auth mot de passe** (pwdlib/argon2) coexistant avec Google OAuth : POST /api/auth/accept-invite {token,password>=8} → pose password_hash, active le compte, renvoie session_token+user. POST /api/auth/login {email,password} → session membre. Erreurs génériques (401), invitations expirées → 400, pw court → 422.
- **Frontend** : formulaire utilisateur avec section « Accès aux logements » (MultiPicker cases à cocher) + carte « Accès de l'utilisateur » (bouton d'invitation, badges Invitation envoyée / Compte actif). Écran de connexion étendu (email + mot de passe en plus de Google). Nouvel écran `/accept-invite` (création du mot de passe). AuthContext : loginWithPassword + acceptInvite.
- Vérifié : email envoyé (delivered@resend.dev), accept-invite→login→membre ne voit que Villa A (owner voit Villa A+B). 163/163 pytest verts.

## Ajout Application des autorisations à l'écran + Filtre intervenant calendrier (2026-06)
- **Rôle Administrateur = accès complet** au compte parrain (correctif : un admin sans logement attribué voyait un compte vide).
- **Application des autorisations (frontend + backend)** :
  - `view_revenue_charts` : masque la carte « Revenus du mois » (dashboard), le lien « Statistiques » (drawer), et bloque GET /api/analytics/revenue (403) + dashboard.revenue_month=None côté backend pour les membres non autorisés (un intervenant ne voit AUCUN revenu).
  - `view_guest_name` : masque le nom du voyageur (→ « Voyageur ») dans la liste Réservations, le dashboard et le calendrier.
  - `view_booking_amount` + `hide_booking_prices` : masque le prix (liste Réservations) et toute la carte financière + le champ Prix total (fiche réservation).
  - Helpers : `src/permissions.ts` (userCan/canSeeRevenue/canSeeGuestName/canSeePrices/guestLabel) ; backend `_can(user, perm)`. `/auth/me` renvoie role+permissions (owner => tout autorisé). loginWithPassword/acceptInvite rechargent /auth/me.
- **Filtre par intervenant (calendrier/planning)** : sélecteur « Filtrer par intervenant » (propriétaire uniquement) listant les membres ayant des logements attribués ; sélectionner un intervenant restreint la réglette/mois à ses logements. Combinable avec le filtre logement.
- Vérifié : intervenant → analytics 403, dashboard revenue_month=None, ne voit que ses logements. 28/28 tests membres verts.

## Ajout Masquage de sections par rôle (2026-06)
- **Intervenant + Personnel de nettoyage** : ne voient plus le **taux d'occupation** ni les **séjours en cours** (dashboard), ni les **revenus**, ni la **boîte de réception** (icône dashboard + entrée drawer masquées), ni les **paramètres** (entrée drawer masquée).
- **Propriétaire (membre)** : pas d'accès à la **boîte de réception** ni aux **paramètres**.
- Helpers `src/permissions.ts` : memberRole, canSeeInbox/canSeeSettings/canSeeOccupancy/canSeeCurrentStays (le compte Google propriétaire = account_owner voit tout).
- Défense côté backend : `_can_inbox(user)` → 403 sur GET /inbox, /inbox/{thread}, POST /inbox/{thread}/reply et count=0 sur /inbox-unread-count pour les rôles cleaning/intervenant/owner (empêche l'accès direct hors UI).
- Vérifié : membre cleaning → /inbox 403, /analytics 403, /inbox-unread-count count 0 ; 28/28 tests membres verts, app compile.

## Ajout Vue « Ménage du jour » (2026-06)
- Nouvel endpoint `GET /api/cleaning-schedule?day=YYYY-MM-DD` (défaut aujourd'hui) : renvoie {date, departures[], cleanings[]} scopé aux logements du membre (_prop_scope). Départs = réservations check_out=jour (non annulées) avec property_name + checkout_time + guest. Ménages = interventions kind=menage du jour (property_name, intervenant, done).
- Écran `/cleaning` : page simple avec navigation jour précédent/suivant, section Départs et section Ménages à faire (tap → intervention-form, coche visuelle done). Nom voyageur respecte l'autorisation (guestLabel). Entrée drawer « Ménage du jour » visible par tous (utile aussi au propriétaire).
- 176/176 pytest verts, app compile.

## Ajout onglets Paramètres : Paiement + Import/Export iCal (2026-06)
- **Paramètres → Paiement** (`settings/payments.tsx`) : passerelles en ligne (Stripe activé, « Voir d'autres passerelles » = Adyen/Braintree/Mollie/Square/Authorize.net « Bientôt ») + méthodes alternatives (PayPal, Paiements manuels), avec toggles Activé/Désactivé, statut et puces descriptives. Persistance via `Preferences.payment_methods` {stripe,paypal,manual} (défaut stripe+manual actifs). PUT partiel préservant statuses/commissions.
- **Paramètres → Import / Export iCal** (`settings/ical.tsx`) :
  - **Export** : flux .ics public par logement `GET /api/ical/{property_id}/{token}.ics` (sans auth, token stocké dans property.ical_export_token, VEVENT par réservation non annulée, SUMMARY neutre « Réservé (StayPilot) » pour ne pas divulguer le nom). URL récupérée via `GET /api/properties/{id}/ical-export`. Bouton Copier (expo-clipboard).
  - **Import** : gestion des liens iCal par logement via `PUT /api/properties/{id}/ical-links` {links:[{platform,url}]} (réutilise l'infra sync existante), bouton « Synchroniser » → POST /properties/{id}/sync.
- Vérifié : payment_methods défaut/persistance OK ; flux .ics public renvoie un VCALENDAR valide, mauvais token → 404. 176/176 pytest verts, écrans rendus.

## Ajout Sync auto iCal + statut + réorg drawer (2026-06)
- **Drawer** : « Boîte de réception » remontée juste sous « Accueil » (rendue dans ITEMS.map après l'item index).
- **Synchro iCal automatique** : refactor du endpoint en `run_ical_sync(user_id, property_id)` (réutilisable) qui persiste le statut par lien sur `property.ical_links` (last_synced_at, last_imported, last_updated, last_count, last_error) + `property.ical_last_sync`. Boucle de fond `_ical_auto_sync_loop` lancée au startup : vérifie chaque heure, resynchronise tout logement dont la dernière synchro date de +23h (quotidien de fait). Délai initial 60s, espacement 2s entre logements.
- **Statut de sync (UI ical.tsx)** : chaque lien affiche « Synchro <date> · X importée(s), Y maj · Z évènement(s) » ou l'erreur en rouge ; badge « Synchro auto quotidienne · dernière : <date> ». Après sync manuelle, le statut se met à jour depuis la réponse.
- 176/176 pytest verts (dont 10 tests iCal), écrans rendus, drawer vérifié.

## Enrichissement Vue quotidienne + fréquence sync iCal (2026-06)
- **Fréquence de synchro iCal par logement** : `Property.ical_sync_frequency` (hourly/6h/daily, défaut daily). Endpoint `PUT /api/properties/{id}/ical-frequency` {frequency} (invalide→daily). Boucle auto utilise `_FREQ_SECONDS` {hourly:3300, 6h:21300, daily:82800} par logement. UI : Picker « Fréquence de synchronisation automatique » dans settings/ical.tsx.
- **« Ménage du jour » enrichi** : `GET /api/cleaning-schedule` renvoie désormais departures, **arrivals** (check_in=jour, avec deposit_collected/deposit_amount/damage_deposit → caution à vérifier à l'arrivée, mention « lien envoyé 2 j avant »), cleanings (menage), **interventions** (kind=intervention), **key_handovers** (remise_cles), **cautions** (kind=caution avec caution_amount/caution_debited). Toutes scopées par logement du membre. UI cleaning.tsx : sections dédiées (SectionHead + TaskCard réutilisables), badge caution vert/orange.
- Vérifié : endpoint renvoie les 6 listes, fréquence persistée (6h/daily), écran rendu avec données réelles. 176/176 pytest verts.

## Ajout Lecture seule (permissions écriture) + bouton caution + rubrique accueil (2026-06)
- **Règle d'écriture** : seuls le compte principal (Google) et les membres Administrateur peuvent modifier. Personnel de nettoyage/intervenant : uniquement marquer une tâche faite (PATCH /interventions/{id}/done), PAS la caution. Tous les autres membres : lecture seule.
- **Middleware backend autoritaire** `enforce_write_permissions` : bloque POST/PUT/PATCH/DELETE /api pour les sessions membres non-admin (403), sauf /interventions/{id}/done pour cleaning/intervenant. Vérifié (manager→403, cleaning done→200, cleaning caution→403, admin→200).
- **Endpoints** : PATCH /interventions/{id}/done (refuse kind=caution), PATCH /interventions/{id}/caution (encaisser/rendre).
- **Frontend** : helpers canModify/isFieldStaff ; canSeeSettings=canModify (Paramètres masqués pour non-admin). FABs create masqués (properties, réservations, interventions) et boutons Enregistrer/Supprimer masqués (reservation/property/intervention-form) si !canModify. Page « À faire aujourd'hui » (ex-Ménage du jour, renommée partout) : tâches ménage/intervention/remise cochables par tap (toggle done via /done) ; boutons caution Encaisser/Rendre réservés admin/compte principal.
- **Accueil** : rubrique/raccourci « À faire aujourd'hui » (carte cliquable vers /cleaning).
- Vérifié : middleware OK, rubrique accueil rendue, 176/176 pytest verts.

## Ajout Assistant IA — brouillons à valider + notifications + refactor (2026-06)
- **Réponses voyageurs = brouillons à valider** (Claude Sonnet 4.6) : GET /api/inbox/{thread} génère automatiquement un brouillon dès que le dernier message vient du voyageur et le stocke sur la conversation (`ai_draft`, `ai_draft_msg_id`, `ai_draft_at`, `ai_draft_validated`). POST /api/inbox/{thread}/generate-draft régénère. La réponse (POST reply) pose `ai_draft_validated=true` et purge le brouillon. Écran fil de discussion : carte « Brouillon IA — à valider » + pré-remplissage de la zone de réponse + bouton « Régénérer le brouillon (IA) ».
- **Notifications** : boucle de fond `_ai_draft_loop` (30 min) pré-génère les brouillons pour les conversations non lues. GET /api/notifications (liste) + /api/notifications/count (badge), scopés par user_id + _prop_scope, gate `_can_inbox` (cleaning/intervenant/owner => 0). Bannière d'accueil « X réponses IA à valider » + badge « Brouillon IA prêt » dans la boîte de réception.
- **Suggestions de tarifs IA** : l'endpoint /api/ai/pricing-suggestion prend désormais en compte les saisons déjà configurées du logement (context enrichi).
- **Refactor backend (phase 2)** : fonctions pures + constantes extraites dans `backend/helpers.py` (crypto pwdlib, statuts/paiements/commissions defaults, compute_display, recompute_payment, marker_color_for, parse_ical/_build_ics). server.py 2765 → 2559 lignes. Testé : 176/176 pytest existants + 9/9 nouveaux tests notifications (iteration_14) verts.

## Correctif envoi brouillons + 3 améliorations Assistant IA (2026-06)
- **BUG résolu — envoi des réponses/brouillons** : l'endpoint Lodgify d'envoi utilisait un mauvais chemin (`/v1/reservation/{id}/messages` → 404 → erreur 502). Corrigé vers `/v1/reservation/booking/{id}/messages`. De plus, Lodgify renvoie parfois HTTP 200 avec `{"success": false, "error": {...}}` : désormais détecté et remonté proprement (400 + message d'erreur lisible au lieu d'un 502 opaque). Vérifié via probe (booking bidon → « The Booking doesn't exists »).
- **Appliquer un tarif IA → saison** : /api/ai/pricing-suggestion renvoie maintenant `{suggestion, season:{name,start_date,end_date,price}}` (JSON strict parsé, tolère les fences). Onglet Assistant → Tarifs : carte « Saison suggérée » + bouton « Appliquer comme saison tarifaire » (PUT /properties/{id}, ajoute la saison au logement).
- **Ton du brouillon** : sélecteur de ton (Chaleureux / Pro / Concis) dans le fil de discussion, transmis à POST /api/inbox/{thread}/generate-draft {tone}. `_make_guest_draft(..., tone)` adapte le prompt.
- **Réglages assistant** : préférence `ai_auto_draft` (défaut true) dans GET/PUT /api/preferences. Nouvel écran Paramètres → Assistant IA (toggle brouillons automatiques). Si désactivé : la pré-génération de fond ET l'auto-génération à l'ouverture d'une conversation sont sautées (génération manuelle toujours possible).
- Testé : 185/185 pytest verts ; pricing structuré + PUT saison + toggle ai_auto_draft validés par curl ; app compile.

## Traduction voyageur + brouillon multilingue + envoi 1-tap (2026-06)
- **Brouillon dans la langue du voyageur** : `_make_guest_draft` rédige désormais le brouillon dans la MÊME langue que le dernier message du voyageur (le ton choisi reste appliqué).
- **Traduction FR des messages voyageurs** : GET /api/inbox/{thread} traduit automatiquement en français les messages voyageurs rédigés dans une autre langue (`_translate_to_fr`, 1 appel Claude, sortie JSON). Chaque message voyageur non-français reçoit `text_fr` ; les messages déjà en français restent inchangés (pas de doublon). Brouillon + traduction sont lancés en parallèle (`asyncio.gather`). Affichage : encart « Traduction FR » sous la bulle du voyageur.
- **Envoi en 1 tap** : la carte « Brouillon IA — à valider » propose « Modifier » (remplit la zone de saisie) et « Valider et envoyer » (envoie directement via `sendText`). Vérifié : traduction EN/DE→FR OK, FR inchangé (test unitaire `_translate_to_fr`).

## Traduction à la demande + suggestions multi-saisons (2026-06)
- **Traduction à la demande** : bouton bascule (icône « language ») dans l'en-tête du fil de discussion — visible uniquement si des messages ont une traduction. Permet d'afficher/masquer les encarts « Traduction FR » pour alléger les longues conversations (état `showTrans`, défaut affiché).
- **Suggestions multi-saisons** : /api/ai/pricing-suggestion renvoie désormais `seasons` (liste de 3 : basse/moyenne/haute, prix croissants) + `season` (=seasons[0], compat). Onglet Assistant → Tarifs : liste des 3 saisons suggérées + bouton unique « Appliquer ces 3 saisons » (PUT /properties/{id}, ajoute toutes les saisons d'un coup). Vérifié : 3 saisons cohérentes retournées (Basse 100€, Moyenne 145€, Haute 220€).

## Aperçu tarifs sur le calendrier + réponses types (2026-06)
- **Aperçu tarifs (vue planning/réglette)** : quand un seul logement est en scope (filtre logement), un bouton « Afficher les tarifs par saison » apparaît. Activé, chaque en-tête de jour affiche le prix/nuit applicable (`priceForDay` : saison correspondante sinon `base_price`). L'en-tête s'agrandit (headH) pour loger la ligne de prix. Visible uniquement en mode réglette + 1 logement.
- **Réponses types (quick replies)** : nouvelle collection `quick_replies` + CRUD `/api/quick-replies` (GET/POST/PUT/DELETE), défauts semés (Arrivée/Wifi/Parking). Écran Paramètres → « Réponses types » (liste + ajout/édition/suppression en bottom sheet). Dans le fil de discussion, rangée de puces (chips) au-dessus du sélecteur de ton : un tap insère le message dans la zone de réponse (ajout si déjà du texte). Vérifié : CRUD OK par curl (seed 3 défauts, POST/DELETE).

## Tarifs modifiables dans le calendrier + création de réservation par tap (2026-06)
- **Modifier les tarifs directement dans le calendrier** : en vue réglette avec 1 logement + tarifs affichés, chaque prix d'en-tête de jour est tappable → modale « Modifier le tarif » (nom de la saison couvrant ce jour ou « Prix de base hors saison » + plage de dates). Enregistrer met à jour le prix de la saison (ou base_price) via PUT /properties/{id}.
- **Créer une réservation par tap début → fin** : dans la réglette, un tap sur une case = date de début (marqueur « Début »), un 2e tap sur la même ligne = date de fin → ouvre le formulaire de réservation avec property/check_in/check_out. Le glisser-maintenir existant est conservé (Gesture.Exclusive(pan, tap)).
- **Formulaire de réservation enrichi** : champs Prénom, Nom, Téléphone, Email, Nombre de voyageurs + section Tarifs : « Prix des nuitées » (pré-rempli d'après les tarifs par saison du logement via computeNightsTotal, modifiable), « Frais de ménage », « Taxe de séjour », et Total calculé automatiquement (nuitées + ménage + taxe).
- **Backend** : ReservationIn ajoute guest_first_name, guest_last_name, guest_phone, nights_total, cleaning_fee, tourist_tax. create/update recalculent total_price = nuitées+ménage+taxe et alimentent finance.stay/fees/taxes ; guest_name dérivé de prénom+nom. Vérifié par curl (total 375 = 300+60+15, finance ventilée) ; 185/185 pytest verts.

## Renommage Casanéo + Relevé des propriétaires (2026-06)
- **Renommage StayPilot → Casanéo** : tout le texte (login, drawer, accept-invite, emailer.py, helpers.py ICS PRODID). Logo Casanéo ajouté (/assets/images/casaneo-logo.jpeg) affiché sur l'écran de connexion dans un cartouche sombre (fond noir du logo intégré proprement).
- **Nouvel onglet « Relevé propriétaires »** ((tabs)/statement.tsx, drawer gated canSeeRevenue) : sélecteur de mois + logement (tous/un). Par logement : détail des réservations du mois (arrivée dans le mois, hors annulées) avec ventilation nuitées/ménage/taxe, récap tarifs, dépenses & revenus.
- **Règles comptables (validées par l'utilisateur)** : frais de gestion = management_fee_pct × nuitées ; ménage → conciergerie ; taxe de séjour → à reverser à la commune (affichée) ; Revenu propriétaire = nuitées − frais de gestion − commissions plateforme − dépenses propriétaire ; Revenu conciergerie = frais de gestion + ménage − dépenses conciergerie.
- **Dépenses par logement/mois** : collection statement_expenses + CRUD /api/statement-expenses (label, montant, charge_to owner|concierge). Ajout/suppression depuis l'écran (owner/admin).
- **Backend** : PropertyIn.management_fee_pct ajouté ; GET /api/owner-statement?month=YYYY-MM&property_id= ; scoping _prop_scope. Champ « Frais de gestion (%) » ajouté au formulaire logement. Partage/copie du relevé (Share natif / presse-papier web).
- Vérifié par curl : Owner 275 = 500−100−45−80, Conciergerie 220 = 100+120 ; 185/185 pytest verts ; app compile.

## Sign in with Apple (2026-06)
- **Backend** : POST /api/auth/apple ({identity_token, name, email}) vérifie l'identity token Apple (RS256 via JWKS appleid.apple.com, issuer + audience contrôlés), upsert user par `apple_sub` (lié au compte email existant si même email), crée une session 7j compatible user_sessions, renvoie {session_token, user}. Env `APPLE_AUDIENCES` (bundle id + host.exp.Exponent). PyJWT + cryptography présents. Vérifié : token invalide → 401.
- **Frontend** : bouton natif `AppleAuthenticationButton` sur l'écran de connexion, affiché uniquement sur iOS (isAvailableAsync). `loginWithApple` ajouté à AuthContext (stocke le session_token en SecureStore, charge /auth/me). app.json `ios.usesAppleSignIn: true`. expo-apple-authentication installé.
- **Limite native** : Sign in with Apple ne fonctionne PAS sur le web, Android, ni le simulateur iOS — uniquement sur un vrai iPhone (Expo Go iOS ou build). Doc: /app/auth_testing.md. 185/185 pytest verts.

## Déconnexion/changement de compte + prix sur calendrier + % gestion dans le relevé (2026-06)
- **Déconnexion → page de connexion** : garde `if (!loading && !user) return <Redirect href="/login" />` dans (tabs)/_layout ; le bouton Déconnexion ferme le drawer puis signOut → redirection auto vers /login.
- **Avatar (tête) = changer de compte** : tap sur l'avatar de l'accueil ouvre un menu (Alert) « Changer de compte » / « Déconnexion » / « Annuler » → signOut → login.
- **Prix des nuitées sur le calendrier (vue mois)** : le bouton « Afficher les tarifs par saison » est désormais dispo en vue Réglette ET Mois (dès qu'un seul logement est sélectionné). Chaque case du mois affiche le prix/nuit (priceForDay), tappable pour modifier le tarif de la saison couvrante.
- **% frais de gestion modifiable dans le Relevé** : chaque carte logement du Relevé propriétaires a une pastille « gestion X% » (éditable, canModify) ouvrant une modale ; enregistre via PUT /properties/{id}.management_fee_pct et recharge le relevé.

## Tarifs visibles par défaut + Frais par défaut + Tarif spécial + Icône Casanéo (2026-06)
- **Tarifs des nuits visibles par défaut sur le Calendrier** : `showPrices` passe à `true` par défaut. Dès qu'UN logement est sélectionné, les prix/nuit s'affichent (réglette + mois) et sont modifiables au tap (modale existante). Quand « Tous les logements » est sélectionné, un encart d'aide invite à choisir un logement (pas de prix multi-logements possible dans l'en-tête partagé).
- **Correctif canSeePrices** : les membres Administrateur voient désormais toujours les prix (les défauts admin incluaient `hide_booking_prices` qui masquait à tort les prix). Aligné sur `canModify`.
- **Frais par défaut par logement** : `Property.default_cleaning_fee` + `default_tourist_tax` (backend PropertyIn + formulaire logement). Pré-remplis automatiquement dans le formulaire de réservation à la création (sélection du logement → remplit Frais de ménage / Taxe de séjour). Un défaut à 0 ne remplace pas une valeur déjà saisie.
- **Tarif spécial (promo) depuis le Calendrier** : en mode Réglette avec 1 logement + tarifs affichés, bouton « Tarif spécial (promo) » → sélection d'une plage (tap début → tap fin, ou glisser) → modale nom + prix → ajoute une « saison » placée EN TÊTE de `property.seasons` (prime sur les autres) via PUT /properties/{id}. Le prix affiché sur ces jours est écrasé (priceForDay renvoie la 1ʳᵉ saison correspondante).
- **Icône & splash Casanéo** : icône (maison Casanéo teal sur fond blanc, 1024²), adaptive-icon Android (fond blanc), favicon, et splash (logo complet, fond blanc) générés depuis casaneo-logo.png. app.json mis à jour.
- **Compte QA de test** : membre Administrateur email+password `qa.admin@casaneo.test` / `CasaneoQA2026!` (rattaché à l'owner gestion@mhpimmo.fr, tous logements) pour tests frontend sans Google OAuth. Voir /app/memory/test_credentials.md.
- Testé : backend 6/6 (iteration_15, default fees + promo season primacy) ; frontend flux calendrier/prix/tarif spécial/pré-remplissage validés (iterations 15 & 16).

## Onglet Intégrations — Turno + Livret d'accueil (2026-06)
- Nouvel onglet **« Intégrations »** (drawer, réservé compte principal + membres Admin via `admin:true` + `canModify`). Écran `(tabs)/integrations.tsx`, enregistré dans `(tabs)/_layout.tsx`.
- **Turno (ménages)** : connexion par **iCal** (aucune API ouverte — accès partenaire uniquement). Pour le logement sélectionné, affiche l'URL iCal d'export Casanéo (`GET /properties/{id}/ical-export` → `BASE + path`), bouton **Copier le lien iCal**, et bouton **Ouvrir Turno** (Linking → https://turno.com/fr-fr). L'utilisateur colle ce lien dans Turno pour planifier les ménages à chaque départ.
- **Livret d'accueil / Caution** : par **lien** (pas d'API publique). Bouton **Ouvrir livretaccueil.com**, champ de saisie du lien du livret enregistré dans `Property.welcome_book_url` (PUT /properties/{id}, payload complet), badge « Livret relié ». Ce lien est déjà injecté dans les messages automatiques via la variable `{welcome_book}`.
- Réutilise l'infra existante (export iCal + welcome_book_url), aucun nouveau backend requis. Vérifié via connexion QA admin : rendu OK, iCal chargé, enregistrement du livret persiste (badge affiché).

## Section « Clés » + envoi auto sur caution validée (2026-06)
- **Fiche logement → section « Clés »** : champ `Property.key_instructions` (code boîte à clés / instructions) + `Property.key_photos` (liste de chemins Object Storage). Upload photos via expo-image-picker + POST /api/upload (réutilisé). Affichage in-app via `fileUrl` (authed), suppression possible.
- **Bouton « Caution validée »** sur la réservation (reservation-form, édition, admin/owner) : `PATCH /api/reservations/{id}/caution-validated {validated, base_url}`. Champ `reservation.caution_validated` (hors ReservationIn → préservé par le PUT principal). À l'activation, si pas déjà envoyé (`keys_sent_at` absent) et logement a des infos clés : envoie automatiquement au voyageur (Lodgify) le code + instructions + **liens publics des photos** ; pose `keys_sent_at`. Réponse : `{keys_sent, reason}` (reason: no_key_info / no_messaging / no_channel / already_sent / send_error / sent). Réservations manuelles (hors Lodgify) : flag enregistré, pas d'envoi.
- **Liens publics des photos** : `GET /api/kp/{path}` (SANS auth) sert le fichier uniquement s'il est enregistré dans un `property.key_photos` (chemin uuid non devinable). Inclus dans le message sous forme `{base_url}/api/kp/{path}`.
- **Intégrations** : bouton « Gérer les cautions » → https://livretaccueil.com/account/caution (les cautions sont encaissées via Livret d'accueil, la validation dans Casanéo déclenche l'envoi des clés).
- Testé : backend 5/5 (iteration_17, persistance key_*, route publique /kp 200/404, PATCH caution manuel keys_sent=false + persistance) ; frontend (property-form Clés, toggle caution validée, bouton caution intégrations). Envoi réel Lodgify NON déclenché en test (réservation manuelle).

## Airbnb sans caution + Taxe de séjour en % (2026-06)
- **Airbnb = caution non requise** : la fiche réservation affiche pour platform=Airbnb une carte « Clés · Airbnb » (bouton POST /api/reservations/{id}/send-keys = envoi manuel immédiat) au lieu du toggle « Caution validée ». La boucle d'automatisation envoie AUTO les instructions de clés aux voyageurs Airbnb (Lodgify) 1 jour avant l'arrivée si le logement a un code/instructions (pose keys_sent_at). Les autres plateformes gardent le déclenchement par « Caution validée ».
- **Base URL publique** : channel_settings.public_base_url mémorisée quand le front passe base_url (caution-validated/send-keys), utilisée par la boucle de fond pour construire les liens publics des photos de clés.
- **Taxe de séjour en %** : `Property.tourist_tax_pct` (% du prix des nuitées) + `Property.regional_tax_pct` (taxe additionnelle régionale, % séparé). Remplace l'ancien champ fixe `default_tourist_tax` dans l'UI.
  - **Paramètres → Taxe de séjour** (`settings/tourist-tax.tsx`) : liste des logements, 2 champs % éditables + Enregistrer par logement (PUT /properties).
  - **Fiche logement** : section « Taxe de séjour » avec les 2 champs %.
  - **Réservation (création)** : `tourist_tax` pré-rempli = nights_total × (tourist_tax_pct + regional_tax_pct)/100, recalculé au changement logement/dates, modifiable ; texte d'aide « Calculée automatiquement (…) ».
- Testé : backend 5/5 (iteration_18, persistance taux, send-keys no_key_info/no_messaging, 404) ; frontend 10/10 (écran taxe, fiche logement, hint réservation, carte Airbnb vs caution). Aucun envoi réel Lodgify pendant les tests (réservations manuelles).

## Lien de paiement de la caution par logement (2026-06)
- `Property.deposit_link` : lien de paiement de la caution (montant prédéfini par logement, ex. livretaccueil.com). Champ dans la fiche logement (section « Caution »).
- Variable `{caution}` disponible dans les messages automatiques (substituée comme {welcome_book}). Indiquée dans Paramètres → Messages automatiques.
- POST /api/reservations/{id}/send-deposit-link : envoie le lien de caution au voyageur (Lodgify). Réponses: no_deposit_link / no_messaging / no_channel / sent. Bouton « Envoyer le lien de caution au voyageur » sur la carte caution (réservations non-Airbnb) dans reservation-form.
- Vérifié curl : no_deposit_link (lien absent), persistance deposit_link, no_messaging (réservation manuelle → aucun envoi réel).

## Synchro Lodgify automatique + diagnostic désync (2026-06)
- **Cause désync** : la synchro Lodgify des réservations était MANUELLE uniquement (POST /channel/sync). Aucune boucle automatique → les logements ne se mettaient à jour que sur action manuelle. Diagnostic Alyoné/Cosy Cocoon : mapping lodgify_id OK, tous les bookings Lodgify présents après resync (imported 1, updated 313, unmapped 20 = anciennes annonces archivées 740708/740709/768915/819221, sans impact).
- **Correctif** : extraction de la logique en `run_channel_sync(uid)` (l'endpoint POST /channel/sync délègue). Nouvelle boucle de fond `_lodgify_auto_sync_loop` (démarrage +90s, puis toutes les 30 min) qui resynchronise les réservations Lodgify de chaque utilisateur connecté. Enregistrée dans startup().
- Note : les fiches « demande » locales qui n'existent plus côté Lodgify ne sont pas supprimées automatiquement (pour ne pas effacer d'éventuelles réservations manuelles).
- Tests test_lodgify_channel: 3 échecs = base déjà peuplée (attendu imported>=1 sur base vierge) — non lié au refactor ; endpoint vérifié HTTP 200 (imported/updated/unmapped/conversations/total).

## Nettoyage demandes + Statut caution + Fréquence de synchro réglable (2026-06)
- **Nettoyage demandes** : `run_channel_sync` collecte `seen_ids` (tous les bookings Lodgify retournés) puis supprime les réservations `source=lodgify` `status=demande` dont le `lodgify_id` n'est plus retourné (enquêtes expirées/refusées). Garde-fou : nettoyage seulement si `bookings` non vide. Renvoie `removed`. Ne touche jamais aux réservations manuelles ni confirmées. (1er passage: removed=21.)
- **Statut caution (accueil)** : GET /api/deposits/pending = arrivées à venir (check_in>=today, hors Airbnb, status!=annulee) dont le logement a `deposit_link` et `deposit_link_sent_at` absent. Carte « Cautions à envoyer » sur le Dashboard (gated canModify) avec bouton Envoyer par ligne (POST send-deposit-link). send-deposit-link pose `deposit_link_sent_at` au succès → disparaît de la liste.
- **Fréquence de synchro réglable** : `channel_settings.sync_interval_min` (défaut 30, borné 5..1440). PATCH /api/channel/sync-interval ; GET /channel/status le renvoie. UI: chips 15min/30min/1h/2h/4h dans Paramètres → Clé API Lodgify. Boucle `_lodgify_auto_sync_loop` ticke toutes les 5 min et synchronise chaque utilisateur selon son intervalle (basé sur last_sync).
- Testé : backend 9/9 (iteration_19), frontend (carte accueil, chips intervalle, champ deposit_link, bouton réservation). Aucun envoi réel (réservations manuelles). test_deposits_sync_interval.py ajouté.

## Commission OTA modifiable dans le relevé propriétaire (2026-06)
- Ligne dédiée « Commissions OTA » toujours visible dans la ventilation du relevé, avec case/pill « modifier » (admins/owner) → modale de saisie du montant + « Revenir au calcul automatique ».
- Backend : override par logement/mois dans `statement_overrides` {user_id, property_id, month, commission}. GET /owner-statement renvoie totals.commission (effectif = override sinon somme auto), totals.commission_auto, totals.commission_override. PUT /api/statement-commission {property_id, month, commission} (commission=null réinitialise). Le revenu propriétaire = nuitées - frais de gestion - commission effective - dépenses.
- Vérifié curl (override 123.45 → owner_rev ajusté, reset → auto) + UI (ligne + modale). Note: le membre admin de test QA a reçu toutes les permissions (représentatif d'un vrai admin) pour accéder au relevé (view_revenue_charts / access_owner_statements).

## Relance caution J-2 + Historique caution + Détail taxe (2026-06)
- **Relance caution J-2** : dans `run_automations_for_user` (boucle auto), pour les réservations Lodgify NON-Airbnb, caution non validée (`caution_validated` faux), logement avec `deposit_link`, arrivée dans <=2 jours et `deposit_reminder_sent_at` absent → renvoie automatiquement le lien de caution (message « Rappel caution ») et pose `deposit_reminder_sent_at` (une seule relance). Airbnb exclu.
- **Historique caution** : la carte caution de la réservation (non-Airbnb) affiche « Lien envoyé le … » (`deposit_link_sent_at`) et « Relance envoyée le … » (`deposit_reminder_sent_at`). send-deposit-link met à jour la date localement.
- **Détail taxe (relevé)** : owner_statement renvoie `totals.tax_sejour` et `totals.tax_regional` (répartition proportionnelle aux taux du logement tourist_tax_pct/regional_tax_pct ; si taux 0 → tout en séjour). UI relevé: 2 lignes « Taxe de séjour (à reverser) » + « Taxe add. régionale (à reverser) » (affichée si >0). Partage texte mis à jour. Vérifié curl: 66.98 → 22.33 (5%) + 44.65 (10%).
- Données réelles: logements Beldi/Blue Haven ont déjà deposit_link + instructions clés réels (ne pas supprimer).

## Alerte caution J-1 + Relevé PDF + Email propriétaire + Délai relance réglable (2026-06)
- **Alerte caution** : /deposits/pending renvoie désormais TOUTES les arrivées à venir (hors Airbnb) non validées d'un logement avec deposit_link, + champs sent/reminder/days_until/urgent (urgent = J-1/J0). Carte accueil « Cautions à suivre » : bordure/icône ROUGE si une arrivée est urgente, badge « J-1 »/« Aujourd'hui » rouge par ligne, statut (Non envoyé/Lien envoyé/Relancé), bouton Envoyer/Renvoyer.
- **Relevé PDF** : bouton (icône doc) par relevé → expo-print printToFileAsync(HTML) + expo-sharing. NATIF uniquement (ne marche pas en preview web/Expo Go web ; OK sur build device).
- **Envoi propriétaire** : bouton (icône mail) → POST /api/owner-statement/email {month, property_id} → email HTML du relevé au propriétaire (owners.email via property.owner_id) via Resend. Réponses: sent / no_owner_email / no_data. Vérifié no_owner_email (aucun envoi si email absent).
- **Délai relance réglable** : channel_settings.deposit_reminder_days (défaut 2, 0..14). PATCH /api/channel/reminder-days ; GET /channel/status le renvoie. Chips J-1/J-2/J-3/J-5/J-7 dans Paramètres → Clé API Lodgify. La boucle de relance utilise cette valeur.
- Libs ajoutées : expo-print, expo-sharing. Vérifié curl (reminder-days, deposits/pending shape, email no_owner_email) + UI (carte accueil, relevé boutons, 2 lignes taxe).

## Popups premium + Alerte paiement (2026-06)
- **Style premium (Riviera #2A6F9E / CTA turquoise #17B0A6, coins arrondis)** appliqué à :
  - reservation-form : bandeau d'en-tête Riviera (badge logo OTA, nom voyageur, plateforme+date, bouton fermer blanc, coins arrondis + ombre).
  - planning : détail du jour (carte arrondie + bandeau titre Riviera) ; modales de tarif (edit-price + tarif spécial) : sheet arrondie 20 + ombre, titre Riviera, bouton Enregistrer turquoise.
- **Alerte paiement** : GET /api/payments/pending = réservations à venir (check_in>=today, status!=annulee, hors marker "paid") avec finance.due>0. Champs due/total/days_until/urgent (urgent = J-2/J-1/J0). Carte accueil « Paiements à suivre » (gated canModify) : bordure/icône rouge si urgent, badge J-x rouge, montant du Solde par ligne, tap → fiche réservation.
- Vérifié : endpoint (31 impayés) + UI (bandeau réservation, cartes accueil cautions+paiements).

## Relevé PDF/email : en-tête société + logo + envoi groupé (2026-06)
- **Ma société (Paramètres)** : nouvel écran `settings/company.tsx` + entrée dans le hub Paramètres. Coordonnées de la conciergerie (nom, adresse, CP, ville, téléphone, email, site web, SIRET, TVA) stockées dans `preferences.company` (GET/PUT /api/preferences étendu, clé `company`, helper `_build_company`).
- **En-tête relevé** : logo Casanéo + coordonnées société affichés en en-tête des relevés (PDF ET email). Backend `_company_header_html` + refactor `_statement_html` (en-tête + corps `_statement_body_html` + pied) ; frontend `companyHeaderHtml()` + `statementHtml` enrichi (titre « Relevé de gestion — <mois> »). Logo public servi par `GET /api/assets/casaneo-logo.png` (backend/assets/casaneo-logo.png, sans auth) ; URL logo construite depuis base_url passée par le front (EXPO_PUBLIC_BACKEND_URL) ou `channel_settings.public_base_url`.
- **Envoi groupé par propriétaire** : `POST /api/owner-statement/email-all {month, base_url}` regroupe tous les logements par `owner_id` et envoie UN SEUL email combiné par propriétaire (sections par logement + total multi-logements via `_combined_statement_html`). Réponse `{sent, results:[{owner_name, properties, sent, reason/to}]}`. Bouton « Tout envoyer » dans l'en-tête du Relevé (canModify) avec confirmation + récap des envois/omissions. Le bouton email par logement passe désormais `base_url` (logo dans l'email).
- Vérifié (emails MOCKÉS, aucun envoi réel aux vrais propriétaires) : 19 groupes propriétaires, 1 seul a un email (Geraldine → 1 email combiné pour 3 logements Alyoné/Urban Nest/Loù Cabanoù), les 18 autres correctement `no_owner_email`. Logo endpoint 200. `settings/company` + « Tout envoyer » rendus (screenshots). Tests : `backend/tests/test_company_statement_email.py` (3 passés).

## Logo société MHP + Aperçu relevé + Historique d'envoi (2026-06)
- **Logo société téléversable** : `company.logo_path` ajouté aux préférences. Upload via `settings/company.tsx` (expo-image-picker → POST /api/upload → aperçu). Servi publiquement par `GET /api/company-logo/{path}` (n'expose un fichier que s'il est enregistré comme `company.logo_path` d'un utilisateur). L'en-tête des relevés (PDF + email + aperçu) utilise ce logo s'il existe, sinon le logo Casanéo. Logo réel **MHP Conciergerie** téléversé pour l'owner `user_e235f66c67c3` (name auto « MHP Conciergerie »).
- **Aperçu du relevé** : bouton œil (icône) sur chaque carte → modale plein écran « Aperçu du relevé » (rendu natif : logo + coordonnées société, titre « Relevé de gestion — <mois> », ventilation complète, réservations, revenus). Bouton « Envoyer au propriétaire » (turquoise) dans l'aperçu (canModify).
- **Historique d'envoi** : collection `statement_sends` {user_id, property_id, month, sent_at, to} (upsert à chaque envoi email individuel ET groupé). `GET /owner-statement` renvoie `last_sent_at`/`last_sent_to` par logement. UI : puce verte « Envoyé le JJ/MM/AAAA à HH:mm » sur la carte + mention dans l'aperçu.
- Vérifié : aperçu rendu avec logo MHP (screenshot), endpoints logo 200, tests backend 3/3 verts.

## Channex — clé reçue (staging, compte vide) — décision migration en attente (2026-06)
- Clé API Channex fournie par l'utilisateur. Testée : **clé staging** (`staging.channex.io/api/v1` → 200, `channex.io/api/v1` → 404). Compte Channex **VIDE (0 logement)**.
- Playbook obtenu (integration_expert) : auth header `user-api-key`, endpoints /properties, /room_types, /rate_plans, /availability, /restrictions, /bookings, /booking_revisions/feed(+ack), /messages, /webhooks. Pas de signature HMAC (secret partagé via header). Mapping UUID property/room_type/rate_plan à persister ; garder les IDs Lodgify pendant la migration.
- ⚠️ Migration Lodgify→Channex = gros chantier ET compte Channex vide (rien à importer). NE PAS retirer Lodgify. Décision utilisateur attendue avant implémentation (voir question posée).

## Channex — Fondation (connexion lecture seule, coexiste avec Lodgify) (2026-06)
- Décision utilisateur : construire la **fondation Channex** (option a), stockage clé autorisé. Lodgify NON modifié.
- **Adapter** `backend/channex.py` : `ChannexAdapter` (auth header `user-api-key`, base staging/production, ret/backoff), `validate`, `list_properties`, `list_room_types`, `list_rate_plans` + mappers `map_channex_property/room/rate_plan` (persistance UUID channex_id/room_type_id/rate_plan_id).
- **Endpoints** (owner + membre admin uniquement, middleware write) : POST /api/channex/connect {api_key, environment} (valide via /properties, stocke dans `channex_settings`, ne renvoie jamais la clé), GET /api/channex/status, POST /api/channex/disconnect, GET /api/channex/properties (lecture live + `last_read_at`), GET /api/channex/properties/{id}/catalog (rooms+rate_plans), GET /api/channex/sync-logs.
- **SyncLog** : collection `sync_logs` {id, user_id, provider, type, status, message, date} — chaque opération Channex (connect/read/disconnect) journalisée (amorce du modèle SyncLog demandé).
- **Frontend** `settings/channex.tsx` (+ entrée hub Paramètres) : si non connecté → environnement (staging/production) + clé + « Tester & connecter » ; si connecté → carte statut (env, nb logements, date), « Lire les logements » (liste), « Déconnecter », encart d'aide si 0 logement, journal de synchro.
- **Réalité du compte** : clé staging, 0 logement. Vérifié : connect ok (0 props), status connecté, read 0, logs enregistrés, écran rendu (screenshot). Clé Channex stockée pour l'owner `user_e235f66c67c3` (channex_settings, env staging).
- **Reste à faire (phases suivantes, en attente compte production peuplé)** : import Channex→Property/Room/RatePlan, ARI (availability/restrictions), bookings via booking_revisions feed+ack, messages, webhooks (secret partagé), puis bascule/choix de provider.

## Relevé période (mois/trimestre/plage) + Rappel impayés + Modèle Rooms/RatePlans/Availability + Import Channex (2026-06)
- **Relevé sur période** : `GET /api/owner-statement` accepte `month=YYYY-MM` OU `start`/`end` (YYYY-MM-DD, end inclus). Helper `_resolve_period` → (start, end_excl, period_key, period_label). Réponse ajoute `period_key`+`period_label`. Les overrides/dépenses/envois sont désormais clés par `period_key` (rétro-compatible : month-mode → period_key=month). Emails (individuel + groupé) acceptent start/end et titrent avec period_label ; envoi enregistré par period_key. UI relevé : sélecteur **Mois / Trimestre / Plage** (nav trimestre « T3 2026 », plage = 2 steppers de mois), titres/partage/aperçu utilisent period_label.
- **Rappel impayés** : `GET /api/owner-statement/pending-send` (défaut = mois écoulé) → logements avec réservations mais sans envoi enregistré (+ has_owner_email, owner_revenue). Carte Dashboard rouge « Relevés à envoyer » (canModify) → tap vers l'onglet Relevé.
- **Modèle Rooms/RatePlans/Availability** (aligné Channex, coexiste Lodgify) : collections `rooms` {property_id, name, max_guests, count_of_rooms, channex_room_type_id?}, `rate_plans` {property_id, room_id?, name, base_price, min_stay, closed, channex_rate_plan_id?}, `availability` {room_id, date, is_available, min_stay, closed}. CRUD complet (GET/POST /properties/{id}/rooms|rate-plans, PUT/DELETE /rooms|rate-plans/{id}) ; availability set par plage (POST /rooms/{id}/availability {date_from,date_to,...}) + GET par plage. DELETE room → cascade rate_plans+availability. Écran `app/rooms.tsx` (« Chambres & tarifs » depuis la fiche logement) : CRUD chambres + plans tarifaires (bottom sheets).
- **Import Channex** : `POST /api/channex/import` → upsert Property (par channex_id) + rooms (channex_room_type_id) + rate_plans (channex_rate_plan_id), IDs Lodgify préservés, journalisé (sync_logs). Compte staging vide → 0 import (attendu).
- Vérifié : **23/23 tests backend** (iteration_20, aucune régression) ; UI relevé trimestre (screenshot), carte Dashboard « Relevés à envoyer » (visible), écran Chambres & tarifs (création OK). Emails NON déclenchés en test (sécurité vrais propriétaires).

## Disponibilités par chambre (calendrier) + Import Channex (UI) + Dépenses trimestre (2026-06)
- **Calendrier de disponibilités par chambre** : écran `app/room-availability.tsx` (accès via icône calendrier sur chaque chambre dans « Chambres & tarifs »). Grille mensuelle (lundi→dimanche), tap début + tap fin → ouvre/ferme la plage (bascule selon l'état du jour de début). Vert = ouvert, rouge = fermé/bloqué, min. nuits affiché. Utilise POST/GET /rooms/{id}/availability. Vérifié (plage 10–14 août bloquée, persistée).
- **Import Channex (UI)** : bouton « Importer dans Casanéo (logements, chambres, tarifs) » sur l'écran Channex (actif si ≥1 logement Channex) → POST /channex/import. Bouton « Changer de clé / passer en production » (reconfigure : réaffiche le formulaire clé+environnement même connecté) pour basculer staging→production. Note prod : base `https://channex.io/api/v1` (playbook), nécessite une clé PRODUCTION distincte.
- **Dépenses sur trimestre/plage** : l'ajout de dépense (et l'override commission) utilise désormais le `period_key` courant (mois, trimestre `T…`, ou plage `start_end`) au lieu du mois figé. En mode Trimestre/Plage, une dépense saisie couvre toute la période et s'affiche dans ce relevé. Sous-titres des modales = period_label.
- Vérifié : calendrier dispo (screenshot), bouton import + reconfigure rendus, dépense/commission clés par period_key (owner_statement lit déjà par period_key).

## Blocage auto disponibilités + Rappel auto relevés (email+push) (2026-06)
- **Blocage auto des dispos depuis réservation** : helper `_set_property_rooms_availability(uid, property_id, check_in, check_out, closed)` bloque/ libère TOUTES les chambres du logement sur [check_in, check_out) (jour de départ libre). Branché sur POST /reservations (bloque si status≠annulee), PUT /reservations/{id} (bloque/libère selon statut), PATCH /reservations/{id}/status (annulee→libère), DELETE /reservations/{id} (libère). No-op si le logement n'a pas de chambre. Marqueur `auto_booking`. Vérifié python : résa 10→13 bloque 10/11/12, suppression libère.
- **Push notifications (Emergent managed relay)** : backend `POST /api/register-push` + helper `send_push(recipients, data)` (relay `https://integrations.emergentagent.com`, header X-Push-Key, `EMERGENT_PUSH_KEY=placeholder` ajouté au .env — NE PAS éditer, remplacé au déploiement). Frontend : `app/_layout.tsx` (setNotificationHandler + channel 'default' au module scope, tap handlers warm+cold, nudge réglages si refus), `src/PushRegistrar.tsx` (getDevicePushTokenAsync + POST register-push au login et au retour en foreground, guard web). app.json : plugin `expo-notifications` + `android.googleServicesFile`. Placeholder `frontend/google-services.json` créé (À REMPLACER par le vrai fichier Firebase). Deps : expo-notifications, expo-device.
- **Rappel auto relevés** : background `_statement_reminder_loop` (démarré au startup) — fenêtre jour 1→7 du mois, une seule fois par mois (collection `reminders_sent`), pour chaque compte (db.users) : calcule les relevés du mois écoulé non envoyés (reservations_count>0 & pas de last_sent_at) → envoie PUSH (recipients=[user_id], action_url=/statement) + EMAIL au gestionnaire (u.email) listant les logements. Non-bloquant (try/except).
- Vérifié : register-push renvoie 500 avec clé placeholder (attendu, clé réelle au déploiement) ; app démarre OK après modifs _layout (screenshot dashboard). ⚠️ Push testable UNIQUEMENT sur build natif iOS/Android après déploiement + google-services.json réel.

## Disponibilités bloquées dans le Planning (2026-08)
- **Endpoint** `GET /api/availability/blocked?start=&end=` → dates bloquées MANUELLEMENT (closed=true & pas `auto_booking`) agrégées par logement (jointure rooms→property) : `{blocks: {property_id: [dates]}}`. Exclut les blocages auto issus des réservations (déjà affichés en barres).
- **Frontend Planning** (`(tabs)/planning.tsx`) : chargement des blocages pour le mois visible (effect sur `anchor`), passés à TimelineView + MonthView via `blockedSets`. Réglette : cellule grise + petite icône cadenas sur les jours bloqués (toutes lignes). Vue Mois (logement unique) : fond gris + badge cadenas sur les jours bloqués sans réservation. Styles `blockedCell/blockedIcon/blockedBadge`.
- Vérifié : endpoint renvoie les bonnes dates ; overlay rendu (marques cadenas visibles sur la ligne du logement en Réglette). Push google-services.json toujours en attente du fichier utilisateur.

## Tri alphabétique + Statut « Bloqué » + Blocage depuis Planning (2026-08)
- **Tri alphabétique** : dans le Planning (Calendrier), les logements (lignes Réglette + sélecteur) sont triés A→Z (localeCompare fr). `props` triés au fetch + `rows` triés.
- **Statut « Bloqué »** : ajouté aux statuts par défaut (`helpers.py`, key `bloque`, gris #6E6E73). Disponible dans le sélecteur de statut du formulaire réservation (vient de /preferences). Exclu des relevés propriétaires (`owner_statement` filtre `status ∉ {annulee, bloque}`). Bloque quand même les dispos des chambres (comme une résa). Champ **Notes** (multiline) sert d'annotation.
- **Formulaire réservation** : lit le param `status` (prefill), et pour un blocage le nom voyageur est **optionnel** (guest_name = « Bloqué » par défaut, `valid` relâché si status=bloque).
- **Blocage depuis Planning** : bouton bascule « Bloquer des dates » (Réglette, canModify). En mode blocage, sélectionner une plage (tap début → tap fin) ouvre le formulaire réservation prérempli property+dates+status=bloque pour saisir l'annotation. Style `blockToggleOn` (gris), hint dédié.
- Vérifié : statut bloque présent dans /preferences, création résa bloque avec notes OK + exclue du relevé (count 0), tri alphabétique + bouton « Bloquer des dates » à l'écran (screenshots), formulaire prérempli (Cosy Cocoon, dates, status=bloque).

## Correction URL production Channex + re-test clé (2026-08)
- L'utilisateur a re-fourni la MÊME clé en la présentant comme « production ». Tests multi-hôtes : `app.channex.io/api/v1` = **VRAIE URL prod** → **401** (clé invalide en prod) ; `channex.io/api/v1` → 404 (site vitrine) ; `staging.channex.io/api/v1` → 200 (0 logement). ⇒ La clé reste une clé **staging**, PAS production.
- **Fix** : `channex.py` `CHANNEX_BASES["production"]` corrigé de `https://channex.io/api/v1` (faux, playbook) → `https://app.channex.io/api/v1`. Connexion en mode production échoue proprement (« Clé API Channex invalide ») ; staging connecté (0), import = 0.
- **Bloqueur côté utilisateur** : il faut une VRAIE clé API de production (compte channex.io production) + logements créés dans Channex pour pouvoir importer. Rien à importer tant que ce n'est pas le cas.

## Onglet « Politique de réservation » (Booking policies) (2026-08)
- **Backend** : collection `booking_policies` + CRUD (GET/POST /api/booking-policies, PUT/DELETE /api/booking-policies/{id}), modèle `BookingPolicyIn` + `_clean_policy` (validation/normalisation). Champs : name (nom interne), payment_count (1/2/3) + payments[{percent}], cancellation (non_refundable/fully_refundable/partially_refundable), deposit_required, deposit_method (card_auth/manual), deposit_amount_type (percentage/flat), deposit_amount, quote_expiration_hours (1–720, défaut 48).
- **Frontend** : `settings/booking-policies.tsx` (liste + suppression + « Nouvelle politique ») et `settings/booking-policy-form.tsx` (formulaire complet conforme à la demande : Nom interne ; Planification 1/2/3 paiements avec % par paiement + dernier calculé en reste ; Annulation en menu radio + note ; Caution requise/non ; si requise → méthode (carte recommandé / manuel) + note + type de montant (% / forfaitaire) + valeur ; Expiration du devis en heures + note dynamique). Entrée ajoutée au hub Paramètres.
- Vérifié : CRUD backend (create/list/delete) OK ; formulaire rendu conforme (screenshot : 2 paiements 30%/70% auto, annulation radio, caution requise → méthode carte).

## Enregistrement en ligne (online check-in) + KPI conciergerie + push google-services réel (2026-06)
- **google-services.json RÉEL** posé (projet Firebase casaneo-887f0, package `com.casaneo.app`). `app.json` android.package aligné sur `com.casaneo.app` pour correspondre à Firebase. Push testable uniquement sur build natif après déploiement (EMERGENT_PUSH_KEY reste placeholder jusqu'au déploiement).
- **Paramètres → Enregistrement en ligne** (`settings/online-checkin.tsx` + `settings/checkin-form.tsx`) : config stockée dans `preferences.online_checkin` (GET/PUT /api/preferences étendu, helper `_build_checkin`, `DEFAULT_CHECKIN`, `CHECKIN_PREDEFINED_KEYS`). Écran principal : description + carte « Formulaire d'enregistrement » avec toggle Activé/Désactivé + accès au constructeur. Constructeur : toggles « Rendre obligatoire avant l'arrivée » + « Rappels automatiques » ; 7 questions prédéfinies en cases à cocher (guests_count = Obligatoire, verrouillée) ; jusqu'à 5 questions personnalisées (ajout/édition/suppression) ; bouton Enregistrer. Backend force guests_count=true, filtre les questions vides, plafonne à 5, attribue un id.
- **KPI conciergerie** : `GET /api/analytics/kpi?month=YYYY-MM` (ou start/end) — synthèse sur période : revenus conciergerie vs propriétaires, frais de gestion, commissions, nuits/réservations, taux d'occupation global + par logement, top logements par revenu/occupation. Réutilise `_res_amounts`/`_resolve_period` et les règles du relevé. Gate `view_revenue_charts`. (Écran frontend KPI non encore construit — endpoint prêt.)
- Vérifié curl (compte QA) : online_checkin GET/PUT (guests_count forcé, question vide filtrée, ids générés), KPI 2026-07 (24 logements, occ 52%, conciergerie 17116€). Écrans rendus (screenshots).

## Itération 22 — Check-list, KPI, Avis, Rapport mensuel, Promotions, Prix multi-logements, Photos, Tarification dynamique (2026-06)
- **Check-list d'arrivée par réservation** : `reservation.checklist{caution,keys,welcome_book,cleaning}` (hors ReservationIn → préservé par PUT). PATCH /api/reservations/{id}/checklist (fusion partielle). UI: carte dans reservation-form (4 items cochables, compteur X/4) + points d'état (ChecklistDots) dans le détail du jour du Planning.
- **Tableau de bord KPI** : GET /api/analytics/kpi?month= ou start/end → totals (concierge/owner revenue, frais gestion, ménages, commissions, réservations, nuits), occupancy_all, per_property, top_by_revenue/occupancy. Écran /kpi (Mois/Trimestre + nav, cartes + tops). Drawer « Tableau de bord » (canSeeRevenue).
- **Avis voyageurs** : collection `reviews` + CRUD (/api/reviews, /reviews/summary avg par logement + global). Écran /reviews (note moyenne, par logement, liste, FAB d'ajout). Drawer « Avis voyageurs ». Demande d'avis auto après départ dans run_automations_for_user (review_request_enabled/days, message Lodgify, `review_request_sent_at`). Fix borne rating 1..5 (0→1).
- **Rapport d'activité mensuel** : _monthly_report_html (récap global tous logements) + POST /api/reports/monthly-activity/send + boucle _monthly_report_loop (jour 1-3, 1x/mois, reminders_sent kind=report), togglable via preferences.monthly_report_enabled. Écran settings/reports (toggles rapport + demande d'avis + délai J+x, bouton « Envoyer maintenant »).
- **Onglet Promotions** (settings/promotions + promotion-form) : collection `promotions` + CRUD. Champs: photo (upload), nom, description, code promo (toggle require_code + code + Ajouter), modèle de calcul (Aucune/Fixe/Pourcentage, % borné 100, texte d'aide), période (toggle + DateField début/fin), sélection hébergements (cases à cocher). 
- **Enregistrement en ligne** (settings/online-checkin + checkin-form) : preferences.online_checkin (7 questions prédéfinies, guests_count obligatoire, jusqu'à 5 personnalisées, toggles obligatoire/rappels).
- **Prix/nuit en réglette MULTI-logements** : le bouton « Afficher les tarifs » est dispo aussi en « Tous les logements » ; chaque cellule non réservée de chaque ligne affiche priceForDay(logement, jour) en petit. L'édition (en-tête) reste réservée au mode logement unique.
- **Galerie photos logement** : Property.photos (max 30). property-form section « Photos du logement (n/30) » (upload multiple expo-image-picker, selectionLimit=restant). Préservé par PUT.
- **Encart Accueil « Relevés à envoyer » réductible** : bouton chevron (stmt-pending-toggle) replie/déplie la liste ; header cliquable vers /statement conservé.
- **Tarification dynamique (par logement, suggestions à valider)** : GET /api/properties/{id}/dynamic-pricing?start=&end= → suggestions/jour basées sur (1) prix des logements COMPARABLES du portefeuille (même ville, capacité ±2, repli = tout le portefeuille) pondérés (market_weight), (2) taux d'occupation prospectif 30j, (3) règles week-end / haute saison (saisons dont prix>base) / anticipation longue / dernière minute. Config `Property.dynamic_pricing` (préservée par PUT). UI Planning (single prop + réglette) : bouton « Tarifs dynamiques » → prix suggéré en GRIS souligné sous le prix de base (testID dyn-<date>) + bandeau (nb comparables + occupation) ; tap = applique (ajoute une saison 1 jour « Tarif dynamique » en tête). google-services.json RÉEL (Firebase casaneo-887f0, package com.casaneo.app).
- Vérifié : backend iter21 12/12 + iter22 7/7 pytest verts ; screenshots (formulaire promo, check-in, réglette multi-prix 180€, suggestions dynamiques 134/152€ occupation 93%). Emails/messages réels NON déclenchés en test.

## Itération 23 — Site public de réservation directe + paiement en ligne Stripe (2026-06)
- **Objectif** : site web public (hébergé avec l'app) où les clients réservent EN DIRECT les logements MHP (sans commission OTA), avec paiement par carte. Marque = logo/nom société. Domaine cible mhpimmo.fr (à brancher au déploiement).
- **Config** : `preferences.public_site {enabled, slug}` (slug auto depuis nom société, unicité inter-comptes). `Property.published` (défaut true) contrôle l'affichage. PATCH /api/properties/{id}/published (toggle léger). Écran Paramètres → **Site de réservation** (`settings/booking-site.tsx`) : activer, définir slug, copier/ouvrir le lien public (/book/{slug}), liste des logements avec toggle publier. Toggle « Afficher sur le site public » ajouté aussi dans property-form (préservé par PUT).
- **Endpoints publics (SANS auth)** : GET /api/public/site/{slug} (branding + logements publiés), GET /api/public/site/{slug}/property/{id} (détail + unavailable_dates 365j + politique), POST .../quote (calcul serveur : nuitées via _price_for_day + ménage + taxe séjour % + promo → total ; vérifie capacité + disponibilité, 409 si indispo), POST .../request (demande sans paiement → réservation status "demande"), POST .../checkout (crée réservation "demande" pending_payment + Stripe Checkout hébergé Emergent, metadata kind=public_booking), GET /api/public/booking/status/{session_id} (poll ; confirme au paiement). Réutilise `_resolve_public_site`, `_public_quote`, `_match_promo`, `_booked_dates`. `_apply_stripe_payment` étendu (kind public_booking → status "confirmee", paiement enregistré, calendrier bloqué). Webhook /api/webhook/stripe existant confirme aussi.
- **Sécurité (playbook Stripe)** : montant recalculé côté serveur (jamais le client), STRIPE_API_KEY=sk_test_emergent (emergentintegrations), success/cancel URLs vers /book/{slug}/success. Confirmation via status/webhook (pas la page de retour).
- **Frontend public (routes publiques, hors auth)** : `app/book/[slug]/index.tsx` (liste responsive 1-3 col, hero brandé), `app/book/[slug]/[id].tsx` (galerie photos, description, aménités, calendrier react-native-calendars sélection de plage avec dates indispo désactivées, stepper voyageurs, code promo, devis détaillé, coordonnées, boutons « Réserver et payer » [Stripe hosted, window.location sur web] + « Envoyer une demande »), `app/book/[slug]/success.tsx` (poll statut paiement). 
- Vérifié curl (compte MHP QA, slug mhpimmo) : site 24 logements, détail (50 dates indispo), devis 4 nuits 480€+65+24=569€, checkout → URL cs_test_ réelle + réservation. Screenshots liste + détail OK. Réservations/avis de test nettoyés. NB : le 403 curl vu était un artefact urllib ; DELETE/PUT fonctionnent (middleware enforce_write_permissions autorise admin/compte principal).

## Itération 24 — Acompte en ligne + email confirmation + check-in public auto + landing domaine (2026-06)
- **Acompte selon politique** : `preferences.public_site.deposit_policy_id` (sélecteur dans Paramètres → Site de réservation, section « Paiement à la réservation » : chips « Paiement intégral » + politiques). `_public_quote` renvoie deposit_amount / balance_due / deposit_label (acompte = 1er % de la politique si payment_count>1, sinon total). `public_checkout` débite l'acompte (pay_now) et non le total ; tx stocke is_deposit + balance_due + origin + slug. Fix PUT /preferences : effacement possible du deposit_policy_id (sentinelle `in ps` au lieu de `or`).
- **Email de confirmation client** : `_send_booking_confirmation(uid, r, tx)` appelé dans `_apply_stripe_payment` (kind public_booking) après paiement réussi. HTML brandé (logo/société via _company_header_html) : récap séjour, montant payé (acompte ou total), solde éventuel, + bloc « Enregistrement en ligne » avec lien si online_checkin activé. Envoi via send_email (Resend).
- **Check-in public auto** : endpoints publics GET/POST /api/public/site/{slug}/checkin/{reservation_id} (questions issues de online_checkin, guests_count requis ; soumission stockée dans reservation.checkin_submission + checkin_done). Page `app/book/[slug]/checkin/[rid].tsx` (formulaire questions + écran succès). Lien inclus dans l'email de confirmation.
- **Landing domaine** : GET /api/public/default-site → slug du 1er site actif ; page `app/book/index.tsx` redirige /book → /book/{slug} (pour brancher mhpimmo.fr/book au déploiement).
- Frontend fiche : devis affiche « Acompte X% — à payer maintenant » + « Solde à régler plus tard », bouton « Payer l'acompte …€ ». Fix warning web (nœud texte).
- Vérifié : backend 7/7 pytest (acompte 170,70€/398,30€, checkout débite l'acompte, default-site, check-in GET/POST 404 gérés) + frontend (/book redirige, page check-in soumet, réglages acompte persistent). Politique « Acompte 30% » liée par défaut. Réservations de test nettoyées.

## Itération 25 — Refactoring P0 de server.py (2026-06)
- **Objectif** : découper le monolithe `server.py` (5 603 lignes) sans changer le comportement, pour la maintenabilité.
- **Nouvelle architecture backend** :
  - `core.py` (~2100 l) : imports, config, connexion Mongo (`db`/`client`), `app`, `api_router`, TOUS les modèles Pydantic et TOUS les helpers (auth, permissions, stockage objet, email/push, Stripe, prix, devis, HTML relevés/rapports, `_apply_stripe_payment`, `run_automations_for_user`, `run_channel_sync`, `run_ical_sync`, etc.). Expose tout via `__all__` (inclut les noms préfixés `_`).
  - `routers/*.py` (23 modules, ~3000 l) : uniquement les handlers de routes, groupés par domaine (auth, properties, reservations, public_site, interventions, ical, dashboard, analytics, ai, preferences, channex, policies, push, sync, inbox, team, owners, statements, reviews, promotions, templates, automations, files). Chaque module fait `from core import *`.
  - `server.py` (~360 l) : point d'entrée. Importe core + tous les routers (enregistre les 147 routes sur `api_router`), définit les boucles automatiques + middleware `enforce_write_permissions` + startup/shutdown + CORS, puis `app.include_router(api_router)`.
- **Vérifié** : 147 routes API identiques à l'original (aucun doublon), backend redémarré et sert des 200 réels (auth/session, dashboard, preferences, public/site, booking-policies…), pytest 256 passés. Correctif inclus : boucle `_statement_reminder_loop` sans `await asyncio.sleep` en fin de `while True` (famine de l'event-loop) → sleep 6 h ajouté.
- **Notes** : la fonction `channex_import` était orpheline (jamais décorée en route) dans l'original — comportement conservé (non enregistrée), placée dans `core.py`. Sauvegarde de l'original dans `/app/memory/server_pre_refactor_backup.py`. Test `test_company_statement_email` mis à jour pour patcher `routers.statements.send_email`.

## Itération 26 — Zone d'aide (FAQ + guides + assistant IA + aide contextuelle) (2026-06)
- **Demande utilisateur** : créer une zone d'aide. Choix : (1d) mélange FAQ + guides pas-à-pas + assistant IA, (2c) écran dédié dans le menu + bouton « ? » contextuel sur chaque écran, (3a) contenu généré, (4b) libre-service (pas de contact support), (5a) français uniquement.
- **Backend** : `POST /api/ai/help-ask` (routers/ai.py) → répond en français à {question} + {screen} optionnel via make_chat (EMERGENT_LLM_KEY), avec une base de connaissances Casanéo intégrée. 401 sans token, 400 si question vide.
- **Frontend** :
  - `app/help.tsx` — Centre d'aide : carte « Assistant d'aide » (question → réponse IA), barre de recherche filtrant les thèmes, thèmes repliables (11 thèmes) avec guides numérotés + FAQ.
  - `src/data/help.ts` — contenu éditable : `HELP_TOPICS` (thèmes/FAQ/guides) + `SCREEN_HELP` (aide contextuelle par écran). Facile à corriger.
  - `src/components/HelpButton.tsx` — bouton « ? » réutilisable ouvrant un modal (conseils de l'écran + mini-assistant IA + lien « Ouvrir le centre d'aide »).
  - Bouton « ? » ajouté aux en-têtes : Accueil, Réservations, Calendrier, Logements, Relevé propriétaires, Assistant IA, Intégrations, Paramètres, Site de réservation. Entrée « Aide » (drawer-help) ajoutée au menu latéral. Route `help` enregistrée dans `_layout.tsx`.
- **Testé** : backend 9/9 (test_help_ai.py) dont non-régression guest-reply/pricing-suggestion après refactor ; frontend validé (écran /help, recherche, thèmes, bouton « ? » sur les 9 écrans, modal + réponse IA authentifiée, navigation menu → /help). Rien de mocké.

## Itération 27 — Channex import câblé (P1) (2026-06)
- La route `POST /api/channex/import` (fonction orpheline non décorée depuis le refactor) est désormais enregistrée dans `routers/channex.py` ; copie orpheline retirée de `core.py` (+ __all__).
- Vérifié E2E avec une vraie clé staging (compte contact@mhpimmo.fr) : connect (1 logement détecté) → import → 1 Property « titi et gros minet » (Blausasc) + 1 Room « Studio », 0 rate plan (aucun plan tarifaire côté Channex). Test réalisé sur un utilisateur temporaire puis nettoyé.
- La clé fournie est une clé **staging** valide ; sur production (app.channex.io) elle renvoie 401.
