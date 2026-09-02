import { useEffect, useRef } from "react";
import { Platform, AppState, AppStateStatus } from "react-native";
import * as Notifications from "expo-notifications";

import { useAuth } from "@/src/context/AuthContext";
import { crumb } from "@/src/utils/diag";

async function registerForPush(userId: string) {
  if (Platform.OS === "web" || !userId) return;
  try {
    crumb("push:request-perm");
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") {
      crumb("push:perm-denied");
      return;
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
  }
}

/** Registers the device push token whenever a user is logged in and on app foreground. */
export default function PushRegistrar() {
  const { user } = useAuth();
  const uid = user?.user_id;
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    if (Platform.OS === "web" || !uid) return;
    registerForPush(uid);
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        registerForPush(uid);
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [uid]);

  return null;
}
