import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

dayjs.locale("fr");

function euro(n: number) {
  return `${Math.round(n || 0).toLocaleString("fr-FR")} €`;
}

export default function KpiDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [mode, setMode] = useState<"month" | "quarter">("month");
  const [anchor, setAnchor] = useState(dayjs());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let q = "";
      if (mode === "month") {
        q = `month=${anchor.format("YYYY-MM")}`;
      } else {
        const qStart = anchor.startOf("month").subtract((anchor.month()) % 3, "month");
        const qEnd = qStart.add(2, "month").endOf("month");
        q = `start=${qStart.format("YYYY-MM-DD")}&end=${qEnd.format("YYYY-MM-DD")}`;
      }
      setData(await api.get(`/analytics/kpi?${q}`));
    } catch { setData(null); }
    setLoading(false);
  }, [mode, anchor]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function shift(dir: number) {
    setAnchor((a) => a.add(dir * (mode === "quarter" ? 3 : 1), "month"));
  }

  const t = data?.totals || {};

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="kpi-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Tableau de bord</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <View style={styles.modeRow}>
          {(["month", "quarter"] as const).map((m) => (
            <Pressable key={m} testID={`kpi-mode-${m}`} onPress={() => setMode(m)} style={[styles.modeChip, mode === m && styles.modeChipOn]}>
              <Text style={[styles.modeText, mode === m && styles.modeTextOn]}>{m === "month" ? "Mois" : "Trimestre"}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.navRow}>
          <Pressable testID="kpi-prev" onPress={() => shift(-1)} style={styles.navBtn}><Ionicons name="chevron-back" size={20} color={colors.onSurface} /></Pressable>
          <Text style={styles.period}>{data?.period_label || (mode === "month" ? anchor.format("MMMM YYYY") : "…")}</Text>
          <Pressable testID="kpi-next" onPress={() => shift(1)} style={styles.navBtn}><Ionicons name="chevron-forward" size={20} color={colors.onSurface} /></Pressable>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 50 }} color={colors.brandPrimary} />
        ) : !data ? (
          <Text style={styles.empty}>Aucune donnée.</Text>
        ) : (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>Revenu conciergerie</Text>
              <Text style={styles.heroValue}>{euro(t.concierge_revenue)}</Text>
              <View style={styles.heroSub}>
                <Text style={styles.heroSubText}>Occupation {data.occupancy_all}% · {t.reservations} réservation(s)</Text>
              </View>
            </View>

            <View style={styles.grid}>
              <Kpi label="Revenu propriétaires" value={euro(t.owner_revenue)} icon="people-outline" />
              <Kpi label="Frais de gestion" value={euro(t.management_fee)} icon="briefcase-outline" />
              <Kpi label="Ménages (conciergerie)" value={euro(t.cleaning)} icon="sparkles-outline" />
              <Kpi label="Commissions OTA" value={euro(t.commission)} icon="pricetag-outline" />
            </View>

            <Text style={styles.section}>Top logements — revenu conciergerie</Text>
            <View style={styles.card}>
              {(data.top_by_revenue || []).map((p: any, i: number) => (
                <View key={p.id} style={[styles.rankRow, i > 0 && styles.rowBorder]}>
                  <Text style={styles.rank}>{i + 1}</Text>
                  <Text style={styles.rankName} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.rankVal}>{euro(p.concierge_revenue)}</Text>
                </View>
              ))}
              {(data.top_by_revenue || []).length === 0 && <Text style={styles.empty}>Aucune donnée sur la période.</Text>}
            </View>

            <Text style={styles.section}>Top logements — occupation</Text>
            <View style={styles.card}>
              {(data.top_by_occupancy || []).map((p: any, i: number) => (
                <View key={p.id} style={[styles.rankRow, i > 0 && styles.rowBorder]}>
                  <Text style={styles.rank}>{i + 1}</Text>
                  <Text style={styles.rankName} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.rankVal}>{p.occupancy}%</Text>
                </View>
              ))}
              {(data.top_by_occupancy || []).length === 0 && <Text style={styles.empty}>Aucune donnée sur la période.</Text>}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Kpi({ label, value, icon }: any) {
  return (
    <View style={styles.kpiCard}>
      <Ionicons name={icon} size={18} color={colors.brandPrimary} />
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  modeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  modeChip: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  modeChipOn: { backgroundColor: colors.brandPrimary },
  modeText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  modeTextOn: { color: colors.onBrandPrimary },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  period: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, textTransform: "capitalize" },
  heroCard: { backgroundColor: "#2A6F9E", borderRadius: 20, padding: spacing.lg, marginBottom: spacing.md },
  heroLabel: { fontFamily: font.medium, fontSize: fontSize.base, color: "#D6E7F3" },
  heroValue: { fontFamily: font.bold, fontSize: 34, color: "#fff", marginTop: 4 },
  heroSub: { marginTop: 8 },
  heroSubText: { fontFamily: font.regular, fontSize: fontSize.sm, color: "#D6E7F3" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.sm },
  kpiCard: { width: "48.5%", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm, gap: 4 },
  kpiValue: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface, marginTop: 4 },
  kpiLabel: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  section: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  rankRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 10 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rank: { width: 22, height: 22, borderRadius: 11, textAlign: "center", lineHeight: 22, backgroundColor: colors.surfaceSecondary, fontFamily: font.bold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, overflow: "hidden" },
  rankName: { flex: 1, fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
  rankVal: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.brandPrimary },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", paddingVertical: spacing.md },
});
