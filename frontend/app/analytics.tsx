import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { PropertyPicker } from "@/src/components/PropertyPicker";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Aoû", "Sep", "Oct", "Nov", "Déc"];

export default function Analytics() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [metric, setMetric] = useState<"revenue" | "occupancy">("revenue");
  const [selectedProp, setSelectedProp] = useState("all");
  const [data, setData] = useState<any>(null);
  const [prevData, setPrevData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, prev] = await Promise.all([
        api.get(`/analytics/revenue?year=${year}`),
        api.get(`/analytics/revenue?year=${year - 1}`),
      ]);
      setData(res);
      setPrevData(prev);
    } catch {}
    setLoading(false);
  }, [year]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const current = useMemo(() => {
    if (!data) return null;
    if (selectedProp === "all") {
      return { monthly: data.totals.monthly, total_revenue: data.totals.total_revenue, avg_occupancy: data.totals.avg_occupancy };
    }
    const p = data.properties.find((x: any) => x.id === selectedProp);
    return p ? { monthly: p.monthly, total_revenue: p.total_revenue, avg_occupancy: p.avg_occupancy } : null;
  }, [data, selectedProp]);

  const previous = useMemo(() => {
    if (!prevData) return null;
    if (selectedProp === "all") {
      return { monthly: prevData.totals.monthly, total_revenue: prevData.totals.total_revenue, avg_occupancy: prevData.totals.avg_occupancy };
    }
    const p = prevData.properties.find((x: any) => x.id === selectedProp);
    return p ? { monthly: p.monthly, total_revenue: p.total_revenue, avg_occupancy: p.avg_occupancy } : null;
  }, [prevData, selectedProp]);

  const revDelta = useMemo(() => {
    const prev = previous?.total_revenue || 0;
    const cur = current?.total_revenue || 0;
    if (prev <= 0) return null;
    return Math.round(((cur - prev) / prev) * 100);
  }, [current, previous]);
  const occDelta = useMemo(() => {
    if (!previous || !current) return null;
    if (!previous.avg_occupancy && !previous.total_revenue) return null;
    return Math.round((current.avg_occupancy || 0) - (previous.avg_occupancy || 0));
  }, [current, previous]);

  const values: number[] = current ? current.monthly.map((m: any) => (metric === "revenue" ? m.revenue : m.occupancy)) : [];
  const prevValues: number[] = previous ? previous.monthly.map((m: any) => (metric === "revenue" ? m.revenue : m.occupancy)) : [];
  const maxVal = Math.max(1, ...values, ...prevValues);
  const suffix = metric === "revenue" ? "€" : "%";

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="analytics-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Statistiques</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
        {/* Année */}
        <View style={styles.yearNav}>
          <Pressable testID="prev-year" onPress={() => setYear((y) => y - 1)} style={styles.navBtn}>
            <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.yearLabel}>{year}</Text>
          <Pressable testID="next-year" onPress={() => setYear((y) => y + 1)} style={styles.navBtn}>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
          </Pressable>
        </View>

        {/* Métrique */}
        <View style={styles.segment}>
          {(["revenue", "occupancy"] as const).map((m) => (
            <Pressable key={m} testID={`metric-${m}`} onPress={() => setMetric(m)} style={[styles.segBtn, metric === m && styles.segBtnActive]}>
              <Ionicons name={m === "revenue" ? "cash-outline" : "bar-chart-outline"} size={15} color={metric === m ? colors.onSurface : colors.onSurfaceTertiary} />
              <Text style={[styles.segText, metric === m && styles.segTextActive]}>{m === "revenue" ? "Revenus" : "Occupation"}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
        ) : !data || data.properties.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="bar-chart-outline" size={40} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyText}>Aucune donnée</Text>
            <Text style={styles.emptySub}>Ajoutez des logements et des réservations.</Text>
          </View>
        ) : (
          <>
            {/* Filtre logement */}
            <View style={styles.pickerWrap}>
              <PropertyPicker value={selectedProp} items={data.properties} onSelect={setSelectedProp} testID="analytics-prop-picker" />
            </View>

            {/* Résumé */}
            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Revenus {year}</Text>
                <Text style={styles.summaryVal}>{current?.total_revenue?.toLocaleString("fr-FR")} €</Text>
                {revDelta !== null && (
                  <Text style={[styles.deltaText, { color: revDelta >= 0 ? "#2FB350" : "#E5484D" }]} testID="rev-delta">
                    {revDelta >= 0 ? "▲" : "▼"} {Math.abs(revDelta)}% vs {year - 1}
                  </Text>
                )}
                {revDelta === null && previous !== null && (
                  <Text style={styles.deltaMuted}>Pas de données {year - 1}</Text>
                )}
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>Occupation moy.</Text>
                <Text style={styles.summaryVal}>{current?.avg_occupancy}%</Text>
                {occDelta !== null && (
                  <Text style={[styles.deltaText, { color: occDelta >= 0 ? "#2FB350" : "#E5484D" }]}>
                    {occDelta >= 0 ? "▲" : "▼"} {Math.abs(occDelta)} pts vs {year - 1}
                  </Text>
                )}
              </View>
            </View>

            {/* Graphe barres */}
            <View style={styles.chartCard}>
              <Text style={styles.chartTitle}>{metric === "revenue" ? "Revenus par mois" : "Taux d'occupation par mois"}</Text>
              <View style={styles.chart}>
                {current?.monthly.map((m: any, i: number) => {
                  const v = values[i];
                  const pv = prevValues[i] || 0;
                  const h = Math.round((v / maxVal) * 140);
                  const ph = Math.round((pv / maxVal) * 140);
                  return (
                    <View key={i} style={styles.barCol}>
                      <Text style={styles.barValue}>{v > 0 ? (metric === "revenue" ? (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v) : `${v}`) : ""}</Text>
                      <View style={[styles.barTrack, styles.barPair]}>
                        <View style={[styles.bar, styles.barPrev, { height: Math.max(ph, pv > 0 ? 3 : 0) }]} />
                        <View style={[styles.bar, { height: Math.max(h, v > 0 ? 4 : 0), backgroundColor: metric === "revenue" ? colors.brandPrimary : "#32ADE6" }]} />
                      </View>
                      <Text style={styles.barLabel}>{MONTHS[i]}</Text>
                    </View>
                  );
                })}
              </View>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: metric === "revenue" ? colors.brandPrimary : "#32ADE6" }]} />
                <Text style={styles.legendText}>{year}</Text>
                <View style={[styles.legendDot, { backgroundColor: colors.onSurfaceTertiary, opacity: 0.45 }]} />
                <Text style={styles.legendText}>{year - 1}</Text>
              </View>
              <Text style={styles.chartHint}>Unité : {suffix === "€" ? "euros" : "pourcentage"}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  yearNav: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xl, marginBottom: spacing.md },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  yearLabel: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface, minWidth: 90, textAlign: "center" },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 3, marginBottom: spacing.lg },
  segBtn: { flex: 1, flexDirection: "row", gap: 6, paddingVertical: 9, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  segBtnActive: { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  segText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  segTextActive: { color: colors.onSurface, fontFamily: font.semibold },
  chipRow: { gap: spacing.sm, paddingRight: spacing.lg, marginBottom: spacing.lg },
  pickerWrap: { marginBottom: spacing.lg },
  chip: { height: 34, maxWidth: 160, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.onBrandPrimary },
  summaryRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  summaryCard: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg },
  summaryLabel: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  summaryVal: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface, marginTop: 4 },
  deltaText: { fontFamily: font.semibold, fontSize: fontSize.sm, marginTop: 4 },
  deltaMuted: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 4 },
  legendRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.md },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginLeft: 10 },
  legendText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  barPair: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  barPrev: { width: 8, backgroundColor: colors.onSurfaceTertiary, opacity: 0.45 },
  chartCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  chartTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.lg },
  chart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 190 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  barTrack: { height: 145, justifyContent: "flex-end" },
  bar: { width: 14, borderRadius: 4 },
  barValue: { fontFamily: font.medium, fontSize: 9, color: colors.onSurfaceTertiary, marginBottom: 3, height: 12 },
  barLabel: { fontFamily: font.regular, fontSize: 10, color: colors.onSurfaceTertiary, marginTop: 5 },
  chartHint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: spacing.md, textAlign: "center" },
  empty: { alignItems: "center", marginTop: 60, gap: spacing.sm },
  emptyText: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  emptySub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
});
