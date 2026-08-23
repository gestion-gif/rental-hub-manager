import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const DAYS = [0, 1, 2, 3];

export default function ReportsSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [monthly, setMonthly] = useState(true);
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [reviewDays, setReviewDays] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api.get("/preferences");
      setMonthly(p.monthly_report_enabled ?? true);
      setReviewEnabled(!!p.review_request_enabled);
      setReviewDays(p.review_request_days ?? 1);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function put(patch: any) {
    try { await api.put("/preferences", patch); } catch {}
  }

  async function sendNow() {
    setSending(true);
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || "";
      const res = await api.post("/reports/monthly-activity/send", { base_url: base });
      if (res.sent) Alert.alert("Envoyé", `Rapport ${res.period_label} envoyé à ${res.to}.`);
      else Alert.alert("Impossible", "Aucune adresse email de gestionnaire trouvée.");
    } catch { Alert.alert("Erreur", "Envoi impossible."); }
    setSending(false);
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <Header insets={insets} onBack={() => router.back()} />
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header insets={insets} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Rapports & avis</Text>
        <Text style={styles.introSub}>Automatisez le récap d'activité mensuel et les demandes d'avis après le départ.</Text>

        <Text style={styles.group}>Rapport d'activité mensuel</Text>
        <View style={styles.card}>
          <View style={styles.optRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.optTitle}>Envoi automatique chaque début de mois</Text>
              <Text style={styles.optSub}>Un récap global (tous logements) du mois écoulé vous est envoyé par email.</Text>
            </View>
            <Switch testID="report-monthly-switch" value={monthly}
              onValueChange={(v) => { setMonthly(v); put({ monthly_report_enabled: v }); }}
              trackColor={{ false: colors.border, true: colors.brandPrimary }} thumbColor="#fff" />
          </View>
          <Pressable testID="report-send-now" onPress={sendNow} disabled={sending} style={[styles.sendBtn, sending && { opacity: 0.6 }]}>
            {sending ? <ActivityIndicator color={colors.brandPrimary} /> : (
              <>
                <Ionicons name="paper-plane-outline" size={16} color={colors.brandPrimary} />
                <Text style={styles.sendText}>Envoyer le rapport maintenant</Text>
              </>
            )}
          </Pressable>
        </View>

        <Text style={styles.group}>Demande d'avis automatique</Text>
        <View style={styles.card}>
          <View style={styles.optRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.optTitle}>Demander un avis après le départ</Text>
              <Text style={styles.optSub}>Un message est envoyé automatiquement au voyageur (via Lodgify) après son séjour.</Text>
            </View>
            <Switch testID="report-review-switch" value={reviewEnabled}
              onValueChange={(v) => { setReviewEnabled(v); put({ review_request_enabled: v }); }}
              trackColor={{ false: colors.border, true: colors.brandPrimary }} thumbColor="#fff" />
          </View>
          {reviewEnabled && (
            <View style={{ marginTop: spacing.md }}>
              <Text style={styles.optSub}>Délai après le départ</Text>
              <View style={styles.chips}>
                {DAYS.map((d) => (
                  <Pressable key={d} testID={`review-days-${d}`} onPress={() => { setReviewDays(d); put({ review_request_days: d }); }}
                    style={[styles.chip, reviewDays === d && styles.chipOn]}>
                    <Text style={[styles.chipText, reviewDays === d && styles.chipTextOn]}>{d === 0 ? "Le jour même" : `J+${d}`}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
        <Text style={styles.note}>Les avis reçus se suivent dans l'écran « Avis voyageurs » (menu). Vous pouvez aussi y saisir manuellement une note.</Text>
      </ScrollView>
    </View>
  );
}

function Header({ insets, onBack }: any) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="reports-back" onPress={onBack} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title}>Rapports & avis</Text>
      <View style={{ width: 34 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  intro: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  introSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: spacing.md, lineHeight: 20 },
  group: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  optRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  optTitle: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  optSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2, lineHeight: 18 },
  sendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sendText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.brandPrimary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  chipOn: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  chipTextOn: { color: colors.onBrandPrimary },
  note: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: spacing.md, lineHeight: 18 },
});
