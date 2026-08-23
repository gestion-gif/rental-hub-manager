#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
user_problem_statement: "StayPilot - Channel manager location saisonnière. Nouvelle fonctionnalité: intégration Lodgify (sync réservations + import logements) et boîte de réception (messages voyageurs OTA)."

backend:
  - task: "Lodgify channel connect/status/disconnect"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "POST /api/channel/connect valide la clé via list_properties et la stocke dans channel_settings. GET /api/channel/status renvoie connected/provider/properties_count/mapped_count. POST /api/channel/disconnect supprime. Testé via curl avec vraie clé: connect ok (24 props), status ok."

  - task: "Lodgify import properties"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "POST /api/channel/import-properties crée des logements app depuis Lodgify (idempotent par lodgify_id). GET /api/channel/remote-properties liste avec flag imported. Testé curl: 24 importés."

  - task: "Lodgify sync reservations"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "POST /api/channel/sync mappe bookings Lodgify -> reservations (dedup lodgify_id), crée conversations depuis thread_uid, ensure_cleaning sur départ. Status mapping Booked->confirmee etc. Testé curl: 359 importées, 359 conversations, 22 unmapped."

  - task: "Inbox (boite de reception)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "GET /api/inbox liste conversations. GET /api/inbox/{thread_uid} fetch thread live via Lodgify, normalise messages (mine=Owner), strip HTML, marque lu. Testé curl: thread renvoie messages."

frontend:
  - task: "Channel Manager UI + Inbox screens"
    implemented: true
    working: "NA"
    file: "frontend/app/channel-manager.tsx, frontend/app/inbox.tsx, frontend/app/inbox/[thread].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Refonte channel-manager (connexion Lodgify, import, sync), écrans inbox + thread avec réponse IA. Non testable en auto (Google OAuth). À valider par l'utilisateur."

metadata:
  created_by: "main_agent"
  version: "2.0"
  test_sequence: 8
  run_ui: false

test_plan:
  current_focus:
    - "Lodgify channel connect/status/disconnect"
    - "Lodgify import properties"
    - "Lodgify sync reservations"
    - "Inbox (boite de reception)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: "Nouveaux endpoints Lodgify + inbox ajoutés et validés via curl avec vraie clé API. Merci de tester les endpoints backend channel/* et inbox/*. Auth: créer une session en insérant dans user_sessions un doc {session_token, user_id, expires_at futur} + un user dans users, puis header Authorization: Bearer <token>. Clé Lodgify de test à utiliser dans /channel/connect: I6T0EMSnL+oqohaXmF3/SPjgQkisvNWD+nvretEaGWtRvOuedVYZ8vhE0XMd/7Np. NE PAS tester le frontend (Google OAuth non automatisable)."

## Iteration 9 — Intervenants, Propriétaires, Envoi message, Navigation drawer
backend:
  - task: "Staff (intervenants) CRUD"
    implemented: true
    working: true
    file: "backend/server.py"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "GET/POST/PUT/DELETE /api/staff. Testé curl create/list/delete OK."
  - task: "Owners (propriétaires) CRUD + summary"
    implemented: true
    working: true
    file: "backend/server.py"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "GET/POST/PUT/DELETE /api/owners + GET /api/owners/{id}/summary (revenus totaux, per_month, nuitées, logements liés via owner_id). list renvoie property_count. delete délie les logements. Testé curl OK."
  - task: "Property owner_id link + preservation"
    implemented: true
    working: true
    file: "backend/server.py"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "PropertyIn.owner_id ajouté. update_property retire owner_id/lodgify_id du $set si None (préserve le lien quand le formulaire l'omet)."
  - task: "Inbox reply (envoi message Lodgify v1)"
    implemented: true
    working: true
    file: "backend/server.py"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "POST /api/inbox/{thread_uid}/reply. Trouve la réservation par thread_uid -> lodgify_id (booking id), envoie via POST v1 /reservation/{id}/messages (payload array, type Owner). Validé: message vide -> 400, thread inconnu -> 404 (avant tout envoi). NE PAS tester l'envoi réel (message envoyé au vrai voyageur)."

frontend:
  - task: "Drawer navigation + square property grid + settings + inbox reply UI"
    implemented: true
    working: "NA"
    file: "frontend/app/(tabs)/_layout.tsx, properties.tsx, settings/*, inbox/[thread].tsx"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Navigation convertie en drawer coulissant (hamburger). Fixé conflit de version @react-navigation/drawer -> 7.3.9 (compatible native 7.2.5). Cartes logements en grille carrée 2 colonnes. Écran Paramètres (intervenants, propriétaires, clé API, couleurs). Interventions repliables sur le dashboard. Réponse inbox avec brouillon IA + envoi. Non testable auto (Google OAuth)."

agent_communication:
    -agent: "main"
    -message: "Iteration 9. Tester UNIQUEMENT le backend: /api/staff (CRUD), /api/owners (CRUD + /summary avec calcul revenus), préservation owner_id/lodgify_id sur PUT /api/properties, et VALIDATION de POST /api/inbox/{thread}/reply (message vide->400, thread inconnu->404). NE JAMAIS tester l'envoi réel de message (part au vrai voyageur Airbnb/Booking). Auth: insérer users + user_sessions dans Mongo (user_id de TEST distinct) et header Bearer. Ne pas tester le frontend."

## Iteration 10 — Bugs (noms voyageur, ménages passés, encaissement) + acomptes + logos
backend:
  - task: "Purge ménages passés"
    implemented: true
    working: true
    file: "backend/server.py"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "GET /api/interventions et /api/dashboard suppriment (delete_many) les kind=menage avec date<today. ensure_cleaning ignore les départs passés. Testé: 22 supprimés, insert stale supprimé au GET."
  - task: "Encaissement manuel: dû->payé sans save + acomptes"
    implemented: true
    working: true
    file: "backend/server.py"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "PATCH /api/reservations/{id}/paid met finance.paid=total, due=0 (immédiat). POST /api/reservations/{id}/payments (acompte) et DELETE .../payments/{pid} recalculent finance via recompute_payment (paid=max(lodgify,sum(acomptes)) ou total si paid_manual). Marqueur 'paid' posé si soldé. Préservé en synchro (_lodgify_paid)."
  - task: "Nom voyageur Airbnb/direct"
    implemented: true
    working: true
    file: "backend/server.py"
    needs_retesting: false
    status_history:
        -working: true
        -agent: "main"
        -comment: "Sync: si guest.name vide/N/A, récupère le nom via le fil de discussion (get_thread guest_name). Toutes les résa actuelles/futures ont le vrai nom. 4 résa 2025 passées restent 'Voyageur Airbnb' car Lodgify ne fournit AUCUN nom (masqué) - limite API, non corrigeable."

frontend:
  - task: "Logos plateforme calendrier + acomptes UI + icônes interventions"
    implemented: true
    working: "NA"
    file: "frontend various"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "PlatformLogo (Airbnb/Booking/Vrbo/Direct) sur réglette + liste résa. Acomptes dans reservation-form. Palette 24 couleurs. Icônes MCI par type intervention. Non testable auto (Google OAuth)."

agent_communication:
    -agent: "main"
    -message: "Iteration 10. Tester UNIQUEMENT backend. Créer user+session de TEST (user_id isolé, ex test_iter10) dans users/user_sessions, header Bearer. TESTS: 1) Insérer une réservation de test (source='lodgify', finance={total:500,_lodgify_paid:0,paid:0,due:500}, check_in/out futurs) puis PATCH /api/reservations/{id}/paid {paid:true} -> finance.paid=500, due=0, markers contient 'paid'; {paid:false} -> due=500, paid=0, plus de 'paid'. 2) POST /api/reservations/{id}/payments {amount:200} -> finance.paid=200, due=300, pas encore 'paid'; ajouter {amount:300} -> paid=500,due=0,marker 'paid'; DELETE un acompte -> recalcul. 3) Insérer intervention kind='menage' date passée + date future, GET /api/interventions -> la passée disparait, la future reste. 4) GET /api/reservations renvoie display_status/display_color. NE PAS tester envoi message Lodgify ni /channel/sync (données réelles)."

## Iteration 11 — Stripe (paiement + caution), Analytics revenus/occupation, Commissions, finance manuelle
backend:
  - task: "Commissions configurables (preferences.commission_rates) + PATCH commission réservation"
    implemented: true
    working: true
    file: "backend/server.py"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "GET/PUT /api/preferences étendu avec commission_rates (défauts Airbnb 15.5, Booking 15, Vrbo 8). PUT partiel: envoyer commission_rates seul ne réinitialise PAS les statuts. PATCH /api/reservations/{id}/commission {amount} -> finance.commission. Auto-testé curl OK."
  - task: "Stripe checkout (Emergent managed) paiement + caution"
    implemented: true
    working: true
    file: "backend/server.py"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "POST /api/reservations/{id}/checkout {kind:payment|deposit, amount?, origin_url} -> {url, session_id} via emergentintegrations.payments.stripe.checkout. Montant serveur (payment=due, deposit=amount). amount<=0 -> 400. GET /api/checkout/status/{session_id} -> {status, payment_status, kind, amount}; 404 si inconnu; applique le paiement (acompte ou caution) de façon idempotente si payment_status=paid. Auto-testé création session (cs_test_...) OK. NE PAS compléter un vrai paiement carte (non automatisable)."
  - task: "Analytics revenus & occupation par logement/mois"
    implemented: true
    working: true
    file: "backend/server.py"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "GET /api/analytics/revenue?year=YYYY -> {year, properties:[{id,name,monthly:[{month,revenue,nights,occupancy}]x12,total_revenue,avg_occupancy}], totals:{monthly,total_revenue,avg_occupancy}}. Revenu réparti au prorata des nuits par mois; occupation = nuits/jours_du_mois. Auto-testé OK."
  - task: "Finance sur réservations manuelles (create/update)"
    implemented: true
    working: true
    file: "backend/server.py"
    needs_retesting: true
    status_history:
        -working: true
        -agent: "main"
        -comment: "POST /api/reservations initialise finance={total,paid:0,due:total,currency:EUR} + payments:[]. PUT /api/reservations (source!=lodgify) resynchronise finance.total depuis total_price et recalcule due."

agent_communication:
    -agent: "main"
    -message: "Iteration 11. Tester UNIQUEMENT le backend (frontend = Google OAuth non automatisable). Auth: insérer users + user_sessions (user_id de TEST isolé ex test_iter11) dans Mongo, header Authorization: Bearer <token>. À TESTER: 1) POST /api/reservations (manuelle) -> finance présente (total=due=total_price, paid=0). PUT en changeant total_price -> finance.total et due mis à jour. 2) PATCH /api/reservations/{id}/commission {amount:50} -> finance.commission=50. 3) GET/PUT /api/preferences avec commission_rates (PUT partiel commission_rates ne doit pas effacer statuses). 4) POST /api/reservations/{id}/checkout kind=payment (sans amount -> prend finance.due) et kind=deposit {amount:300, origin_url:'https://x'} -> renvoie url+session_id; amount invalide (deposit amount 0) -> 400. GET /api/checkout/status/{session_id} -> renvoie payment_status (unpaid/open attendu car pas de vrai paiement); session_id inconnu -> 404. NE PAS compléter un paiement carte réel. 5) GET /api/analytics/revenue?year=2026 avec 1 logement + 2 réservations -> structure properties/totals correcte, revenu réparti par mois. NE PAS tester /channel/sync ni l'envoi de messages Lodgify (données réelles)."

## Iteration 12 — Module Utilisateurs (rôles & autorisations granulaires)
backend:
  - task: "Members (utilisateurs) CRUD"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Nouvelle collection members. GET /api/members (tri first_name), POST /api/members (MemberIn: first_name,last_name,email,phone,language,role,permissions[],active), GET /api/members/{id} (404 si absent), PUT /api/members/{id} (404 si absent), DELETE /api/members/{id}. Isolé par user_id. À tester en backend uniquement."

frontend:
  - task: "Module Utilisateurs UI (liste + formulaire rôles/autorisations)"
    implemented: true
    working: "NA"
    file: "frontend/app/settings/members.tsx, member-form.tsx, src/permissions.ts, src/components/Picker.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Écran Utilisateurs (liste + FAB), formulaire avec 3 encarts (Coordonnées, Infos complémentaires avec langue, Rôle+autorisations). Rôle applique des autorisations par défaut. Cases à cocher: 15 autorisations générales + 28 PM Modules. Non testable auto (Google OAuth)."

agent_communication:
    -agent: "main"
    -message: "Iteration 12. Tester UNIQUEMENT le backend: nouveau CRUD /api/members. Auth: insérer users + user_sessions (user_id de TEST isolé ex test_iter12) dans Mongo, header Authorization: Bearer <token>. TESTS: 1) POST /api/members {first_name:'Marie', last_name:'Dupont', email:'m@x.com', role:'manager', language:'fr', permissions:['edit_property','view_guest_name'], active:true} -> renvoie id, tous les champs. 2) GET /api/members -> liste triée par first_name, contient le membre. 3) GET /api/members/{id} -> le membre; id inconnu -> 404. 4) PUT /api/members/{id} {...modifié role:'admin'} -> mis à jour; id inconnu -> 404. 5) DELETE /api/members/{id} -> {ok:true}, puis GET liste ne le contient plus. 6) Isolation: un membre créé par user A ne doit pas apparaître pour user B. NE PAS tester le frontend."

## Iteration 14 — Assistant IA: brouillons à valider + notifications, refonte helpers.py
backend:
  - task: "Notifications (brouillons IA à valider)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "GET /api/notifications et GET /api/notifications/count listent/comptent les conversations avec ai_draft présent et ai_draft_validated != true, scopées par user_id + _prop_scope. _can_inbox gate (rôles cleaning/intervenant/owner -> count 0). POST /api/inbox/{thread}/reply pose ai_draft_validated=true et $unset ai_draft/ai_draft_msg_id/ai_draft_at."
  - task: "Génération de brouillon IA (inbox thread + generate-draft)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "GET /api/inbox/{thread} génère un brouillon (Claude Sonnet 4.6) si le dernier message vient du voyageur et le stocke sur la conversation (ai_draft). POST /api/inbox/{thread}/generate-draft régénère. Boucle de fond _ai_draft_loop (30 min) pré-génère pour les conversations non lues. DÉPEND de Lodgify (compte réel) — NON testable sans clé Lodgify réelle. Ne PAS déclencher d'envoi réel."
  - task: "Refactor helpers.py (extraction fonctions pures)"
    implemented: true
    working: true
    file: "backend/helpers.py, backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: true
        -agent: "main"
        -comment: "Fonctions pures + constantes extraites dans helpers.py (crypto, statuts/paiements/commissions defaults, compute_display, recompute_payment, marker_color_for, parse_ical, _build_ics). server.py les importe. 176/176 pytest verts après extraction."

agent_communication:
    -agent: "main"
    -message: "Iteration 14. Tester UNIQUEMENT le backend. Auth owner: insérer users + user_sessions (user_id isolé ex test_iter14) dans Mongo, header Bearer. TESTS NOTIFICATIONS (sans Lodgify): 1) Insérer 2 conversations pour l'owner: convA {thread_uid:'ta', guest_name:'Alice', property_name:'Villa A', source:'Airbnb', ai_draft:'Bonjour Alice...', ai_draft_validated:false, ai_draft_at:'2026-06-01T00:00:00'} et convB {thread_uid:'tb', ..., ai_draft_validated:true} (déjà validé). GET /api/notifications -> count=1, items ne contient QUE convA. GET /api/notifications/count -> {count:1}. 2) Créer un member role='cleaning' + session membre kind:member -> GET /api/notifications -> {count:0, items:[]} (gate _can_inbox). 3) Isolation: une conversation d'un autre user ne doit pas apparaître. NE PAS tester GET /api/inbox/{thread}, POST generate-draft ni reply (dépendent d'une connexion Lodgify réelle et pourraient envoyer un vrai message). NE PAS toucher au vrai compte connecté. Nettoyer les données de test insérées. Le refactor helpers.py est déjà validé par les 176 pytest — vérifier juste qu'aucun endpoint existant clé (GET /properties, /reservations, /preferences, /dashboard) ne régresse pour l'owner de test."

## Iteration 13 — Accès logements membre + Invitation email + Auth mot de passe
backend:
  - task: "Member property access + data scoping"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "MemberIn.property_ids[]. get_current_user gère les sessions kind:member (user_id=owner, allowed_property_ids). _prop_scope applique le filtre sur /properties, /properties/{id}, /reservations, /interventions, /dashboard, /analytics/revenue, /inbox. Owner voit tout, membre voit uniquement ses property_ids."
  - task: "Invite email (Emergent Resend) + password auth"
    implemented: true
    working: "NA"
    file: "backend/server.py, backend/emailer.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "POST /api/members/{id}/invite {origin_url} -> token usage unique (sha256, 7j) + email HTML via Emergent Resend. POST /api/auth/accept-invite {token,password>=8} -> password_hash (argon2/pwdlib), invite_status=active, renvoie session_token+user. POST /api/auth/login {email,password} -> session membre. Auto-testé: invite ok (delivered@resend.dev), accept-invite (pw court->422, valide->session), login (mauvais pw->401, correct->session), filtrage membre (voit 1 logement sur 2)."

frontend:
  - task: "Member form property multi-select + invite button; login email/pw; accept-invite screen"
    implemented: true
    working: "NA"
    file: "frontend/app/settings/member-form.tsx, login.tsx, accept-invite.tsx, src/components/MultiPicker.tsx, src/context/AuthContext.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Section Accès aux logements (MultiPicker cases à cocher), bouton Envoyer l'invitation + badges. Login étendu email+mot de passe. Écran /accept-invite (création mot de passe). Vérifié via screenshots. Non testable auto e2e (Google OAuth pour owner)."

agent_communication:
    -agent: "main"
    -message: "Iteration 20 (backend uniquement). Auth: se connecter en membre admin via POST /api/auth/login {email:'qa.admin@casaneo.test', password:'CasaneoQA2026!'} -> session_token; header Authorization: Bearer <token>. Cet admin a accès complet (24 logements, write autorisé). Backend base localhost:8001. TESTS À FAIRE (NOUVELLES FONCTIONS): \n1) GET /api/owner-statement?month=2026-07 -> statements[] avec period_key='2026-07', period_label, last_sent_at (peut être null). \n2) GET /api/owner-statement?start=2026-06-01&end=2026-08-31 -> period_key='2026-06-01_2026-08-31', period_label '01/06/2026 → 31/08/2026', réservations agrégées sur le trimestre. Dates invalides -> 400 ; end<start -> 400. \n3) GET /api/owner-statement/pending-send (sans param -> mois écoulé) -> {month, period_label, count, pending:[{property_name, owner_name, has_owner_email, owner_revenue}]}. \n4) Rooms CRUD: prendre un property_id via GET /api/properties. POST /api/properties/{pid}/rooms {name:'Chambre test', max_guests:4} -> 200 id. GET /api/properties/{pid}/rooms -> liste. PUT /api/rooms/{id} {name:'X', max_guests:2, count_of_rooms:1}. DELETE /api/rooms/{id} -> ok. \n5) RatePlans CRUD: POST /api/properties/{pid}/rate-plans {name:'Flex', base_price:120, min_stay:2}. PUT /api/rate-plans/{id}. DELETE. \n6) Availability: créer une room, POST /api/rooms/{id}/availability {date_from:'2026-07-01', date_to:'2026-07-05', is_available:true, min_stay:2} -> {days:5}. GET /api/rooms/{id}/availability?start=2026-07-01&end=2026-07-31 -> 5 docs. (nettoyer en supprimant la room). \n7) Channex: GET /api/channex/status -> connected true (staging, 0 logements) [déjà connecté]. GET /api/channex/properties -> {count:0, properties:[]}. POST /api/channex/import -> {imported_properties:0,...} (compte vide). GET /api/channex/sync-logs -> liste d'événements. \nIMPORTANT — NE PAS APPELER /api/owner-statement/email NI /api/owner-statement/email-all (ces endpoints envoient de VRAIS emails à de vrais propriétaires; déjà validés en mock). Ne pas tester Google OAuth. Ne pas modifier les .env."

backend_iteration_20:
  - task: "Relevé période (mois/trimestre/plage) + pending-send"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    priority: "high"
    needs_retesting: true
  - task: "Rooms / RatePlans / Availability CRUD (modèle aligné Channex)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    priority: "high"
    needs_retesting: true
  - task: "Channex foundation (connect/status/properties/import/sync-logs)"
    implemented: true
    working: "NA"
    file: "backend/server.py, backend/channex.py"
    priority: "medium"
    needs_retesting: true

previous_agent_communication:
    -agent: "main"
    -message: "Iteration 13 (voir historique ci-dessus)."
