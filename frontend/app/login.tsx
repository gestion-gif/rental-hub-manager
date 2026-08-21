import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { AntDesign } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { useAuth } from "@/src/context/AuthContext";
import { PrimaryButton } from "@/src/components/ui";
import { colors, font, fontSize, spacing, HERO_IMAGE } from "@/src/theme";

export default function Login() {
  const { signIn, signingIn, user } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  useEffect(() => {
    if (user) router.replace("/(tabs)");
  }, [user]);

  return (
    <View style={styles.container} testID="login-screen">
      <StatusBar style="light" />
      <Image source={{ uri: HERO_IMAGE }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={["transparent", "rgba(28,28,30,0.4)", "rgba(28,28,30,0.96)"]}
        locations={[0, 0.45, 0.85]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.brandRow}>
          <View style={styles.logoBox}>
            <AntDesign name="home" size={22} color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.brandName}>StayPilot</Text>
        </View>
        <Text style={styles.title}>Gérez vos locations{"\n"}saisonnières sans effort</Text>
        <Text style={styles.subtitle}>
          Réservations, calendrier, tarifs par saison et assistant IA — tout au même endroit.
        </Text>
        <PrimaryButton
          testID="google-signin-button"
          label="Continuer avec Google"
          onPress={signIn}
          loading={signingIn}
          variant="secondary"
          style={{ backgroundColor: colors.surface }}
          icon={<AntDesign name="google" size={18} color={colors.onSurface} />}
        />
        <Text style={styles.legal}>
          En continuant, vous acceptez nos conditions d'utilisation.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceInverse },
  content: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.xl,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg },
  logoBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: { color: colors.onSurfaceInverse, fontFamily: font.bold, fontSize: fontSize.xl },
  title: {
    color: colors.onSurfaceInverse,
    fontFamily: font.bold,
    fontSize: 30,
    lineHeight: 38,
    marginBottom: spacing.md,
  },
  subtitle: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: font.regular,
    fontSize: fontSize.lg,
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
  legal: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: font.regular,
    fontSize: fontSize.sm,
    textAlign: "center",
    marginTop: spacing.lg,
  },
});
