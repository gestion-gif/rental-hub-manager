import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";


import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function CleaningHistory() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [props, setProps] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [h, pr] = await Promise.all([api.get("/cleaning-history"), api.get("/properties")]);
      setItems(h.items || []);
      setProps(pr || []);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(
    () => (filter ? items.filter((i) => i.property_id === filter) : items),
    [items, filter]
  );

  // Groupe par mois (les items arrivent triés par date décroissante)
  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: any[] }[] = [];
    for (const it of filtered) {
      const key = (it.date || "").slice(0, 7);
      let g = out[out.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: dayjs(it.date).format("MMMM YYYY"), rows: [] };
        out.push(g);
      }
      g.rows.push(it);
    }
    return out;
  }, [filtered]);

  const doneCount = filtered.filter((i) => i.done).length;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="history-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Historique des ménages</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* Filtre par logement */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}
        contentContainerStyle={styles.pills}>
        <Pressable testID="history-filter-all" onPress={() => setFilter("")}
          style={[styles.pill, !filter && styles.pillOn]}>
          <Text style={[styles.pillText, !filter && styles.pillTextOn]}>Tous</Text>
        </Pressable>
        {props.map((p) => (
          <Pressable key={p.id} testID={`history-filter-${p.id}`}
            onPress={() => setFilter(filter === p.id ? "" : p.id)}
            style={[styles.pill, filter === p.id && styles.pillOn]}>
            <Text style={[styles.pillText, filter === p.id && styles.pillTextOn]} numberOfLines={1}>{p.name}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {filtered.length > 0 && (
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statNum}>{filtered.length}</Text>
                <Text style={styles.statLabel}>Ménages</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statNum, { color: colors.success }]}>{doneCount}</Text>
                <Text style={styles.statLabel}>Effectués</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statNum, { color: "#FF9500" }]}>{filtered.length - doneCount}</Text>
                <Text style={styles.statLabel}>Non faits</Text>
              </View>
            </View>
          )}

          {groups.map((g) => (
            <View key={g.key}>
              <Text style={styles.month}>{g.label}</Text>
              {g.rows.map((c) => (
                <View key={c.id} style={styles.card} testID={`history-${c.id}`}>
                  <View style={styles.cardRow}>
                    <View style={styles.dateBadge}>
                      <Text style={styles.dateDay}>{dayjs(c.date).format("D")}</Text>
                      <Text style={styles.dateMonth}>{dayjs(c.date).format("MMM")}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.prop} numberOfLines={1}>{c.property_name}</Text>
                      <View style={styles.metaRow}>
                        <Ionicons name="person-outline" size={13} color={colors.onSurfaceTertiary} />
                        <Text style={styles.meta} numberOfLines={1}>
                          {c.intervenant || "Non assigné"}
                        </Text>
                      </View>
                      {!c.done && !!c.not_done_reason && (
                        <Text style={styles.reason} numberOfLines={2}>Raison : {c.not_done_reason}</Text>
                      )}
                    </View>
                    <View style={[styles.statusBadge, c.done ? styles.statusOk : styles.statusWarn]}>
                      <Ionicons name={c.done ? "checkmark-circle" : "close-circle"} size={13}
                        color={c.done ? "#2FB350" : "#FF9500"} />
                      <Text style={[styles.statusText, { color: c.done ? "#2FB350" : "#FF9500" }]}>
                        {c.done ? "Fait" : "Non fait"}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ))}

          {!filtered.length && (
            <View style={styles.emptyBox}>
              <Ionicons name="sparkles-outline" size={36} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>Aucun ménage dans l'historique</Text>
              <Text style={styles.emptySub}>
                Les ménages passés apparaîtront ici au fil des départs, avec l'intervenant et le statut.
              </Text>
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
  pills: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  pill: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, maxWidth: 180 },
  pillOn: { backgroundColor: colors.brandPrimary },
  pillText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  pillTextOn: { color: colors.onBrandPrimary },
  statsRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  statBox: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: "center" },
  statNum: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  statLabel: { fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, marginTop: 2 },
  month: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "capitalize", marginTop: spacing.md, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  cardRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  dateBadge: { width: 44, height: 48, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  dateDay: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  dateMonth: { fontFamily: font.medium, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, textTransform: "capitalize" },
  prop: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  meta: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  reason: { fontFamily: font.regular, fontSize: fontSize.xs, color: "#FF9500", marginTop: 3 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  statusOk: { backgroundColor: "#E7F8EC" },
  statusWarn: { backgroundColor: "#FFF4E5" },
  statusText: { fontFamily: font.semibold, fontSize: fontSize.xs },
  emptyBox: { alignItems: "center", paddingVertical: 60, paddingHorizontal: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurfaceSecondary },
  emptySub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, textAlign: "center", lineHeight: 19 },
});
