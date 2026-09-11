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

## Itération 28 — Rate Plan Channex + import des prix (2026-06)
- Créé pour l'utilisateur (compte staging) un Rate Plan « Tarif standard » (per_room, manual, EUR, occ 2) sur le logement « titi et gros minet » (Studio), prix 150 €/nuit sur 730 jours. NB : les tarifs Channex (POST /restrictions) s'envoient en CENTIMES (15000 = 150 €) ; à la lecture (GET /restrictions filter[restrictions][]=rate) ils reviennent en unités principales ("150.00").
- Enrichi l'import : `ChannexAdapter.list_rates()` (channex.py) récupère les tarifs ARI (fenêtre today→+60j) ; `channex_import` (routers/channex.py) définit désormais `base_price` du rate plan ET du logement (si vide) à partir du premier tarif positif. Testé E2E : logement + rate plan importés à 150 €. 23/23 tests Channex OK.

## Itération 29 — Channex Phase 1 : Synchro complète (certification test 1) (2026-06)
- `ChannexAdapter` (channex.py) : ajout `_post` (retry/backoff 429/5xx), `push_availability`, `push_restrictions`.
- Route `POST /api/channex/full-sync` (routers/channex.py) : pour chaque logement lié, 2 appels — 1× disponibilité (toutes chambres) + 1× tarifs/restrictions (tous rate plans), sur `days` (500 par défaut, max 730). Données réalistes : prix via saisons (`_price_for_day`, en centimes), dispo via `_booked_dates` (nb unités − réservé), regroupées en plages via `_date_ranges`. min stay envoyé en `min_stay_arrival` + `min_stay_through` (le `min_stay` simple n'est pas supporté par la property de test). Journalisé dans sync_logs + task_ids retournés.
- Découverte clé : tarifs Channex en CENTIMES (POST) ; lecture en unités principales. Availability = entier par room_type.
- UI : bouton « Synchronisation complète vers Channex (500 jours) » dans Paramètres → Channex (settings/channex.tsx).
- Testé E2E (compte temp + saison + réservation) : 2 task_ids, 3 plages dispo + 3 plages tarifs (variation OK). 23/23 tests Channex OK.
- RESTE À FAIRE pour certification : Phase 2 (push delta événementiel depuis les vrais écrans + file d'attente/rate limiter/retry), Phase 3 (webhook réception réservations Booking.com + accusé), Phase 4 (prépa tests + appel visio).

## Itération 30 — Channex Phase 2 : push delta événementiel (2026-06)
- Nouvelle file d'attente `channex_outbox` + worker `_channex_outbox_loop` (server.py, tick 8s) → `_drain_channex_outbox` (core.py) : 1 appel par entrée, espacé ~3s (limite 20/min), retry/backoff (via ChannexAdapter._post), 5 tentatives puis status 'error'. Journalisé (sync_logs type 'delta_push').
- Helpers core : `enqueue_channex_availability`, `enqueue_channex_rates`, `enqueue_channex_ari`, `_channex_linked_prop`, `_date_ranges` (déplacé en core ; routers/channex.py l'importe). Push seulement si Channex connecté + logement lié.
- Hooks branchés sur les VRAIS chemins (exigence certif — pas de script) :
  - Prix/saisons : `update_property` → enqueue rates (500 j). ✅ testé (250 € poussé).
  - Rate plan create/update → enqueue rates (min_stay). Bug corrigé : update_room/update_rate_plan écrasaient `channex_room_type_id`/`channex_rate_plan_id` quand omis → mapping perdu ; désormais préservés (comme lodgify_id).
  - Réservations create/update/status/delete → enqueue availability (dispo = count_of_rooms − réservé/bloqué). ✅ testé (avail 1).
  - Blocage manuel `set_availability` → enqueue availability (+ rates si min_stay).
- Le prix poussé = `_price_for_day(property)` (source de vérité prix de l'app). Rate en centimes, min_stay via min_stay_arrival + min_stay_through.
- Testé E2E (staging) : price change, min_stay, booking → outbox 'done' + valeurs correctes dans Channex. 71 tests OK.
- RESTE : Phase 3 (webhook réception réservations Booking.com + accusé) ; Phase 4 (prépa formulaire + appel visio certif).

## Itération 31 — Channex Phase 3 : réception des réservations (2026-06)
- Adapter (channex.py) : `booking_feed` (GET /booking_revisions/feed), `ack_revision` (POST /booking_revisions/{id}/ack), `list_webhooks`, `create_webhook` (is_global=true requis).
- core.py : `process_channex_bookings(uid)` — lit le feed, mappe property_id Channex→logement, crée/màj/annule la réservation (source 'channex', channex_booking_id), bloque/libère la dispo locale (PAS de re-push → pas de boucle), déclenche ménage, puis ACK. `CHANNEX_BOOKING_STATUS`, `_rev_guests`.
- routers/channex.py : `POST /channex/webhook` (public, 200 rapide → déclenche process pour l'user du property_id), `POST /channex/webhook/register` (crée webhook is_global + stocke webhook_id/url), `POST /channex/bookings/sync` (manuel). `channex_status` expose webhook_id.
- server.py : `_channex_bookings_loop` (poll feed toutes 90s, secours + ack — recommandé par Channex feed+webhook).
- UI (settings/channex.tsx) : boutons « Activer la réception des réservations (webhook) » + « Récupérer les réservations maintenant ».
- Testé staging : register webhook 200 (is_global), feed vide→0, webhook public→200, no-loop. 23 tests OK. NON testé : ingestion d'une vraie réservation (nécessite un canal + booking test Booking.com côté user).
- RESTE : Phase 4 (config canaux + création property test conforme au mapping certif + remplir formulaire Google + appel visio).

## Itération 31b — Phase 3 : validation réception (simulation)
- Logique `process_channex_bookings` validée par simulation (feed mocké) : réservation créée (source channex, guests/dates/montant OK), dispo bloquée, ACK appelé. ✅
- Création de réservation réelle via API bloquée par 403 : l'app « Booking CRS » doit être installée dans l'UI Channex par l'utilisateur. En attente de l'installation pour créer des bookings de test via /api/v1/bookings.

## Certification Channex — questionnaire complété et envoyé (2026-08)
- Propriété de test créée sur Channex Staging (USD) : « Propriété de test - Casanéo » (`26c71710-1083-4864-a7d1-1cb2007060ff`), 2 chambres (Twin `ce6c64ac…`, Double `b65d2e9d…`), 4 plans tarifaires (BAR + B&B par chambre).
- 10 scénarios ARI exécutés (Full Sync 500j, single/multi date rates, min stay, stop sell, multi restrictions, half-year, single/multi availability) → tous `Success` + task ids, valeurs vérifiées en relecture.
- Cas #11 Booking Receiving : cycle New→Modified→Cancelled via Booking CRS (Booking `44cecde4…`, revisions new `2d3c1358…`, modified `212f35d8…`, cancelled `16f26e17…`).
- Rate limits & update logic : conformes (Outbox 3s/appel ~20/min + back-off 429/5xx ; deltas uniquement ; full-sync manuel à la demande, jamais sur minuterie).
- ⚠️ BUG À CORRIGER avant prod : `routers/channex.py` full-sync envoie le tarif en centimes (`prix×100`) alors que `/restrictions` attend des unités décimales (« 100.00 ») → tarifs 100× trop élevés. La certif a été passée avec des pushs corrects manuels. Le delta-push (outbox) construit les valeurs via `_price_for_day` — À VÉRIFIER aussi le même souci de ×100.
- Format confirmé empiriquement : rate_plan CREATION `options.rate` = centimes (10000→100.00) ; ARI `/restrictions` `rate` = unités décimales string ("333.00").

## Session (2026-08) — Ménage auto configurable + Messagerie multi-canal + GetYourGuide + Net Airbnb
- Bug tarif Channex corrigé : /restrictions attend des unités décimales ("100.00"), pas des centimes. Fixé dans routers/channex.py (full-sync) et core.py enqueue_channex_rates (delta). Vérifié 150.00 vs 15000.
- Fiche réservation Airbnb : Payé = Dû = Revenu net = Total − commission − taxe de séjour (Airbnb encaisse le voyageur + reverse le net). Lignes "Taxe de séjour (perçue par Airbnb)" ajoutées.
- Réglage Ménage automatique (Paramètres → Ménage automatique) : décalage J..J+5 (cleaning_offset_days en preferences, 0..14). ensure_cleaning applique l'offset ; regenerate_auto_cleanings replanifie les ménages auto futurs non faits au changement d'offset.
- Onglet "Clé API Lodgify" retiré du menu Paramètres (route existe encore mais non listée).
- Intégrations : carte GetYourGuide (partner.getyourguide.com) + champ lien affilié stocké dans preferences.getyourguide_url, inséré via variable {activites} dans les modèles (run_automations_for_user + _render_message_vars).
- Messagerie multi-canal : ContactGuestModal (src/components) déclenché depuis fiche réservation (bouton "Contacter le voyageur", editing only) et inbox thread (icône). Backend routers/messaging.py : GET /api/messaging/context (canaux dispo + modèles rendus), POST /api/messaging/send (email via Resend, platform via Channex send_booking_message). WhatsApp = lien wa.me côté client (pas de backend). inbox/{thread} renvoie désormais reservation_id.
- Backend testé iteration_26 : 12/12 pass. Frontend smoke OK.

## Session (2026-06 fork) — Bandeau félicitations + son + logo + Module Comptabilité
### Accueil — bandeau dynamique
- `src/components/CelebrationBanner.tsx` : bandeau permanent en haut de l'accueil (sous les stats).
  - Mode "félicitations" (count>0) : dégradé vert animé (shimmer + icône trophée qui bouge), texte variable (Félicitations/Bravo/Bien joué/Youpi/Génial), résumé "N nouvelles réservations 🎉", son de caisse enregistreuse "cha-ching" (`assets/sounds/cash-register.mp3` via expo-audio, playsInSilentMode), fermable (croix) + cliquable (ouvre la résa si 1, sinon /planning).
  - Mode "Bonjour !" (count=0) : STATIQUE (aucune animation), dégradé bleu, icône soleil, titre "Bonjour !" + sous-titre "Par quoi commençons-nous aujourd'hui ?", ni fermable ni cliquable, pas de son.
- Détection : AsyncStorage `casaneo:lastSeenReservations:<user_id>` ; endpoint `GET /api/reservations/recent-confirmed?since=<iso>` (status != annulee/demande, created_at > since) -> {count, latest}. lastSeen avancé à chaque focus (affichage une fois).
- Logo barre latérale remplacé : `assets/images/casaneo-logo.png` (logo Casanéo couleur recadré) dans `(tabs)/_layout.tsx`.

### Module Comptabilité (nouveau)
- Backend `routers/accounting.py` (collections `transactions`, `acct_recurring`). Endpoints:
  - GET /api/accounting/meta (catégories recette/depense + taux TVA 0/5.5/10/20)
  - CRUD GET/POST/PUT/DELETE /api/accounting/transactions (calcul auto HT/TVA depuis TTC + taux)
  - CRUD /api/accounting/recurring (dépenses récurrentes mensuel/trimestriel/annuel, génération paresseuse `_materialize_recurring` à chaque GET, sans doublon, source=recurring)
  - POST /api/accounting/import-revenues {month|start,end} -> crée 1 recette par réservation confirmée (nuitées+ménage, hors taxe séjour), source=reservation, idempotent (skip si déjà importée)
  - POST /api/accounting/scan-receipt (multipart 'file') -> scan IA Claude Sonnet 4.6 vision (ImageContent base64) -> {supplier,date,amount_ttc,vat_amount,vat_rate,currency,category_guess}
  - GET /api/accounting/summary -> P&L (recettes/depenses/resultat ttc+ht), TVA {collectee,deductible,nette}, by_category, by_property, by_owner (vue agence + par propriétaire)
- Frontend : `app/accounting.tsx` (onglets Aperçu/Journal/Récurrent, sélecteur de mois, import revenus, cartes résultat/TVA, répartitions), `app/accounting-form.tsx` (écriture recette/dépense + photo justificatif + scan IA), `app/accounting-recurring-form.tsx`. Entrée menu latéral "Comptabilité" (Revenus, gate revenue). Écrans modaux enregistrés dans app/_layout.tsx.
- FAQ mise à jour (`src/data/help.ts`) : topic "comptabilite" + SCREEN_HELP.accounting ; article bandeau félicitations + son dans topic "reservations".
- Tests : iteration_27 backend 11/11 pass (dont scan IA réel : ticket Carrefour 16.05€ TVA 5.5% correctement lu). Aucune API mockée.

## Session (2026-08 fork) — Facture client PDF + toggle "Soumis à TVA"
### Paramètres société (`app/settings/company.tsx`)
- Toggle "Soumis à TVA (20 %)" (Switch, testID company-vat-toggle), stocké dans `preferences.vat_subjected` (bool, défaut false). PUT/GET /api/preferences (`PreferencesIn.vat_subjected` dans core.py).
- Impact comptabilité : `GET /api/accounting/summary` renvoie `vat_subjected` ; la carte TVA de l'aperçu (`app/accounting.tsx`) est masquée si false.
### Facture client (PDF + email)
- `backend/invoicing.py` (nouveau) : `build_invoice_pdf()` avec fpdf2 (2.8.8, ajouté à requirements.txt), police LiberationSans (unicode €/accents), logo société depuis Object Storage, blocs Facturé à / Séjour, tableau HT/TVA/TTC si assujetti sinon montant simple + mention "TVA non applicable, art. 293 B du CGI". Taxe de séjour toujours TVA 0 %. TVA 20 % sur nuitées + ménage (montants TTC).
- `backend/emailer.py` : `send_email(..., attachments=[{filename, content(base64)}])` — le proxy Emergent/Resend accepte les pièces jointes (vérifié, 202).
- Endpoints (routers/reservations.py) :
  - `GET /api/reservations/{id}/invoice` → {exists, number, sent_at, sent_to}
  - `POST /api/reservations/{id}/invoice/email` → génère + envoie le PDF au guest_email. Numérotation séquentielle annuelle atomique (`invoice_counters` {user_id, year, seq} → n° "2026-0001") ; le numéro est réutilisé en cas de renvoi. Collections : `invoices`, `invoice_counters`.
- Frontend (`app/reservation-form.tsx`) : bouton "Envoyer la facture au voyageur" (testID send-invoice-btn, visible en édition si rôle voit les prix), statut inline "Facture N envoyée le … à …".
- Tests : E2E curl (envoi réel à delivered@resend.dev, numéro 2026-0001, renvoi = même numéro, toggle TVA persisté, summary expose vat_subjected) + rendu PDF vérifié (2 modes TVA) + screenshots UI. Données de test nettoyées (compteur remis à zéro).

## Session (2026-08 fork) — Historique messages + Export comptable + Relances paiement + GYG par logement + fix taxe de séjour
### 1. Historique des messages (fiche réservation)
- `core.log_guest_message(uid, reservation_id, channel, kind, body, to, subject)` → collection `message_logs`. Canaux: email|whatsapp|platform. Kinds: manuel|auto|cles|caution|facture|relance|confirmation|avis.
- Points de log: messaging/send (email+platform), inbox reply, send-deposit-link, facture client, envoi clés (_send_key_instructions), automations Lodgify (modèles, clés auto, rappel caution, demande d'avis), confirmations publiques (_send_booking_confirmation, _send_request_ack), relances paiement, WhatsApp (POST /api/messaging/log-whatsapp appelé par ContactGuestModal après ouverture).
- `GET /api/reservations/{id}/messages` → historique. UI: section repliable "Historique des messages (N)" (testID msg-history-toggle) dans reservation-form.tsx, rafraîchie à la fermeture du modal Contact et après envoi de facture.
### 2. Export comptable (app/accounting.tsx, onglet Aperçu)
- Boutons "Exporter PDF" (expo-print: printToFileAsync+Sharing sur natif, printAsync sur web) et "Exporter CSV" (expo-file-system/legacy + Sharing sur natif, blob download sur web). CSV: séparateur ';', décimales à virgule, BOM UTF-8. PDF: compte de résultat + TVA (si assujetti) + dépenses par catégorie + journal. expo-file-system ajouté au package.json.
### 3. Relances de paiement automatiques
- `preferences.payment_reminders`: {enabled, mode: all|direct, excluded_platforms: [], days: [7,3]}. Builder `_build_payment_reminders` (core).
- `core.run_payment_reminders_for_user(uid)`: à J-7 et J-3 avant check_in, si solde dû (recompute_payment) > 0, email au voyageur (bouton "Régler mon solde" si site public actif → /book/{slug}/pay/{rid}). Dédup via collection `payment_reminders_sent` {reservation_id, days_before}. Boucle `_payment_reminder_loop` (server.py, toutes les 4h).
- UI: Paramètres > Paiement, carte "Rappels de solde" (switch + chips mode + plateformes exclues). Config utilisateur EN PLACE: enabled, mode all, Airbnb exclu.
### 4. GetYourGuide par logement
- `PropertyIn.getyourguide_url` (fallback sur le lien global des préférences). Utilisé dans {activites} (_render_message_vars + automations Lodgify). UI: champ "Activités (GetYourGuide)" (testID prop-gyg) dans property-form.tsx.
### 5. Fix taxe de séjour (demande utilisateur)
- reservation-form.tsx: `setNightsTotal` recalcule la taxe de séjour automatiquement à la saisie manuelle du prix des nuitées (tourist_tax_pct + regional_tax_pct du logement). Vérifié: 100 € à 6.1% → 6.1 €.
### Tests
- Backend: curl/python E2E (relance réelle envoyée par la boucle, dédup, exclusion Airbnb, historique, log WhatsApp, GYG). Frontend: testing agent 6/6 PASS (/app/test_reports/iteration_28.json). Données de test nettoyées.

## Session (2026-08 fork, suite) — Suppléments + Barème réel taxe de séjour + Sidebar repliable
### Suppléments (extras) — testé 7/7 PASS (iteration_29.json)
- Backend: `SupplementIn` (core), collection `supplements`, CRUD /api/supplements (routers/supplements.py). Champs: name, description, photo_path, calc_model fixed|percent, amount, percent_base nights|total, charge_basis unique|per_quantity|per_guest|per_room, period per_stay|per_night, vat_rate, price_includes_vat, property_ids ([]=tous), active.
- `compute_supplement_amount` + `compute_supplement_lines` (core). Réservation: POST/DELETE /api/reservations/{id}/supplements/{item} → maj total_price + finance + recompute_payment. Facture: lignes suppléments avec leur taux TVA (si société assujettie).
- Site public: GET /public/site/{slug}/supplements, /public/sup-photo/{path} (photo publique), PublicQuoteIn/BookingIn.supplements [{id,quantity}] → _public_quote calcule sup_lines/sup_total, réservation publique stocke supplements.
- Frontend: /settings/supplements (liste + FAB, entrée Paramètres > Réservations & tarifs), /supplement-form (photo, chips modèle/facturation/fréquence/TVA incl-excl, modal hébergements à cocher, actif, suppression), reservation-form (bouton add-supplement-btn + picker modal + 'Total avec suppléments'), book/[slug]/[id].tsx (cartes suppléments avec toggle + stepper quantité, lignes dans le devis).
### Barème réel taxe de séjour (demande utilisateur, validé sur l'exemple légal 5,76 €)
- PropertyIn: tax_mode percent|real, tax_cap (€ plafond/pers/nuit), tax_dept_pct (% de la taxe). tourist_tax_pct = taux, regional_tax_pct = taxe régionale (% de la taxe en mode réel).
- `real_tourist_tax(prop, night_prices, occupants, taxable)` (core): min(taux%×(prix nuit/occupants), plafond)×(1+dept%+rég%)×assujettis, sommé par nuit. Utilisé dans _public_quote (mode real).
- ReservationIn.taxable_guests (0 = tous). Frontend: /settings/tourist-tax (chips '% des nuitées'/'Barème réel' + plafond + taxe départementale par logement), reservation-form: computeTouristTax(mode réel), champ 'Personnes assujetties' (testID taxable-guests) visible si logement en mode réel, recalcul auto sur prix/voyageurs/assujettis/dates.
### Sidebar
- Sections 'Revenus' et 'Outils' repliables (repliées par défaut), testID drawer-section-Revenus / drawer-section-Outils. Vérifié par screenshot.
### Channex
- CERTIFICATION RÉUSSIE (tous les tests passés, email Channex reçu). Prochaine étape: vidéo de test live (créer résa 1 nuit → dispo dates concernées; déplacer d'une semaine → maj anciennes+nouvelles dates; full sync = 2 appels API) à envoyer à evan@channex.io avec l'ID de propriété staging. Ensuite: clé production, bascule frontend en 'production', import des vrais logements.

## Session (2026-08 fork #2) — Vérification export comptable
- Vérifié après fork: boutons "Exporter PDF" / "Exporter CSV" (onglet Aperçu de /accounting) fonctionnels — CSV téléchargé avec succès (journal-2026-08.csv), backend /accounting/summary + /transactions OK avec le compte QA.
- En attente utilisateur: envoi de la vidéo de démo à evan@channex.io pour débloquer la clé Production Channex (bloque: passage prod, encaissement Stripe auto OTA, migration Lodgify).

## Vue comptable annuelle (2026-08 fork #2)
- Backend: GET /api/accounting/annual?year=YYYY (routers/accounting.py) → months[12] {month, recettes, depenses, recettes_ht, depenses_ht, resultat, resultat_ht}, totals, + prev_year/prev_months/prev_totals (N-1 pour comparaison, requête unique sur 2 ans).
- Frontend (accounting.tsx): nouvel onglet "Annuel" (tab-annuel) entre Aperçu et Journal. Sélecteur de période bascule en année quand l'onglet est actif. Cartes Recettes/Dépenses/Résultat annuels (+ % vs N-1 si données), tableau 12 mois avec double barres (recettes vertes / dépenses rouges, échelle sur le max), résultat coloré + rappel N-1, meilleur mois marqué d'une étoile, ligne Total. Tap sur un mois (annual-month-YYYY-MM) → ouvre l'Aperçu sur ce mois. FAB masqué sur Annuel/Récurrent.
- Testé: curl backend OK (totaux 2026 corrects), screenshot navigation onglet + tap mois → Aperçu septembre 2026 OK.

## Fix critique sync dispo Channex (2026-08 fork #2)
- Bug: résa test ne bloquait pas la date dans Channex. Cause racine: rooms locales avaient count_of_rooms=5 (import périmé) alors que Channex=1 → push dispo = 5-1=4 → Channex plafonne à count_of_rooms(1) → date restait vendable (risque surbooking).
- Fix 1 (core.py enqueue_channex_availability): logement entier → date réservée/fermée = dispo **0** (au lieu de cap-1), sinon cap.
- Fix 2 (routers/channex.py full_sync): même logique 0/cap.
- Fix 3 (routers/channex.py import): rafraîchit count_of_rooms depuis Channex pour les rooms existantes (données non périmées).
- Data fix: rooms de la propriété test remises à count_of_rooms=1 (aligné Channex).
- Vérifié E2E: re-push dispo 2026-09-01..05 → API Channex confirme 0 le 2026-09-02 (nuit réservée), 1 ailleurs, pour les 2 room types.
- Note utilisateur: la 1re résa test avait été créée sur un logement NON lié à Channex (1b472b65) → aucune sync attendue. Utiliser « Propriété de test - Casanéo ».

## Fix libération ancienne plage lors de modification résa (2026-08 fork #2)
- Bug: décaler une résa poussait la dispo des nouvelles dates (0) mais l'ancienne restait à 0 dans Channex ET dans db.availability locale.
- Fix (routers/reservations.py update_reservation): capture old {check_in, check_out, property_id} avant update; si dates/logement changés → _set_property_rooms_availability(old, closed=False), re-fermeture des dates couvertes par d'autres résas actives, puis enqueue_channex_ari(old range).
- Réparation données: fermeture périmée du 2026-09-02 rouverte + re-push.
- Vérifié E2E via API (PUT réservation): 26/08→09/09 puis retour → Channex confirme à chaque fois ancienne date=1, nouvelle=0. État final: 26/08 = 0 (résa test utilisateur), tout le reste = 1.

## Fix bouton Full Sync inerte sur web (2026-08 fork #2)
- Cause: Alert.alert avec boutons = no-op sur react-native-web → la confirmation ne s'affichait jamais sur PC, le clic semblait mort.
- Fix (settings/channex.tsx): helpers notify() (window.alert sur web / Alert.alert natif) + confirmDialog() (window.confirm sur web / Alert 2 boutons natif). Tous les Alert.alert de l'écran remplacés.
- Vérifié: clic Full Sync sur web → confirm navigateur → "2 logement(s) synchronisé(s) sur 500 jours, 4 tâches", journal maj, nuit réservée 26/08 toujours à 0 après full sync.
- NOTE: d'autres écrans utilisent encore Alert.alert avec boutons (non bloquant mobile, mais silencieux sur web) — à généraliser si l'utilisateur travaille surtout sur PC.

## Fix affichage Payé/Dû résas Airbnb (2026-08 fork #2)
- Demande: pour Airbnb, le Dû (= net à recevoir d'Airbnb, hors commission et taxe de séjour) doit passer à 0 une fois l'encaissement validé.
- Avant: FinanceCard (reservation-form.tsx) affichait Payé=net ET Dû=net en permanence pour Airbnb, même après "Marquer l'encaissement comme reçu".
- Fix: paidShown = isPaid ? net : 0 ; dueShown = isPaid ? 0 : net (Airbnb). Non-Airbnb inchangé (f.paid / f.due).
- Vérifié E2E (résa "Voyageur Airbnb" 355.55 €, commission 16%, taxe 15.55): avant → Payé 0 / Dû 284.89 ; après toggle → Payé 284.89 / Dû 0.00. État remis à non payé après test.

## Encaissement automatique Booking.com via Channex → Stripe (2026-08 fork #2)
- Playbook integration_expert: app Channex "Stripe Tokenization" (POST /bookings/{id}/stripe_payment_method → token pm_) puis Stripe PaymentIntent confirm+off_session, idempotency_key=autocharge-{res_id}-{cents}. Nécessite accès production Channex + compte Stripe connecté à la propriété Channex (staging renverra une erreur claire).
- Backend: ChannexAdapter.stripe_payment_method (channex.py). core.py: _build_auto_charge (prefs {enabled, days_before 1..365, défaut 60}), auto_charge_reservation (charge le finance.due, enregistre paiement+marker paid, auto_charge:{status done/error, attempts}), run_auto_charge_for_user (candidats: source channex, platform ~booking, statut actif, check_in ≤ J+delay, due>0, pas done, <3 tentatives). PreferencesIn.auto_charge + GET/PUT preferences. POST /api/reservations/{id}/auto-charge (manuel, 402 avec message clair si échec, renvoie reservation maj). server.py: _auto_charge_loop toutes les 6 h.
- Frontend: settings/payments.tsx section "Encaissement automatique Booking.com" (switch auto-charge-switch, chips J-30/45/60/90 + champ libre auto-charge-days-custom 1..365). reservation-form.tsx: bouton "Encaisser la carte Booking.com" (auto-charge-btn, bleu Booking) visible si source channex + platform booking + dû>0, résultat via payMsg.
- Testé: GET/PUT prefs (défaut 60, clamp 365), endpoint manuel → 402 message clair (staging sans app tokenization), boucle → attempts++ et cap 3, UI vérifiée par screenshot. Prefs remises à {enabled:false, days_before:60} après test — l'utilisateur activera quand Channex production sera actif.

## Remarque Channex (Evan) : pas de pull ARI (2026-08 fork #2)
- Evan (Channex) a signalé des GET availability/rates. Causes: (1) curls manuels de debug de l'agent (ponctuels, terminés), (2) /channex/import relisait les tarifs (list_rates 60 j) à CHAQUE import même pour des logements déjà importés.
- Fix (routers/channex.py import): list_rates appelé uniquement au premier import d'un logement (aucun rate_plan local lié) pour seed du prix de base. Ensuite: push ARI uniquement, aucun pull.
- Le code ne lit JAMAIS /availability (les lectures vues par Channex étaient les vérifications manuelles de debug).

## Export des logements Casanéo → Channex (2026-08 fork #2)
- Adapter (channex.py): create_property / create_room_type / create_rate_plan / delete_property.
- POST /api/channex/export-properties {property_ids?: []} (défaut: tous les logements sans channex_id). Pour chaque logement: Property (title, EUR, FR, Europe/Paris, ville/adresse/CP, email+tél société, property_type "apartment" — "vacation_rental" invalide!), Room Type "Logement entier" (count_of_rooms=1, occ=capacity), Rate Plan "Tarif standard" (options rate en CENTIMES, sell_mode per_room, rate_mode manual). Puis liaison locale: properties.channex_id + insertion rooms/rate_plans (mêmes structures que l'import → sync ARI immédiate). _sync_log export_property par logement, 1 s entre logements (rate limit), maj properties_count.
- Frontend (settings/channex.tsx): bouton "Exporter mes logements vers Channex" (channex-export, orange) avec confirmDialog + rapport (créés/erreurs).
- Testé E2E sur staging: export "Loù Cabanoù" → vérifié via API Channex (room type 1 unité occ 4, rate plan 90.00 EUR) + liens locaux corrects. Puis NETTOYÉ (delete Channex + unset channex_id + suppression room/rate locaux) pour ne pas lier de vrais logements au staging avant la bascule production.
- Reste manuel côté user: mapping Booking.com/Airbnb dans l'UI Channex après export en production.

## Sélection des logements à exporter vers Channex (2026-08 fork #2)
- Demande user: exporter seulement 2 logements. Réponse: Channex facture par logement actif → export sélectif recommandé.
- settings/channex.tsx: le bouton channex-export ouvre désormais une modale bottom-sheet (export-modal) listant les logements NON liés (GET /properties filtré !channex_id) avec cases à cocher, "Tout sélectionner" (export-select-all), et bouton "Exporter N logement(s)" (export-confirm) → POST /channex/export-properties {property_ids}.
- Vérifié par screenshot: modale, sélection, libellé dynamique. Note env: la base ne contient que 3 logements (1 exportable) — les "24 propriétés" des notes précédentes n'existent pas dans ce fork.

## Reconnexion Lodgify + nettoyage logement test (2026-08 fork #2)
- Lodgify reconnecté (clé fournie par l'utilisateur, stockée dans channel_settings). Import: 24 logements Lodgify (23 créés + Loù Cabanoù reconnu par lodgify_id), 0 résa orpheline. ⚠️ Prix de base non fournis par l'API Lodgify: seuls 3 logements ont un base_price — l'utilisateur doit re-saisir ses tarifs avant l'export Channex.
- "titi et gros minet" SUPPRIMÉ (validé par user): Channex staging (delete_property c7bea5cd), Casanéo (DELETE /properties → property+résas), rooms/rate_plans/availability/interventions nettoyés. Reste 25 logements (24 Lodgify + Propriété de test - Casanéo).
- "Propriété de test - Casanéo" à SUPPRIMER lors de la bascule production Channex (accord user).

## Bascule production Channex + Import tarifs Lodgify + Alertes + Export annuel (2026-08 fork #2)
1. CHANNEX PRODUCTION: "Propriété de test - Casanéo" supprimée (staging Channex + local + rooms/rate_plans/availability). Clé PRODUCTION connectée (channex_settings.environment=production, 0 propriété pour l'instant), webhook enregistré (bf67ce6b...) → ⚠️ callback = URL PREVIEW ; à RE-ENREGISTRER après déploiement (bouton "Activer la réception" sur l'URL de prod). Reste: user re-vérifie ses prix puis exporte ses 2 premiers logements via le bouton, puis mapping Booking/Airbnb dans Channex.
2. IMPORT TARIFS LODGIFY: LodgifyAdapter.get_property + rates_calendar (lodgify.py). POST /api/channel/import-rates: prix par défaut (is_default) → base_price, jours à prix différent → saisons (plages consécutives même prix, max 120). Résultat: 24/24 logements maj (ex: Loù Cabanoù base 68€ + 18 saisons).
3. ALERTES ÉCHEC ENCAISSEMENT: _record_auto_charge_error (core.py) envoie un email au gestionnaire (db.users.email) à la tentative 1 et à l'abandon (3/3) avec résa, montant dû, motif, action à faire.
4. EXPORT ANNUEL PDF/CSV (accounting.tsx): boutons annual-export-pdf / annual-export-csv dans l'onglet Annuel. PDF: tableau 12 mois + N-1 + totaux + HT (expo-print). CSV: Mois;Recettes;Dépenses;Résultat TTC;HT;N-1 + ligne TOTAL (; décimales virgule, BOM). Testé: resultat-annuel-2026.csv téléchargé.

## Premier export PRODUCTION: Loù Cabanoù + Alyoné (2026-08 fork #2)
- Export vers Channex PRODUCTION réussi: Loù Cabanoù (44d3068a-945b-4bfb-bd66-84fed26c262b, occ 4) et Alyoné (ae95c14f-7834-40d8-a615-4c3019e80fce, occ 2), "Logement entier" count=1.
- Full sync production 500 j envoyé et VÉRIFIÉ via API Channex prod: dispos cohérentes avec les résas Lodgify (26-29/08 bloqués par résa Leon Taisne), tarifs saisonniers OK (120€ fin août).
- Reste à l'utilisateur: mapping Booking.com / Airbnb dans app.channex.io (Channels). Ensuite activer l'encaissement auto + app Stripe Tokenization sur les propriétés.

## Export COMPLET vers Channex production (2026-08 fork #2)
- Les 22 logements restants exportés (22/22 ok) → 24 logements au total dans Channex production, tous liés (channex_id + rooms + rate_plans locaux).
- Full sync production 500 j sur les 24 logements: OK, 0 erreur. Vérifié par échantillon: résa Melia Julien (Loù Cabanoù 03→12/09) → nuits 03-11/09 à 0, 12/09 libre côté API Channex prod.
- Reste à l'utilisateur: mappings Booking.com (1 channel par Hotel ID) et Airbnb (1 channel par compte Airbnb, plusieurs comptes possédés) dans app.channex.io.

## Vérification synchro production complète (2026-08 fork #2)
- 21 channels actifs sur Channex prod: 2 Airbnb (airbnb gg: 22 logements, Airbnb Thierry: 2) + 19 Booking.com (1/logement). ⚠️ "Booking cosy cocoon" is_active=FALSE (mapping à finaliser côté user).
- 1re VRAIE résa production reçue et intégrée: Julie Charpentier (Booking.com, Loù Cabanoù, 27→30/10, 226.54€) via webhook (4 events reçus, feed acquitté). Dates 27-29/10 bien bloquées côté Channex (vérifié API).
- En attente: connexion Stripe dans Channex User Profile par le user → ensuite installer app stripe_tokenization par API (POST /applications/install {property_id, application_code:"stripe_tokenization"}) sur les 24 logements (tenté: erreur "user has no stripe connection for billing account" tant que Stripe non connecté).
- Rappel post-déploiement: re-enregistrer le webhook Channex sur l'URL de production.

## Post-déploiement PRODUCTION (2026-08 fork #2)
- App déployée: https://rental-hub-manager.emergent.host (backend K8s, frontend Expo Go via QR). ⚠️ DB de production SÉPARÉE et VIDE (confirmé par support): données preview non copiées.
- 2 chemins pour peupler la prod: (A) email support@emergent.sh pour migration DB preview→prod (recommandé pour garder compta/préférences/historique), (B) reconfiguration via l'app prod: login Google → Lodgify connect+import propriétés+import tarifs → Channex connect (clé prod) + IMPORT (pas export!) + activer webhook.
- Fix anti-doublons (routers/channex.py import): si aucune property avec channex_id, matching par NOM insensible à la casse sur les logements non liés → liaison au lieu de création (rend le chemin B idempotent après import Lodgify).
- Deployment health check: PASS après fix du delete_many iCal (soft-cancel). Warnings restants non bloquants (URLs auth Emergent hardcodées = normales, store review metadata pour publication stores).
- RAPPEL WEBHOOK: en prod, re-cliquer "Activer la réception des réservations" pour enregistrer le webhook Channex sur l'URL de prod.

## Encaissement Booking opérationnel (2026-08 fork #2)
- App Stripe Tokenization: DÉJÀ installée sur les 23 logements Channex (Stripe connecté par le user dans Channex User Profile). Vérifié: POST /bookings/{id}/stripe_payment_method renvoie un PaymentMethod pour la résa Julie Charpentier.
- Fix (channex.py stripe_payment_method): le token arrive sous forme {'id': 'pm_...'} → extraction de l'id (sinon dict passé à Stripe = échec).
- Clé Stripe LIVE du user configurée dans backend/.env (compte "MHP IMMOBILIER", charges_enabled=True). ⚠️ En PRODUCTION le user doit l'ajouter lui-même: Deployment Panel → Secrets → STRIPE_API_KEY + redeploy.
- Rappel VCC Booking: cartes virtuelles activées à une date précise (souvent le check-in) → refus avant activation = normal, réessayer après.

## Encaissement Julie Charpentier tenté + clé live (2026-08 fork #2)
- Clé Stripe LIVE configurée en preview (.env). Encaissement tenté (accord user) sur résa Julie Charpentier 226.54€: flux complet OK (token pm_ récupéré, PaymentIntent live créé) mais REFUS carte decline_code="fraudulent" = VCC Booking non activée avant le check-in (27/10). À réencaisser à partir du 27/10.
- Amélioration (core.py run_auto_charge_for_user): après 3 échecs, une ultime tentative automatique à partir du jour d'arrivée (date d'activation des VCC Booking).
- Production: STRIPE_API_KEY à modifier par le USER dans Deployment panel → Secrets → Redeploy (les secrets existants ne sont PAS écrasés par le .env preview lors d'un redeploy — confirmé support). Si onglet Secrets absent/non éditable → support@emergent.sh avec Job ID.

## Bug encaissement Helen Flynn — diagnostic + fixes (2026-08 fork #2)
- Cause racine du refus (Helen 571.43€ ET Julie 226.54€): outcome=blocked, reason=rule, not_sent_to_network → RÈGLE RADAR du compte Stripe du user bloque le paiement (risk_level highest car débit off-session sans CVC). PAS un bug code. Helen: payment_collect=property (carte perso du client, pas VCC).
- 3 fixes code (core.py/channex.py): (1) token Channex renvoyé en dict {'id':'pm_'} → extraction, (2) idempotency_key inclut suffixe du token (chaque tentative = nouveau pm_, sinon erreur idempotence), (3) tentative avec MOTO + fallback auto sans MOTO si non activé sur le compte (MOTO actuellement NON activé chez le user).
- Actions USER côté Stripe: dashboard → paiement bloqué → voir la règle → Radar → Rules (désactiver/allowlist) ; et/ou demander à Stripe l'activation MOTO (le code l'utilisera automatiquement).
- testing_agent iteration 30: 8/8 pass (chaîne d'erreur 402 FR, attempts++, protections 'Déjà encaissé'/'Aucun montant dû', prefs auto_charge, régression résas+channex status). Test file: backend/tests/test_iter30_auto_charge.py.

## Endpoints pour la version PC (Casanéo Desktop) + Channex PCI (2026-08 fork #2)
- User a souscrit Channex PCI (accès cartes OK).
- POST /api/reservations/{id}/charge-card : alias de /auto-charge (débit 1 clic Channex tokenization + Stripe off-session MOTO/fallback). Testé: 402 propre si non-channex.
- GET /api/reservations/{id}/card-status?refresh=0|1 : {available, brand, last4, exp_month, exp_year, checked_at} — cache 24 h sur reservations.card_status ; réponses propres si non-channex/Channex déconnecté. Testé live: Helen Flynn → mastercard •••• 1719 exp 11/2027.
- ⚠️ Ces endpoints ne seront dispo en PRODUCTION qu'après redéploiement.

## Channex Messages & Reviews + billing_details Stripe (2026-08 fork #3)
- User a installé les apps Channex "Messages & Reviews" (+ Pricelabs, intégration Pricelabs pas encore traitée — voir backlog).
- Stripe: ajout billing_details (nom/email voyageur) attachés au PaymentMethod avant chaque débit (reco Stripe, réduit scoring Radar). MOTO toujours en attente d'activation côté Stripe (action user).
- MESSAGES: la boîte de réception (/api/inbox) est désormais Channex-native. sync_channex_threads (core.py) synchronise les fils GET /message_threads → db.conversations (provider='channex', unread basé sur last_message.sender==guest + seen_at, last_preview). Synchro: à l'ouverture de l'inbox (throttle 60s) + boucle serveur _channex_msg_review_loop (10 min). Lecture fil: GET /api/inbox/{thread_uid} → messages Channex normalisés (_normalize_cx_msgs, gère inquiries Airbnb + pièces jointes) + brouillon IA + traduction FR (inchangés). Réponse: POST /api/inbox/{id}/reply → POST /message_threads/{id}/messages Channex. Fallback Lodgify conservé pour les anciennes conversations (dispatch sur conv.provider).
- REVIEWS: sync_channex_reviews (core.py) → db.reviews (champs: channex_review_id, ota, score10 /10, rating=/5, comment, reply, is_replied). Avis Airbnb is_hidden/vides ignorés. ⚠️ Channex renvoie attributes.reply comme OBJET {reply:'...'} pour les avis répondus → coercition en str (bug corrigé + migration des 14 docs). Endpoints: POST /api/reviews/{id}/reply (publie via Channex, garde-fous: avis local→400, déjà répondu→400), POST /api/reviews/{id}/ai-reply (suggestion Claude). Update/delete bloqués pour avis OTA.
- Frontend: inbox.tsx (aperçu dernier message), reviews.tsx (badge OTA, score X/10, bloc "Votre réponse", modal Répondre avec Suggestion IA + Publier), [thread].tsx (mention plateforme dynamique).
- _generate_drafts_for_user gère maintenant les conversations Channex (brouillons IA pré-générés pour non-lus, boucle _ai_draft_loop élargie aux users channex).
- Testé (testing_agent iteration 31): backend 10/10 pass. Frontend inbox OK (81 convs, badges, traduction). Bug reply-objet corrigé + vérifié via screenshots (modal réponse + suggestion IA générée, PAS publié). Données réelles: 5 fils, 98 avis (moyenne 4.68).
- ⚠️ En PRODUCTION: dispo après redéploiement (Publish → Deploy).
- Backlog: intégration Pricelabs (s'assurer que Casanéo n'écrase pas les tarifs poussés par Pricelabs via Channex — poser la question du mode par logement), SaaS billing (P3).

## Clés API permanentes pour la version web PC (2026-08 fork #3)
- Besoin user: un "token d'application" pour que son projet web PC (autre projet Emergent) appelle l'API sans reconnexion tous les 7 jours.
- Backend (routers/api_keys.py): POST /api/api-keys {label} → génère csk_<64 hex> (affichée UNE fois, sha256 stocké), GET /api/api-keys (liste sans hash), DELETE /api/api-keys/{id} (révocation immédiate). Réservé au compte principal (owner Google) — membres et clés API elles-mêmes → 403 (anti-escalade). Limite 10 clés actives. Index unique key_hash (server.py startup).
- core.py get_current_user: si le Bearer commence par csk_ → lookup db.api_keys par hash (revoked_at:None) → contexte owner complet + last_used_at mis à jour (non bloquant).
- Frontend: settings/access-tokens.tsx (liste, création avec label, affichage unique avec bouton Copier via expo-clipboard, révocation) + entrée menu Réglages → "Clés API".
- Auto-testé (8/8): membre→403, création owner ok, hash/raw non exposés en liste, clé valide→200 sur /reservations, clé ne peut pas créer de clé (403), clé invalide→401, révocation→401 ensuite.
- ⚠️ Dispo en PRODUCTION après redéploiement. Le user devra créer la clé depuis son compte Google (mobile ou web) puis la coller dans son projet PC.

## Nouveau logo Casanéo (2026-08 fork #3)
- Source: image uploadée (1536x1024, wordmark blanc/cyan sur fond bleu nuit, badge "Made with AI" en haut à droite EXCLU des crops).
- Assets régénérés via PIL depuis /tmp/newlogo.png: frontend/assets/images/casaneo-logo.png (badge arrondi 1040x328 fond bleu), icon.png + adaptive-icon.png (emblème C sur carré dégradé bleu 1024), favicon.png, splash-image.png (+ splash backgroundColor #020830 dans app.json). Backend assets/casaneo-logo.png remplacé (servi via /api/assets/casaneo-logo.png → emails, relevés, PDF).
- login.tsx: logoWrap carte blanche supprimée (badge autonome, 232x73). (tabs)/_layout.tsx: brandLogo 170x54.
- Vérifié par screenshots (login + drawer). ⚠️ Icône d'app/splash: visibles seulement après regénération des builds iOS/Android (pas dans Expo Go).

## Thème bleu nuit assorti au logo (2026-08 fork #3)
- theme.ts (source unique des couleurs): brand #020830 (fond logo), brandPrimary #0E2364 (boutons/actions, texte blanc OK), surfaceInverse #020830, info #1EB8E0 (cyan flèche du logo). onSurface/success/warning/error inchangés. STATUS colors inchangées.
- Aucun hex brand hardcodé ailleurs (vérifié) → propagation automatique app entière. Vérifié par screenshots (dashboard + avis).

## Renommage app (2026-08 fork #3)
- app.json: "name" → "Casanéo Terrain" (slug/scheme/bundleIdentifier inchangés pour ne pas casser les builds/preview). Visible sous l icône après regénération des builds.

## Mode sombre complet (2026-08 fork #3)
- theme.ts: lightColors + darkColors (bleu nuit: surface #0B1330, brandPrimary #4468F0, borders #243056). `colors` = objet MUTABLE muté via Object.assign avant rendu des routes.
- Mécanisme: pref 'themePref' (system/light/dark) dans AsyncStorage. Web: lecture SYNCHRONE de localStorage à l'éval du module theme.ts. Natif: fallback système sync (Appearance.getColorScheme) + initTheme() async dans _layout.tsx qui GATE le rendu (routes lazy → styles StyleSheet.create bakés avec la bonne palette). Toggle → save + applyThemePref + reload (web location.reload / natif DevSettings.reload, fallback Alert redémarrage en build release).
- Écran /settings/appearance (Automatique/Clair/Sombre) + entrée menu Réglages → Affichage.
- Testé (testing_agent iteration_32): PASS — 11 écrans + modal réservation vérifiés en sombre, retour clair sans résidus. Note design (non-bug): photos logements à fond blanc (assets uploadés).
- ⚠️ testing screenshots: nouveau contexte navigateur = retour clair (localStorage vide), PAS un bug.

## Politique de confidentialité publique (2026-08 fork #3)
- GET /api/privacy (routers/public_site.py, HTMLResponse, sans auth) : page FR complète (données, finalités, sous-traitants Emergent/Channex/Stripe/OTA/IA/Resend, conservation, RGPD, suppression de compte, contact gestion@mhpimmo.fr, logo). Supporte dark mode via prefers-color-scheme.
- URL pour métadonnées stores (PROD après redeploy): https://rental-hub-manager.emergent.host/api/privacy
- login.tsx: lien "Politique de confidentialité" ajouté sous le bouton de connexion (Linking.openURL vers EXPO_PUBLIC_BACKEND_URL/api/privacy).

## Compte démo stores (2026-08 fork #3)
- backend/demo_seed.py: ensure_demo_account() appelé au startup (server.py) — tenant isolé user_id demo_store_review, member admin demo.stores@casaneo.app / CasaneoDemo2026!, 3 logements + 9 réservations (dates RELATIVES à today, statuts variés, finance complète) + 3 avis. Re-seed auto si plus de résa future ou version bump. delete_many strictement scoppé au user_id démo.
- Testé: login OK, isolation vérifiée (0 fuite de vraies données), dashboard/KPI démo OK en preview.
- ⚠️ Sera créé en PRODUCTION automatiquement au démarrage après redéploiement.

## Fiche stores (2026-08 fork #3)
- /app/store_assets/fiche-stores.md : textes complets FR (nom, sous-titre 30c, description courte 80c, description longue, mots-clés 100c, nouveautés, URLs, compte démo, questionnaire confidentialité).
- Captures: /app/store_assets/ios/ (6 x 1290x2796) et /app/store_assets/android/ (6 x 1080x2340), prises avec le compte démo (données fictives), incl. mode sombre.
- Bannière Play Store 1024x500 générée: /app/store_assets/android/feature_graphic_1024x500.png (dégradé bleu nuit + wordmark extrait + tagline Geist).

## Plan commercial SaaS (2026-08 fork #3)
- /app/business/plan-commercial-casaneo.md : plan complet FR (marché, concurrence tarifs 2026 réels Superhote/Smily/Hostaway/Beds24, positionnement suite web PC + app mobile Terrain en complément, grille tarifaire Starter 39/Essentiel 79/Pro 149/Scale 249 €HT/mois, prévisionnel 12 mois → 40 clients / 3400€ MRR, canaux acquisition, plan 90 jours, prérequis produit P0 = inscription self-service + facturation Stripe abonnements, KPIs, risques).

## SaaS : inscription autonome + abonnements Stripe (2026-08 fork #3)
- AUTH: POST /api/auth/register (nom/email/mdp≥8, bcrypt via hash_password, 409 générique doublons users+members) crée un OWNER avec billing essai 14j sans carte (new_trial_billing dans core.py). POST /api/auth/login vérifie d'abord les owners à mot de passe puis les membres. Nouveaux comptes Google/Apple reçoivent aussi le billing trial.
- BILLING (routers/billing.py): PLANS starter 39€/3, essentiel 79€/10, pro 149€/25, scale 249€/50 (mensuel EUR, price_data inline). GET /billing/plans (public), GET /billing/status (état: exempt/trial/active/locked + limites + refresh Stripe si pending_session ou stale 6h), POST /billing/checkout (Stripe Checkout mode subscription, client_reference_id, success → {origin}/subscription-success?session_id=), POST /billing/confirm (vérifie ownership), POST /billing/portal.
- GATE: core.py get_current_user(request, ...) → _billing_gate : 402 si essai expiré sans abonnement, SAUF chemins /api/auth|billing|privacy|public|assets. Comptes SANS champ billing = exemptés (historiques: owner réel + démo). Membres → billing du compte parent.
- LIMITE: POST /api/properties → 402 si property_count >= property_limit de la formule.
- FRONT: register.tsx (fond bleu nuit), login lien "Créer un compte", settings/subscription.tsx (statut + 4 formules + portail), subscription-success.tsx (confirm avec retries), PaywallScreen dans (tabs)/_layout (gate /billing/status entitled).
- TESTS: backend 12/12 auto-testés (register/login/lock 402/limite logements/checkout live URL/exemptions) + testing_agent iteration_33 frontend 8/8 PASS (inscription→dashboard, essai 13j, redirection checkout.stripe.com SANS payer, paywall après expiration simulée, régression compte historique OK).
- ⚠️ Clé Stripe LIVE en preview : sessions checkout créées côté Stripe live (jamais payées). Portail client Stripe: à configurer dans Dashboard → Billing → Customer portal si pas déjà actif.
- Prod: dispo après redéploiement.

## Onboarding guidé + email rappel essai J+10 (2026-08 fork #3)
- app/onboarding.tsx : après inscription (register → replace /onboarding), 3 étapes avec progression (créer logement → /property-form, connecter Channex → /channel-manager via GET /channex/status, inviter équipe → /settings/members), boutons "Accéder au tableau de bord"/"Passer".
- FIX login.tsx: le redirect user→/(tabs) ne s'applique que si pathname==='/login' (sinon il volait la navigation vers /register/onboarding).
- server.py _trial_reminder_loop (quotidien): users non exempts, sans abonnement actif, trial_ends_at entre now et now+4j, trial_reminder_sent≠true → email FR (formules+prix) via send_email (Resend), flag trial_reminder_sent. Testé: requête match OK + email envoyé à delivered@resend.dev.
- Vérifié par screenshots: inscription → onboarding (3 étapes), étape 1 → formulaire logement, login normal → dashboard OK.
- Question user "Connect dans Stripe": il s'agit du Customer PORTAL (Réglages → Billing → Customer portal), pas de Stripe Connect — URL directe https://dashboard.stripe.com/settings/billing/portal

## Conformité App Store — blockers corrigés (2026-08 fork #3)
- Revue skill expo-appstore-readiness-review effectuée (rapport livré au user: 2 blockers, 3 warnings).
- FIX 5.1.1(v): DELETE /api/auth/account (owner only, refuse membres/clé API/compte démo, annule l'abonnement Stripe, delete_many({user_id}) sur toutes les collections + sessions + user). Testé 6/6 (403 membre, 403 démo, 200 owner, données/sessions purgées, token invalidé). UI: Réglages → "Supprimer mon compte" (double confirmation, masqué pour membres) + "Contacter le support" (mailto gestion@mhpimmo.fr).
- FIX 3.1.1 (IAP): sur iOS natif (Platform.OS==='ios'), les boutons d'achat Stripe sont masqués — settings/subscription.tsx affiche "gérez depuis la version web" (sans lien d'achat), PaywallScreen sans bouton "Voir les formules". Web/Android inchangés.
- FIX warnings: RootErrorBoundary dans app/_layout.tsx (écran erreur FR + réessayer), ITSAppUsesNonExemptEncryption=false dans app.json, adaptiveIcon backgroundColor → #020830.
- fiche-stores.md: note réviseur mise à jour (compte démo = membre; suppression visible pour comptes propriétaires créés via inscription).
- Icône App Store: normal que l'ancienne apparaisse tant qu'un nouveau build n'est pas généré (icône embarquée dans le binaire).

## Protection Pricelabs (2026-08 fork #4)
- Champ `pricelabs_managed` (bool, optionnel) sur Property (PropertyIn core.py). PUT /properties/{id} ne l'écrase pas si absent du payload (pop si None).
- core.py enqueue_channex_rates: si prop.pricelabs_managed → return early (aucun push tarifs/min stay vers Channex) + sync_log "tarifs NON envoyés (gérés par Pricelabs)". La dispo (enqueue_channex_availability) reste synchronisée.
- routers/channex.py full-sync: si pricelabs_managed → rest_values vide (dispo seule poussée), résultat expose pricelabs_managed + log adapté.
- UI: property-form.tsx section "Tarification externe" → Switch "Tarifs gérés par PriceLabs" (testID prop-pricelabs), chargé/sauvé avec le formulaire.
- Testé: PUT ON/OFF + préservation si champ omis (API), unit test enqueue (0 outbox si ON, 1 si OFF, log OK), screenshot UI OK.

## Revue App Store #2 (2026-08 fork #4)
- Re-run skill expo-appstore-readiness-review (iOS): 0 blocker, 2 warnings, 4 manual.
- W1: Sign in with Apple offert mais DELETE /api/auth/account ne révoque pas les tokens SIWA via l'API REST Apple (nécessite clé .p8 Apple Developer) — Apple 5.1.1(v).
- W2: Paywall iOS ((tabs)/_layout.tsx L155) dit "Réactivez votre compte depuis la version web" = incitation achat externe (Apple 3.1.1) — suggérer formulation neutre.
- Manuels: compte démo dans App Store Connect, test TestFlight, /api/privacy en prod, privacy manifest auto (Expo SDK 54).

## Corrections warnings App Store (2026-09 fork #4)
- W2 corrigé: paywall iOS ((tabs)/_layout.tsx) → texte neutre "Contactez le support" (plus d'incitation achat web, Apple 3.1.1).
- W1 corrigé: révocation tokens Sign in with Apple à la suppression de compte (Apple 5.1.1(v)):
  - routers/auth.py: helpers _apple_revocation_config/_apple_client_secret (ES256 pyjwt)/_apple_exchange_code/_apple_revoke_refresh_token.
  - /auth/apple accepte authorization_code (AppleAuthIn) → échange contre refresh_token stocké dans users.apple_refresh_token.
  - DELETE /auth/account révoque le refresh token Apple (best effort) avant purge.
  - Frontend: login.tsx envoie cred.authorizationCode, AuthContext.loginWithApple param optionnel.
  - Secrets requis (sinon skip gracieux): APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY_B64 (.p8 en base64) — placeholders ajoutés à backend/.env, À AJOUTER AUX SECRETS DE PRODUCTION quand l'utilisateur fournira sa clé .p8.
- Testé: skip gracieux sans config, client_secret ES256 validé (iss/sub/aud/kid), endpoint accepte le nouveau champ.
- Endpoint public GET /api/store-assets/{filename} ajouté (téléchargement direct des captures stores depuis /app/store_assets/{ipad,ios,android}).

## Fork #4 — suite (2026-09)
### Clé Apple SIWA configurée
- APPLE_TEAM_ID=Q5M8Z6V74B, APPLE_KEY_ID=3DTTV49322, APPLE_PRIVATE_KEY_B64 renseignés dans backend/.env (preview). Signature ES256 validée avec la vraie clé. L'UTILISATEUR DOIT AUSSI LES AJOUTER AUX SECRETS DE PRODUCTION (valeurs déjà communiquées dans le chat).

### Refactoring backend (core.py 3004 → 2510 lignes)
- infra.py: env/Mongo(db,client)/app/api_router/logger + _sync_log + get_channel_adapter + get_channex_adapter.
- pricing.py: compute_supplement_amount, real_tourist_tax, _match_promo, DEFAULT_DYNAMIC_PRICING, _price_for_day, _is_high_season, _date_ranges (fonctions pures).
- auth_helpers.py: _billing_gate, get_current_user, new_trial_billing, _prop_scope, _can, _can_inbox, _BILLING_OPEN_PREFIXES.
- payments.py: stripe_client, _apply_stripe_payment, _record_auto_charge_error, auto_charge_reservation, run_auto_charge_for_user (imports paresseux de core pour get_templates/_set_property_rooms_availability/_send_booking_confirmation/_build_auto_charge → pas de cycle).
- core.py réimporte et ré-exporte tout (routers inchangés, `from core import *` fonctionne toujours, __all__ conservé).
- Validation: 28 routers importés, 301 tests pytest OK. Les 9 échecs/18 erreurs restants sont PRÉ-EXISTANTS et ENVIRONNEMENTAUX (compte Channex en "production" vs tests attendant "staging", données live, BASE_URL public) — pas liés au refactor.

### Page vitrine publique
- GET /api/site (routers/site.py): landing HTML Casanéo (hero bleu nuit, 6 features, 4 tarifs 39/79/149/249 €, CTA mailto, liens privacy). Sert de site officiel pour la validation d'organisation Google/Apple (domaine casaneo.pro).

### Rapport revenus N vs N-1
- analytics.tsx: charge year et year-1 en parallèle, cartes résumé avec delta % revenus et delta points d'occupation (vert/rouge, testID rev-delta), graphe à doubles barres (N-1 grisée) + légende. Aucun changement backend (endpoint /analytics/revenue?year= existant).

## Conformité Google Play — permission photos (2026-09 fork #4)
- Google Play a rejeté READ_MEDIA_IMAGES (bundle 107) : politique "Photo Picker obligatoire".
- Fix: app.json → android.permissions=[] + blockedPermissions=[READ_MEDIA_IMAGES, READ_MEDIA_VIDEO].
- Nouveau helper src/utils/photoAccess.ts (ensurePhotoAccess): Android/web → true (Photo Picker système sans permission) ; iOS → requestMediaLibraryPermissionsAsync + Alert "Ouvrir les réglages" si canAskAgain=false.
- 7 écrans migrés: property-form (x2), supplement-form, intervention-form, accounting-form, settings/promotion-form, settings/company, settings/booking-site.
- Le PROCHAIN build Android (108) n'aura plus la permission → dans Play Console, déclarer "n'utilise pas ces autorisations". Page /api/account-deletion créée pour les URLs de suppression Play Console (404 en prod tant que pas redéployé).

## Fix Android 15 — expo-audio retiré (2026-09 fork #4)
- Play Console (build 109) signalait: services de premier plan restreints (expo.modules.audio AudioRecordingService/AudioControlsService via BOOT_COMPLETED, crash Android 15+). Suspect n°1 aussi pour le crash testeur (app se ferme quelques secondes après le tableau de bord, connexion Google = nouveau compte).
- expo-audio SUPPRIMÉ (yarn remove + plugin retiré d'app.json). CelebrationBanner: son cash-register remplacé par Haptics.notificationAsync(Success) (expo-haptics déjà installé). Asset /assets/sounds/cash-register.mp3 laissé (inutilisé).
- Avertissements restants NON bloquants: edge-to-edge APIs obsolètes (React Native core, rien à faire côté app) + screenOrientation portrait (recommandation grands écrans, conservé volontairement).
- AUSSI en attente côté user: crash Google login → correctif probable = ce retrait; sinon récupérer stack trace (Play Console → Qualité → Android vitals → Crashs et ANR).
- ACTION USER: redéployer + build 110 + nouvelle release. NOTE: /auth/session (Google) renvoie un user minimal sans /auth/me côté frontend exchange() — amélioration possible si le crash persiste.

## Diagnostic crash Android Google login (2026-09 fork #4) — EN COURS
- Crash persiste malgré retrait expo-audio (build utilisateur). Email+demo OK, Google (nouveau compte) → dashboard qq secondes → fermeture.
- Mis en place: rapporteur de crash → frontend _layout.tsx ErrorUtils.setGlobalHandler envoie erreurs JS fatales à POST /api/client-errors (routers/site.py, garde 200 entrées). Lecture: GET /api/client-errors?key=casaneo-debug-2026 (⚠️ à lire sur PROD: https://rental-hub-manager.emergent.host/api/client-errors?key=casaneo-debug-2026).
- Fix: AuthContext.exchange() récupère désormais /auth/me après /auth/session (le user Google était minimal: sans role/permissions/billing).
- PROCHAINE ÉTAPE: user redéploie + build 111 + testeur reproduit → curl l'endpoint prod pour lire la stack. Vérifier AUSSI que l'utilisateur a bien déployé AVANT le build précédent (doute: son build 110 contenait peut-être encore expo-audio).

## Fil d'Ariane diagnostic crash Google Android (2026-09 fork #4)
- Crash persiste (se ferme désormais DIRECTEMENT après connexion Google; refus des notifications ne change rien; email demo OK; 0 rapport reçu → crash natif ou rapport avorté).
- Ajouts: src/utils/diag.ts crumb() → POST /api/client-errors avec keepalive. Jalons: google:open-browser, google:browser-result:<type>, exchange:start/session-ok/me-ok/me-fail/error, tabs:mount, tabs:billing:<état>, push:request-perm/perm-denied/token-ok/error.
- _layout.tsx global handler: keepalive + délai 2s avant crash pour laisser partir le rapport.
- LECTURE PROD: curl "https://rental-hub-manager.emergent.host/api/client-errors?key=casaneo-debug-2026" → le dernier jalon avant silence = étape fautive.
- ACTIONS USER: Deploy → build → testeur reproduit → lire jalons. Toujours demander la stack Android vitals (Play Console → Qualité → Crashs et ANR).

## Marqueur de version visible (2026-09 fork #4)
- login.tsx: affiche "Version X.Y.Z (build N)" en bas de l'écran de connexion (expo-constants) pour vérifier quelle version le testeur utilise réellement.
- Constat: 0 crash Android vitals + 0 breadcrumb reçu → quasi certain que le testeur utilise un build SANS le code diag (deploy+build pas refaits après ajout du fil d'Ariane).

## ✅ CRASH ANDROID RÉSOLU — boucle infinie permission push (2026-09 fork #4)
- Fil d'Ariane (build 1.1.5 testeur): des DIZAINES de push:request-perm → push:perm-denied PAR SECONDE.
- Cause racine: PushRegistrar → requestPermissionsAsync() ouvre la popup → AppState passe inactive → retour "active" → le listener AppState rappelait registerForPush → nouvelle popup → boucle infinie → Android tue l'app. Le bug existait depuis l'implémentation push; déclenché quand la permission n'est pas accordée (refus). Connexion Google aggravait (retour navigateur = transition AppState).
- Fix PushRegistrar.tsx: getPermissionsAsync d'abord (sans popup); prompt UNE seule fois par session (flag module askedThisSession) et jamais depuis le retour premier plan (allowPrompt=false); respect canAskAgain; garde anti-réentrance (registering).
- ACTION USER: Deploy → build (≥1.1.6) → testeur reproduit. Attendu: plus de crash, y compris en refusant les notifications.

## Recherche dans Réservations (2026-09 fork #4)
- (tabs)/calendar.tsx (écran "Réservations"): barre de recherche (testID reservation-search, bouton clear) sous le titre.
- Recherche insensible aux accents/casse sur: nom voyageur, nom logement, plateforme, email/tél voyageur, dates (ISO + format "05 septembre 2026").
- Pendant une recherche: porte sur TOUT l'historique (inclut les statuts "départ" normalement masqués) + compteur de résultats. Combinable avec les chips de statut.
- Testé via screenshot (recherche "villa" → 3 résultats incluant départs).

## Tri Réservations (2026-09 fork #4)
- (tabs)/calendar.tsx: rangée "Trier :" avec chips Arrivée / Montant / Logement (testID sort-chip-{check_in,amount,property}). Re-tap = inverse le sens (flèche ↑/↓). Montant = décroissant par défaut; chip Montant masquée si !canSeePrices(user). Tri combiné avec recherche + filtres statut. Testé (screenshot: tri montant desc OK).
- Télémétrie prod: crash Android CONFIRMÉ RÉSOLU (push:token-ok sans boucle, tabs:mount, aucune erreur fatale) — en attente de confirmation formelle du testeur.

## Filtre par logement — Réservations (2026-09 fork #4)
- (tabs)/calendar.tsx: rangée de chips logements scrollable (testID prop-chip-all / prop-chip-{id}), visible seulement si ≥2 logements. Re-tap sur le chip actif = retour à "Tous". Combiné avec recherche + statut + tri. Testé (screenshot: filtre "Mas des Oliviers" → 2 résas).

## Décaler un ménage — À faire aujourd'hui (2026-09 fork #4)
- Backend: PATCH /interventions/{id}/reschedule {date} (routers/interventions.py). Règles: kind=menage uniquement, non fait, date ≥ aujourd'hui, et nouvelle date ≤ prochaine arrivée du logement (sinon 400 "Impossible : une arrivée est prévue le X"). Testé (400 après arrivée, 200 jour d'arrivée, 400 date passée).
- Frontend cleaning.tsx: bouton "Décaler" (testID reschedule-{id}) sur les cartes ménage non faites → modale avec 7 prochaines dates (testID reschedule-date-YYYY-MM-DD) → succès: alerte + reload; refus: alerte avec le motif du backend. Testé via screenshot.

## Session Juin 2026 — Rappels voyageurs, Notes internes, Optimisation Play Store
- **Email avant l'arrivée (auto)** : prefs `arrival_email` {enabled, days_before (0-14, défaut 2), extra_message}. Fonction `run_arrival_emails_for_user` (core.py) + boucle `_arrival_email_loop` (server.py, 6h). Email au voyageur avec adresse, heure d'arrivée, instructions clés (`key_instructions` du logement, bloc code), liens photos clés, message perso. Dédup via `arrival_email_sent_at` sur la réservation, tracé dans message_logs (kind=cles). Réglage UI: /settings/arrival-email (section Communication).
- **Note interne réservation** : champ `internal_note` sur ReservationIn (jamais envoyé au voyageur). Saisie dans reservation-form.tsx, affichée (encadré ambre) sur l'écran "À faire aujourd'hui" (départs, arrivées, ménages — via note_map dans cleaning-schedule).
- **Play Store** : ajout plugin `expo-build-properties` avec `enableProguardInReleaseBuilds` + `enableShrinkResourcesInReleaseBuilds` (corrige "Obscurcissement 2%" du tableau de bord des releases, deadline fév. 2027). Nécessite un nouveau build Android.
- **Historique des ménages** : nouvel endpoint GET /api/cleaning-history (ménages passés + faits du jour, tri desc, 500 max, scope membre respecté). IMPORTANT FIX : suppression des purges `delete_many` des ménages passés dans GET /interventions et GET /dashboard (remplacées par exclusion `$or` kind!=menage / date>=today) — l'historique est désormais conservé. Écran /cleaning-history (stats fait/non fait, filtre par logement, groupé par mois, intervenant + raison si non fait), accessible via bouton horloge dans l'en-tête de "À faire aujourd'hui".
- **Message d'arrivée par logement** : champ `arrival_email_message` sur PropertyIn (fiche logement, section "Email avant l'arrivée" dans property-form.tsx). S'il est renseigné, il remplace le message global (prefs arrival_email.extra_message) dans l'email automatique avant l'arrivée. Testé : override + fallback global OK.
- **Aperçu de l'email d'arrivée** : refactor `_compose_arrival_email` (core.py, sujet+HTML+parts structurées, réutilisé par run_arrival_emails_for_user). Endpoint GET /api/preferences/arrival-email-preview?property_id= (réservation fictive "Jean Dupont", J+days_before, 3 nuits ; renvoie empty=True si ni instructions ni message). UI : section "Aperçu de l'email" dans /settings/arrival-email — puces logements + maquette de l'email (couleurs fixes claires, identique aux 2 thèmes).
- **Email de test (arrivée)** : POST /api/preferences/arrival-email-test {property_id, email?} — envoie l'email d'arrivée exemple sur l'adresse fournie (défaut : email du compte), sujet préfixé [TEST]. Helper partagé _arrival_preview_content dans preferences.py. Erreur 400 claire si adresse invalide/injoignable (l'API email Emergent renvoie 422 "undeliverable_recipient" pour les adresses inexistantes — ex. demo.stores@casaneo.app n'a pas de vraie boîte mail). UI : champ email prérempli + bouton "M'envoyer l'email de test" sous l'aperçu, avec message succès/erreur.

## Traduction intégrale FR→EN (i18n)
- **Moteur** : /app/frontend/src/i18n/index.ts — dict FR→EN (en.json ~1600 entrées, clés normalisées NFC + espaces réduits), règles regex pour chaînes dynamiques, découpe par segments (" · ", " — ", " : "). Repli = français (jamais de texte cassé).
- **Patch global** : src/i18n/patch.ts — traduit <Text> (children), placeholders TextInput et Alert.alert au rendu quand lang=en. Installé dans app/_layout.tsx (installI18nPatch), initI18n dans le gating ready.
- **Préférence** : AsyncStorage 'app_lang_pref' (auto|fr|en). auto = langue du téléphone (expo-localization). Sélecteur dans /settings/appearance (section Langue / Language, testID lang-auto/fr/en) — recharge l'app comme le thème. dayjs.locale switché par initI18n ; les `dayjs.locale("fr")` module-scope ont été supprimés des écrans.
- **Site public** : pastille LangToggle (src/components/LangToggle.tsx) sur /book/[slug] ; payloads checkout/request envoient lang → guest_lang stocké.
- **Emails voyageurs bilingues** (selon reservation.guest_lang fr|en, helper _guest_lang core.py) : email d'arrivée (_compose_arrival_email), rappels de paiement, solde + enregistrement (server.py), accusé de demande. Sélecteur "Langue du voyageur" (chips) dans reservation-form.tsx.
- **Génération du dico** : /app/scripts/translate_strings.py (Claude via clé Emergent). Testing agent iteration 34 : 8/8 backend, 5/5 frontend PASS.
- Piège connu : le rendu runtime traduit aussi les données dynamiques si elles matchent exactement une clé (ex. prénom "Compte") — rare, accepté.
- **Détection langue voyageur (OTA)** : helper `_detect_guest_lang(cust, attrs)` (core.py) — champ language du client (fr* → fr, sinon en), repli pays (_FR_COUNTRIES = FR + DOM-TOM + MC → fr, autre pays → en), '' si inconnu. Appliqué dans process_channex_bookings (création + backfill si guest_lang absent, JAMAIS d'écrasement d'une valeur existante/manuelle) et dans la synchro Lodgify (b.language). Testé : création en/fr, resync ne réécrase pas un choix manuel, backfill.
- **Badge langue voyageur** : drapeau 🇫🇷/🇬🇧 affiché à côté du nom du voyageur sur les cartes de la liste Réservations (calendar.tsx, champ guest_lang si défini) et sur les arrivées de "À faire aujourd'hui" (guest_lang ajouté aux arrivals de /api/cleaning-schedule).
- **Jours tampons / blocages exclus des départs & ménages** (fix demandé par l'utilisateur) :
  * ensure_cleaning (core.py) : statut "bloque" (et "annulee") → aucun ménage auto créé + suppression du ménage auto futur non fait si le statut change vers bloqué.
  * Synchro iCal (run_ical_sync) : détection des blocages via _is_block_summary (helpers.py, mots-clés "not available/unavailable/blocked/busy/indisponible/blocage" ; "reserved" = vraie résa Airbnb) → statut "bloque", guest "Blocage {platform}", pas de ménage ; correction rétroactive du statut à la resynchro.
  * /api/cleaning-schedule : départs, arrivées et note_map excluent "bloque".
  * /api/dashboard : arrivals_today / departures_today / current_stays excluent "bloque".
  * Nettoyage rétroactif exécuté : 12 ménages auto liés à des blocages supprimés (avec garde-fou si une vraie résa partage la même date).

## Blocage rapide depuis le planning (2026-06)
- (tabs)/planning.tsx : en mode blocage (toggle-block-mode), la sélection début+fin ouvre désormais une modale "Bloquer ces dates ?" (testID quick-block-note / quick-block-save) qui crée le blocage IMMÉDIATEMENT via POST /reservations {status:"bloque", guest_name: motif || "Blocage", notes: motif} — plus de passage par reservation-form. Rechargement résa + /availability/blocked après création.
- Déblocage rapide : en mode blocage, toucher une barre de blocage existante ouvre une modale "Débloquer ces dates ?" (testID quick-unblock-confirm, bouton rouge) → DELETE /reservations/{id}. Hors mode blocage, la barre ouvre toujours le formulaire.
- i18n : nouvelles entrées en.json (Bloquer ces dates ?, Motif (optionnel), Bloquer immédiatement, Débloquer…, hint mode blocage) + nouvelle règle regex "Du X au Y" → "From X to Y" dans src/i18n/index.ts. Les textes dynamiques de la modale sont des template literals uniques (un seul child Text) pour une traduction fiable.
- Testé via screenshot (web, EN) : création blocage "Travaux piscine" 06→08 sept sur Mas des Oliviers + déblocage OK.

## Report de tâches (ménage/intervention/remise de clés) — 2026-06
- PATCH /api/interventions/{id}/reschedule étendu : accepte désormais tous les kinds SAUF caution (avant : uniquement menage). Règle inchangée : nouvelle date >= aujourd'hui et <= prochaine arrivée (check_in) du logement, erreur 400 explicite sinon. Testé via API (beyond→400, jour d'arrivée→200, caution→400).
- cleaning.tsx : bouton « Décaler » affiché sur toutes les tâches non faites (ménages, interventions, remises de clés) ; modale titrée « Décaler le ménage » ou « Décaler la tâche » selon le kind ; sous-titre mis à jour (« jusqu'au jour de la prochaine arrivée du voyageur »). Entrées en.json ajoutées + "(demain)"→"(tomorrow)".

## Intégration Telegram (2026-06)
- Nouveau module backend `telegram_notify.py` : tg_send_raw (sendMessage HTML), tg_notify(uid, event, text) jamais bloquant, tg_detect_chats (getUpdates), build_daily_digest + run_daily_digests (récap quotidien, heure Paris, idempotent via telegram.last_daily_sent).
- Réglages par utilisateur dans preferences.telegram : enabled, bot_token, chat_ops (équipe), chat_admin (gestion), notify_bookings/payments/reschedule/daily, daily_hour. Validation dans PUT /preferences ; renvoyé par GET/PUT /preferences.
- Routeur `routers/telegram.py` : GET /api/telegram/chats (détection), POST /api/telegram/test (target ops|admin), POST /api/telegram/send-digest.
- Hooks événements : process_channex_bookings (nouvelle résa/annulation, seulement si check_out >= aujourd'hui → chat gestion) ; import iCal (nouvelle résa non bloquée) ; payments.py _apply_stripe_payment (solde/site/caution/paiement → gestion, résa directe site → gestion) ; interventions reschedule (tâche décalée → chat équipe).
- Boucle `_telegram_daily_loop` dans server.py (toutes les 15 min, envoie le récap à partir de daily_hour, une fois/jour).
- Frontend : app/settings/telegram.tsx (token BotFather, détection + assignation des chats Équipe/Gestion, 4 interrupteurs, heure du récap, boutons test) ; entrée dans settings/index.tsx section Communication ; i18n en.json complété.
- Testé : PUT/GET réglages OK, erreurs Telegram (Unauthorized) proprement remontées, reschedule non bloquant avec token invalide, digest vide → {empty:true}. Livraison réelle non testée (nécessite le vrai token bot de l'utilisateur).

## SEO site public (2026-06)
- GET /api/public/sitemap.xml (routers/public_site.py) : sitemap dynamique basé sur l'hôte de la requête (normalise *.casaneo.pro → www.casaneo.pro) ; inclut / , /book/{slug} et /book/{slug}/{property_id} des sites publics activés.
- /app/frontend/public/robots.txt : Allow /, Disallow /login /settings /accept-invite, directive Sitemap → https://www.casaneo.pro/api/public/sitemap.xml (servi à la racine par Expo, copié dans dist à l'export).
- src/components/CanonicalLink.tsx monté dans _layout.tsx : balise <link rel="canonical"> auto-référente par page (web only), origin forcé à https://www.casaneo.pro sur le domaine casaneo.pro.
- Testé : sitemap OK (accueil + 24 logements mhpimmo), robots.txt servi, canonical injectée sur /book/mhpimmo.
- NOTE GSC : le message "Page avec redirection" (http/apex/www) est NORMAL, aucune action.

## Liaison partenaire casaneo.pro (2026-06)
- backend/.env : PARTNER_SIGNUP_URL (https://www.casaneo.pro/api/public/partner/signup) + PARTNER_SIGNUP_SECRET.
- routers/auth.py : RegisterIn étendu (agency_name, phone optionnels) ; après création du compte dans POST /auth/register, tâche asynchrone _notify_partner_signup → POST vers la version web avec X-Partner-Secret {email, name, agency_name, phone, source:"app_mobile", app_user_id}. Jamais bloquant.
- login.tsx : bouton testID go-agency-signup « Créer un compte agence sur casaneo.pro » → Linking.openURL(https://www.casaneo.pro/inscription-app). MASQUÉ sur iOS (Platform.OS !== "ios") pour éviter un rejet Apple 3.1.1 (lien externe de création de compte lié à un abonnement payant) — visible sur Android et web. i18n en.json complété.
- Testé E2E : register 200 + webhook accepté (endpoint partenaire répond 200 avec le secret). 2 leads de test envoyés à casaneo.pro (Test Partenaire Emergent / Vérification liaison) — à supprimer côté web.
- NOTE : lors d'un test, toutes les sessions de la base PREVIEW ont été purgées par erreur (reconnexion nécessaire en preview uniquement, aucune donnée perdue, prod non affectée).

## Alertes de synchro Telegram (2026-06)
- infra._sync_log : si status=="error" → tg_sync_alert(uid, provider, kind, message) (import paresseux pour éviter le cycle).
- telegram_notify.tg_sync_alert : envoie au chat_admin (fallback ops), toggle notify_sync (défaut True), anti-spam 1 alerte / 6 h via telegram.last_sync_alert (UTC ISO). Jamais bloquant.
- preferences.py : notify_sync + préservation last_sync_alert. settings/telegram.tsx : toggle "Alertes de synchronisation" (testID tg-notif-sync). i18n complété.
- Testé : erreur → tentative d'envoi Telegram + last_sync_alert posé ; 2e erreur immédiate → cooldown ; success → aucun envoi.

## Migration Expo SDK 54 → 57 (2026-06)
- package.json : expo ^57.0.0, react-native 0.86.3, react 19.2.3 (yarn expo install expo@^57 + --fix). expo-doctor 20/20.
- @expo/vector-icons SUPPRIMÉ → @react-native-vector-icons/{ionicons, ant-design, material-design-icons} 13.1.4 ; imports réécrits dans 82 fichiers (default imports).
- app.json : newArchEnabled & edgeToEdgeEnabled retirés (obsolètes SDK 55+).
- expo-router SDK 56+ interdit @react-navigation/* : (tabs)/_layout.tsx utilise ScrollView natif à la place de DrawerContentScrollView ; MenuButton.tsx : nav.dispatch({type:"OPEN_DRAWER"}) au lieu de DrawerActions ; @react-navigation/drawer désinstallé.
- src/hooks/use-icon-fonts.ts simplifié : retourne [true, null] (plus de chargement CDN — polices autolinkées/fournies par @react-native-vector-icons).
- Régression frontend complète (iteration_35.json) : 8/8 PASS (login, dashboard, drawer, planning, blocage rapide, cleaning, réglages Telegram, formulaire résa). Avertissements bénins react-native-web 0.21 (shadow*/pointerEvents deprecations) — non bloquants.
- IMPORTANT : les prochains builds natifs (iOS/Android) seront générés sous SDK 57.
