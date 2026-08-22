# Sign in with Apple — Testing

## Config
- Bundle id: `com.emergent.rentalhubmanager.p4jvi7`
- Backend `.env`: `APPLE_AUDIENCES="com.emergent.rentalhubmanager.p4jvi7,host.exp.Exponent"`
- `app.json`: `expo.ios.usesAppleSignIn = true`
- Endpoint: `POST /api/auth/apple` { identity_token, name, email } -> { session_token, user }
- Frontend: `AppleAuthenticationButton` on the login screen, iOS-only (`isAvailableAsync`).

## Manual (button) — real device only
- Apple Sign-In works ONLY on a real iOS device (Expo Go iOS via `host.exp.Exponent`,
  or a standalone build with the bundle id). It does NOT work on web, Android, or iOS simulator.
- Tap the Apple button -> Apple sheet -> returns identity token -> `/api/auth/apple` -> session.

## Backend (automated)
1. Invalid token -> `POST /api/auth/apple {identity_token:"x.y.z"}` returns 401. (verified)
2. Seed a user + session in Mongo, hit `GET /api/auth/me` with Bearer -> user data.
3. A real identity token whose `aud` is not in APPLE_AUDIENCES must 401.

## Notes
- Users keyed on `apple_sub` (linked to existing email account if same email).
- Name/email only provided by Apple on first sign-in — persisted immediately, never overwritten with nulls.
