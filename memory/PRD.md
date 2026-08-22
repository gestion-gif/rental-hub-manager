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
