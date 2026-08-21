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
