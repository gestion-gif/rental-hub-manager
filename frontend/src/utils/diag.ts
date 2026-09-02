// Fil d'Ariane de diagnostic : envoie des jalons au backend pour localiser
// les crashs natifs en production (lisible via GET /api/client-errors?key=...).
import { Platform } from "react-native";

export function crumb(context: string, message = "breadcrumb") {
  if (Platform.OS === "web") return;
  try {
    fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, context, fatal: false, platform: Platform.OS }),
      // @ts-ignore — keepalive aide l'envoi même si l'app se ferme juste après
      keepalive: true,
    }).catch(() => {});
  } catch {}
}
