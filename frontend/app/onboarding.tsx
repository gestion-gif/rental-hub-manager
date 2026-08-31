import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [propCount, setPropCount] = useState(0);
  const [channexOk, setChannexOk] = useState(false);

  const load = useCallback(async () => {
    try {
      const [props, cx] = await Promise.all([
        api.get("/properties"),
        api.get("/channex/status").catch(() => ({ connected: false })),
      ]);
      setPropCount(Array.isArray(props) ? props.length : 0);
      setChannexOk(!!(cx?.connected || cx?.api_key_set));
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const steps = [
    {
      key: "property", done: propCount > 0, icon: "business-outline",
      title: "Créer votre premier logement",
      sub: propCount > 0 ? `${propCount} logement${propCount > 1 ? "s" : ""} créé${propCount > 1 ? "s" : ""} ✓` : "Nom, adresse, capacité, tarif de base — 2 minutes",
      action: () => router.push("/property-form"),
    },
    {
      key: "channex", done: channexOk, icon: "sync-outline",
      title: "Connecter Booking.com & Airbnb",
      sub: channexOk ? "Channex connecté ✓" : "Via Channex : synchronisation des réservations et calendriers",
      action: () => router.push("/channel-manager"),
    },
    {
      key: "team", done: false, icon: "people-outline",
      title: "Inviter votre équipe (optionnel)",
      sub: "Ménage, intervenants, co-gestionnaires — avec rôles et permissions",
      action: () => router.push("/settings/members"),
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + 60 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.hello}>Bienvenue{user?.name ? `, ${user.name}` : ""} 👋</Text>
        <Text style={styles.title}>Bien démarrer avec Casanéo</Text>
        <Text style={styles.sub}>3 étapes pour être opérationnel. Votre essai gratuit de 14 jours est lancé.</Text>

        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${Math.max(8, (doneCount / steps.length) * 100)}%` }]} />
        </View>
        <Text style={styles.progressText}>{doneCount}/{steps.length} étapes terminées</Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.brandPrimary} />
        ) : steps.map((s, i) => (
          <Pressable key={s.key} testID={`onboarding-step-${s.key}`} onPress={s.action} style={[styles.step, s.done && styles.stepDone]}>
            <View style={[styles.stepIcon, s.done && { backgroundColor: colors.success }]}>
              <Ionicons name={s.done ? "checkmark" : (s.icon as any)} size={20} color={s.done ? "#fff" : colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{i + 1}. {s.title}</Text>
              <Text style={styles.stepSub}>{s.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </Pressable>
        ))}

        <Pressable testID="onboarding-done" onPress={() => router.replace("/")} style={styles.cta}>
          <Text style={styles.ctaText}>{doneCount >= 2 ? "C'est parti !" : "Accéder au tableau de bord"}</Text>
        </Pressable>
        <Pressable testID="onboarding-skip" onPress={() => router.replace("/")} style={{ alignItems: "center", marginTop: spacing.sm, padding: 8 }}>
          <Text style={styles.skip}>Passer, je le ferai plus tard</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  hello: { fontFamily: font.medium, fontSize: fontSize.lg, color: colors.onSurfaceSecondary },
  title: { fontFamily: font.bold, fontSize: 26, color: colors.onSurface, marginTop: 4 },
  sub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 6, lineHeight: 20 },
  progress: { height: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 4, marginTop: spacing.lg, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: colors.brandPrimary, borderRadius: 4 },
  progressText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 6, marginBottom: spacing.lg },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  stepDone: { borderColor: colors.success + "66", backgroundColor: colors.success + "0A" },
  stepIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandPrimary + "14", alignItems: "center", justifyContent: "center" },
  stepTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  stepSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2, lineHeight: 17 },
  cta: { backgroundColor: colors.brandPrimary, borderRadius: radius.lg, paddingVertical: 15, alignItems: "center", marginTop: spacing.lg },
  ctaText: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onBrandPrimary },
  skip: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textDecorationLine: "underline" },
});
