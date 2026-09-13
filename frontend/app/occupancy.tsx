import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const M_LABELS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function occColor(v: number) {
  if (v >= 70) return colors.success;
  if (v >= 40) return colors.warning;
  return colors.onSurfaceTertiary;
}

function MiniBars({ monthly, year }: { monthly: any[]; year: number }) {
  const now = new Date();
  const curM = now.getFullYear() === year ? now.getMonth() : -1;
  return (
    <View style={styles.barsRow}>
      {monthly.map((m: any, i: number) => (
        <View key={i} style={styles.barCol}>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.bar,
                {
                  height: Math.max(((m.occupancy || 0) / 100) * 54, 2),
                  backgroundColor: i === curM ? colors.brandPrimary : colors.brandPrimary + "55",
                },
              ]}
            />
          </View>
          <Text style={[styles.barLabel, i === curM && { color: colors.brandPrimary, fontFamily: font.bold }]}>
            {M_LABELS[i]}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Delta({ cur, prev }: { cur: number; prev: number | null }) {
  if (prev == null || prev <= 0) return null;
  const d = cur - prev;
  const up = d >= 0;
  return (
    <View style={styles.deltaRow}>
      <Ionicons name={up ? "trending-up" : "trending-down"} size={13} color={up ? colors.success : colors.error} />
      <Text style={[styles.deltaText, { color: up ? colors.success : colors.error }]}>
        {up ? "+" : ""}{d} pts
      </Text>
      <Text style={styles.deltaVs}>vs année préc.</Text>
    </View>
  );
}

export default function Occupancy() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<any>(null);
  const [prevData, setPrevData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [res, prev] = await Promise.all([
        api.get(`/analytics/revenue?year=${year}`),
        api.get(`/analytics/revenue?year=${year - 1}`),
      ]);
      setData(res);
      setPrevData(prev);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [year]);
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const prevOccMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of prevData?.properties || []) m[p.id] = p.avg_occupancy || 0;
    return m;
  }, [prevData]);

  const sortedProps = useMemo(
    () => [...(data?.properties || [])].sort((a: any, b: any) => (b.avg_occupancy || 0) - (a.avg_occupancy || 0)),
    [data]
  );

  const totals = data?.totals;
  const curMonthIdx = new Date().getFullYear() === year ? new Date().getMonth() : null;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="occupancy-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Taux d'occupation</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* Sélecteur d'année */}
      <View style={styles.yearRow}>
        <Pressable testID="occupancy-year-prev" onPress={() => setYear((y) => y - 1)} style={styles.yearBtn}>
          <Ionicons name="chevron-back" size={18} color={colors.brandPrimary} />
        </Pressable>
        <Text style={styles.yearText}>{year}</Text>
        <Pressable
          testID="occupancy-year-next"
          onPress={() => setYear((y) => y + 1)}
          disabled={year >= new Date().getFullYear() + 1}
          style={[styles.yearBtn, year >= new Date().getFullYear() + 1 && { opacity: 0.3 }]}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.brandPrimary} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {/* Vue globale */}
          {totals && (
            <View style={styles.globalCard} testID="occupancy-global">
              <View style={styles.globalTop}>
                <View>
                  <Text style={styles.globalLabel}>Occupation moyenne</Text>
                  <Text style={styles.globalSub}>Tous logements confondus</Text>
                </View>
                <View style={[styles.bigBadge, { backgroundColor: occColor(totals.avg_occupancy) + "1A" }]}>
                  <Text style={[styles.bigBadgeText, { color: occColor(totals.avg_occupancy) }]}>
                    {totals.avg_occupancy}%
                  </Text>
                </View>
              </View>
              <Delta cur={totals.avg_occupancy || 0} prev={prevData?.totals?.avg_occupancy ?? null} />
              <MiniBars monthly={totals.monthly || []} year={year} />
              {curMonthIdx != null && totals.monthly?.[curMonthIdx] && (
                <Text style={styles.curMonthText}>
                  Mois en cours : {totals.monthly[curMonthIdx].occupancy}% ({totals.monthly[curMonthIdx].nights} nuits)
                </Text>
              )}
            </View>
          )}

          <Text style={styles.sectionTitle}>Par logement</Text>

          {sortedProps.map((p: any) => (
            <View key={p.id} style={styles.card} testID={`occupancy-prop-${p.id}`}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.propName} numberOfLines={1}>{p.name}</Text>
                  <Delta cur={p.avg_occupancy || 0} prev={prevOccMap[p.id] ?? null} />
                </View>
                <View style={[styles.badge, { backgroundColor: occColor(p.avg_occupancy) + "1A" }]}>
                  <Text style={[styles.badgeText, { color: occColor(p.avg_occupancy) }]}>{p.avg_occupancy}%</Text>
                </View>
              </View>
              <MiniBars monthly={p.monthly || []} year={year} />
              <Text style={styles.nightsText}>
                {(p.monthly || []).reduce((s: number, m: any) => s + (m.nights || 0), 0)} nuits réservées sur l'année
              </Text>
            </View>
          ))}

          {!sortedProps.length && (
            <View style={styles.emptyBox}>
              <Ionicons name="pie-chart-outline" size={36} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>Aucun logement</Text>
              <Text style={styles.emptySub}>Ajoutez des logements pour suivre leur taux d'occupation.</Text>
            </View>
          )}
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
  yearRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.lg, paddingVertical: spacing.md },
  yearBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  yearText: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface, minWidth: 64, textAlign: "center" },
  globalCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  globalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  globalLabel: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  globalSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  bigBadge: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  bigBadgeText: { fontFamily: font.bold, fontSize: 22 },
  curMonthText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: spacing.sm },
  sectionTitle: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  propName: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  badge: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  badgeText: { fontFamily: font.bold, fontSize: fontSize.lg },
  deltaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  deltaText: { fontFamily: font.semibold, fontSize: fontSize.sm },
  deltaVs: { fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary },
  barsRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, marginTop: spacing.md },
  barCol: { flex: 1, alignItems: "center" },
  barTrack: { height: 54, justifyContent: "flex-end", width: "100%", alignItems: "center" },
  bar: { width: "70%", borderRadius: 3 },
  barLabel: { fontFamily: font.medium, fontSize: 10, color: colors.onSurfaceTertiary, marginTop: 4 },
  nightsText: { fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, marginTop: spacing.sm },
  emptyBox: { alignItems: "center", paddingVertical: 60, paddingHorizontal: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurfaceSecondary },
  emptySub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, textAlign: "center", lineHeight: 19 },
});
