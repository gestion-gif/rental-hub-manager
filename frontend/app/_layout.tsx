import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useFonts } from "expo-font";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/context/AuthContext";
import { PreferencesProvider } from "@/src/context/PreferencesContext";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

// Keep the native splash visible from cold start until icon fonts register.
// Required because @expo/vector-icons' componentDidMount fallback fires
// Font.loadAsync against a broken vendor path if any <Icon> mounts before
// the family is registered — which throws on Android Expo Go.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [iconsLoaded, iconError] = useIconFonts();
  const [fontsLoaded, fontError] = useFonts({
    "Geist-Regular": require("../assets/fonts/Geist-Regular.ttf"),
    "Geist-Medium": require("../assets/fonts/Geist-Medium.ttf"),
    "Geist-SemiBold": require("../assets/fonts/Geist-SemiBold.ttf"),
    "Geist-Bold": require("../assets/fonts/Geist-Bold.ttf"),
  });

  const ready = (iconsLoaded || iconError) && (fontsLoaded || fontError);

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <AuthProvider>
            <PreferencesProvider>
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
              </Stack>
            </PreferencesProvider>
          </AuthProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
