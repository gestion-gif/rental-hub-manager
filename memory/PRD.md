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
