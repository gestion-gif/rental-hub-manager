import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert, Platform } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import dayjs from "dayjs";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

function originUrl() {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return process.env.EXPO_PUBLIC_BACKEND_URL || "";
}

async function openUrl(url: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") window.location.assign(url);
  else await WebBrowser.openBrowserAsync(url);
}

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [status, setStatus] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.get("/billing/status"), api.get("/billing/plans")]);
      setStatus(s);
      setPlans(p.plans || []);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function subscribe(planId: string) {
    setBusyPlan(planId);
    try {
      const r = await api.post("/billing/checkout", { plan: planId, origin_url: originUrl() });
      if (r.checkout_url) await openUrl(r.checkout_url);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Impossible d'ouvrir le paiement.");
    }
    setBusyPlan(null);
  }

  async function managePortal() {
    try {
      const r = await api.post("/billing/portal", { origin_url: originUrl() });
      if (r.url) await openUrl(r.url);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Portail indisponible.");
    }
  }

  const st = status?.status;
  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="sub-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Abonnement</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
          <View style={[styles.statusCard, st === "locked" && { borderColor: colors.error }]}>
            {st === "exempt" && (<>
              <Text style={styles.statusTitle}>✨ Compte fondateur</Text>
              <Text style={styles.statusSub}>Accès illimité, sans abonnement.</Text>
            </>)}
            {st === "trial" && (<>
              <Text style={styles.statusTitle}>🎁 Essai gratuit en cours</Text>
              <Text style={styles.statusSub}>
                {status.trial_days_left} jour{status.trial_days_left > 1 ? "s" : ""} restant{status.trial_days_left > 1 ? "s" : ""} (jusqu’au {dayjs(status.trial_ends_at).format("DD/MM/YYYY")}). Choisissez une formule pour continuer ensuite.
              </Text>
            </>)}
            {st === "active" && (<>
              <Text style={styles.statusTitle}>✅ Formule {status.plan_label}</Text>
              <Text style={styles.statusSub}>
                {status.property_count}/{status.property_limit} logements utilisés
              </Text>
              <Pressable testID="sub-portal" onPress={managePortal} style={styles.portalBtn}>
                <Ionicons name="settings-outline" size={15} color={colors.brandPrimary} />
                <Text style={styles.portalText}>Gérer / factures / résilier</Text>
              </Pressable>
            </>)}
            {st === "locked" && (<>
              <Text style={[styles.statusTitle, { color: colors.error }]}>⏳ Essai terminé</Text>
              <Text style={styles.statusSub}>Choisissez une formule pour réactiver votre compte — vos données sont conservées.</Text>
            </>)}
          </View>

          {st !== "exempt" && (Platform.OS === "ios" ? (
            <View style={styles.iosNotice}>
              <Ionicons name="globe-outline" size={18} color={colors.onSurfaceSecondary} />
              <Text style={styles.iosNoticeText}>
                La souscription et la gestion de l’abonnement s’effectuent depuis la version web de Casanéo.
              </Text>
            </View>
          ) : (<>
            <Text style={styles.section}>Formules (mensuel, sans engagement)</Text>
            {plans.map((p) => {
              const current = status?.plan === p.id && st === "active";
              return (
                <View key={p.id} style={[styles.planCard, p.id === "essentiel" && styles.planStar, current && { borderColor: colors.success }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planName}>{p.label}{p.id === "essentiel" ? "  ⭐" : ""}</Text>
                    <Text style={styles.planLimit}>Jusqu’à {p.property_limit} logements</Text>
                  </View>
                  <Text style={styles.planPrice}>{p.price_eur} €<Text style={styles.planMo}>/mois</Text></Text>
                  {current ? (
                    <View style={styles.currentTag}><Text style={styles.currentText}>Actif</Text></View>
                  ) : (
                    <Pressable testID={`sub-plan-${p.id}`} onPress={() => subscribe(p.id)} disabled={!!busyPlan} style={styles.subBtn}>
                      {busyPlan === p.id ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.subText}>Choisir</Text>}
                    </Pressable>
                  )}
                </View>
              );
            })}
            <Text style={styles.hint}>Paiement sécurisé par Stripe. Gérez ou résiliez à tout moment depuis « Gérer ». Prix HT.</Text>
          </>))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  statusCard: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.brandPrimary + "44", borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  statusTitle: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  statusSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginTop: 4, lineHeight: 20 },
  portalBtn: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, marginTop: spacing.md, paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brandPrimary + "14" },
  portalText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary },
  section: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm },
  planCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  planStar: { borderColor: colors.brandPrimary, borderWidth: 1.5 },
  planName: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  planLimit: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  planPrice: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  planMo: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  subBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingVertical: 9, paddingHorizontal: spacing.lg, minWidth: 78, alignItems: "center" },
  subText: { fontFamily: font.bold, fontSize: fontSize.sm, color: colors.onBrandPrimary },
  currentTag: { backgroundColor: colors.success + "22", borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: spacing.md },
  currentText: { fontFamily: font.bold, fontSize: fontSize.sm, color: colors.success },
  hint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: spacing.sm, lineHeight: 18 },
  iosNotice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md },
  iosNoticeText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 20 },
});
