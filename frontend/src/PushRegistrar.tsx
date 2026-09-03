import { useEffect, useRef } from "react";
import { Platform, AppState, AppStateStatus } from "react-native";
import * as Notifications from "expo-notifications";

import { useAuth } from "@/src/context/AuthContext";
import { crumb } from "@/src/utils/diag";

let askedThisSession = false;
let registering = false;

async function registerForPush(userId: string, { allowPrompt }: { allowPrompt: boolean }) {
  if (Platform.OS === "web" || !userId || registering) return;
  registering = true;
  try {
    // 1. Vérifie l'état actuel SANS déclencher de popup
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) {
      // 2. Ne demande qu'UNE SEULE fois par session, et jamais depuis un retour au premier plan
      //    (la popup elle-même fait passer l'app en arrière-plan → sinon boucle infinie)
      if (!allowPrompt || askedThisSession || !perm.canAskAgain) return;
      askedThisSession = true;
      crumb("push:request-perm");
      perm = await Notifications.requestPermissionsAsync();
      if (!perm.granted) {
        crumb("push:perm-denied");
        return;
      }
    }
    const tok = await Notifications.getDevicePushTokenAsync();
    crumb("push:token-ok");
    await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/register-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, platform: Platform.OS, device_token: tok.data }),
    });
  } catch {
    crumb("push:error");
    // Non-blocking: push registration must never break the app.
  } finally {
    registering = false;
  }
}

/** Registers the device push token whenever a user is logged in and on app foreground. */
export default function PushRegistrar() {
  const { user } = useAuth();
  const uid = user?.user_id;
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    if (Platform.OS === "web" || !uid) return;
    registerForPush(uid, { allowPrompt: true });
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        // Au retour au premier plan : rafraîchit le token UNIQUEMENT si déjà autorisé (pas de popup)
        registerForPush(uid, { allowPrompt: false });
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [uid]);

  return null;
}
