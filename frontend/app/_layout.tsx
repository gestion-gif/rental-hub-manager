import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { LogBox, Platform, View, Text, Pressable } from "react-native";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useFonts } from "expo-font";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/context/AuthContext";
import { PreferencesProvider } from "@/src/context/PreferencesContext";
import PushRegistrar from "@/src/PushRegistrar";
import { initTheme } from "@/src/theme";
import { initI18n } from "@/src/i18n";
import { installI18nPatch } from "@/src/i18n/patch";

// Traduction automatique des textes (FR → EN) selon la langue choisie
installI18nPatch();

// --- Rapporteur de crash : envoie toute erreur JS fatale au backend (diagnostic production) ---
if (Platform.OS !== "web") {
  const eu = (global as any).ErrorUtils;
  if (eu?.setGlobalHandler) {
    const defaultHandler = eu.getGlobalHandler?.();
    eu.setGlobalHandler((error: any, isFatal?: boolean) => {
      try {
        fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/client-errors`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: String(error?.message || error).slice(0, 500),
            stack: String(error?.stack || "").slice(0, 4000),
            fatal: !!isFatal,
            platform: Platform.OS,
            context: "global-handler",
          }),
          // @ts-ignore
          keepalive: true,
        }).catch(() => {});
      } catch {}
      if (isFatal) {
        // Laisse 2 s au rapport d'erreur pour partir avant que l'app ne se ferme
        setTimeout(() => {
          if (defaultHandler) defaultHandler(error, isFatal);
        }, 2000);
      } else if (defaultHandler) {
        defaultHandler(error, isFatal);
      }
    });
  }
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: "#020830", alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Text style={{ color: "#fff", fontSize: 22, fontWeight: "700", textAlign: "center" }}>Oups, une erreur est survenue</Text>
          <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 15, textAlign: "center", marginTop: 10 }}>
            Réessayez — si le problème persiste, contactez le support (gestion@mhpimmo.fr).
          </Text>
          <Pressable
            onPress={() => this.setState({ error: null })}
            style={{ backgroundColor: "#fff", borderRadius: 14, paddingVertical: 13, paddingHorizontal: 28, marginTop: 24 }}
          >
            <Text style={{ color: "#020830", fontSize: 16, fontWeight: "700" }}>Réessayer</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

// Push: foreground display behaviour (module scope, before any component)
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// Push: Android channel (module scope)
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
  });
}

// Keep the native splash visible from cold start until icon fonts register.
// Required because @expo/vector-icons' componentDidMount fallback fires
// Font.loadAsync against a broken vendor path if any <Icon> mounts before
// the family is registered — which throws on Android Expo Go.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const [iconsLoaded, iconError] = useIconFonts();
  const [fontsLoaded, fontError] = useFonts({
    "Geist-Regular": require("../assets/fonts/Geist-Regular.ttf"),
    "Geist-Medium": require("../assets/fonts/Geist-Medium.ttf"),
    "Geist-SemiBold": require("../assets/fonts/Geist-SemiBold.ttf"),
    "Geist-Bold": require("../assets/fonts/Geist-Bold.ttf"),
  });

  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => { initTheme().finally(() => setThemeReady(true)); }, []);
  const [i18nReady, setI18nReady] = useState(false);
  useEffect(() => { initI18n().finally(() => setI18nReady(true)); }, []);

  const ready = (iconsLoaded || iconError) && (fontsLoaded || fontError) && themeReady && i18nReady;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  // Push: notification tap routing + denied-permission nudge
  useEffect(() => {
    if (Platform.OS === "web") return;
    const openFrom = (resp: any) => {
      const data = resp?.notification?.request?.content?.data || {};
      const url = data.deeplink || data.action_url;
      if (!url) return;
      url.startsWith("http") ? Linking.openURL(url) : router.push(url);
    };
    const tapSub = Notifications.addNotificationResponseReceivedListener(openFrom);
    Notifications.getLastNotificationResponseAsync().then((resp) => { if (resp) openFrom(resp); });

    (async () => {
      const { status, canAskAgain } = await Notifications.getPermissionsAsync();
      if (status !== "denied" || canAskAgain) return;
      const lastNudge = await AsyncStorage.getItem("pushNudgeAt");
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      if (lastNudge && Date.now() - Number(lastNudge) <= oneWeek) return;
      await AsyncStorage.setItem("pushNudgeAt", String(Date.now()));
      Linking.openSettings();
    })();

    return () => { tapSub.remove(); };
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <RootErrorBoundary>
      <SafeAreaProvider>
        <KeyboardProvider>
          <AuthProvider>
            <PreferencesProvider>
              <PushRegistrar />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="login" />
                <Stack.Screen name="accept-invite" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="property-form"
                  options={{ presentation: "modal" }}
                />
                <Stack.Screen
                  name="reservation-form"
                  options={{ presentation: "modal" }}
                />
                <Stack.Screen
                  name="intervention-form"
                  options={{ presentation: "modal" }}
                />
                <Stack.Screen
                  name="accounting-form"
                  options={{ presentation: "modal" }}
                />
                <Stack.Screen
                  name="accounting-recurring-form"
                  options={{ presentation: "modal" }}
                />
                <Stack.Screen
                  name="settings/status-colors"
                  options={{ presentation: "modal" }}
                />
                <Stack.Screen name="settings/index" />
                <Stack.Screen name="settings/members" />
                <Stack.Screen name="settings/member-form" />
                <Stack.Screen name="settings/staff" />
                <Stack.Screen name="settings/owners" />
                <Stack.Screen name="settings/owner/[id]" />
                <Stack.Screen name="settings/messages" />
                <Stack.Screen name="settings/api-key" />
                <Stack.Screen name="settings/payments" />
                <Stack.Screen name="settings/ical" />
                <Stack.Screen name="property/[id]" />
                <Stack.Screen name="channel-manager" />
                <Stack.Screen name="rooms" />
                <Stack.Screen name="room-availability" />
                <Stack.Screen name="cleaning" />
                <Stack.Screen name="inbox" />
                <Stack.Screen name="inbox/[thread]" />
                <Stack.Screen name="help" />
              </Stack>
            </PreferencesProvider>
          </AuthProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
      </RootErrorBoundary>
    </GestureHandlerRootView>
  );
}
