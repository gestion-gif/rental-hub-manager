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
