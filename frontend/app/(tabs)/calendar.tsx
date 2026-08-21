import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import { api } from "@/src/api";
import { MenuButton } from "@/src/components/MenuButton";
import StatusBadge from "@/src/components/StatusBadge";
import { usePreferences } from "@/src/context/PreferencesContext";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { statuses } = usePreferences();
  const FILTERS = useMemo(
    () => [{ key: "all", label: "Toutes" }, ...statuses.map((s) => ({ key: s.key, label: s.label }))],
    [statuses],
  );
  const [items, setItems] = useState<any[]>([]);
  const [props, setProps] = useState<Record<string, any>>({});
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [res, pr] = await Promise.all([
        api.get("/reservations"),
        api.get("/properties"),
      ]);
      const map: Record<string, any> = {};
      pr.forEach((p: any) => (map[p.id] = p));
      setProps(map);
      setItems(res);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.status === filter)),
    [items, filter],
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.titleRow}>
          <MenuButton />
          <Text style={styles.title}>Réservations</Text>
        </View>
        <View style={styles.chipRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipContent}
          >
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  testID={`filter-chip-${f.key}`}
                  onPress={() => setFilter(f.key)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {f.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <FlatList
          testID="reservation-list"
          data={filtered}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={40} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>Aucune réservation</Text>
              <Text style={styles.emptySub}>Appuyez sur + pour en ajouter une</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`reservation-card-${item.id}`}
              onPress={() => router.push(`/reservation-form?id=${item.id}`)}
              style={styles.card}
            >
              <View style={styles.cardTop}>
                <Text style={styles.guest}>{item.guest_name}</Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.prop}>{props[item.property_id]?.name || "Logement"}</Text>
              <View style={styles.dateRow}>
                <Ionicons name="log-in-outline" size={15} color={colors.onSurfaceTertiary} />
                <Text style={styles.dateText}>{dayjs(item.check_in).format("DD MMM")}</Text>
                <Ionicons name="arrow-forward" size={13} color={colors.onSurfaceTertiary} />
                <Ionicons name="log-out-outline" size={15} color={colors.onSurfaceTertiary} />
                <Text style={styles.dateText}>{dayjs(item.check_out).format("DD MMM")}</Text>
                <View style={styles.priceTag}>
                  <Text style={styles.priceText}>{item.total_price} €</Text>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      <Pressable
        testID="add-reservation-fab"
        onPress={() => router.push("/reservation-form")}
        style={[styles.fab, { bottom: insets.bottom + 76 }]}
      >
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface, marginBottom: spacing.md },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  chipRow: { height: 56, justifyContent: "center" },
  chipContent: { gap: spacing.sm, paddingRight: spacing.lg, alignItems: "center" },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.surfaceSecondary,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.onBrandPrimary },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  guest: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, flex: 1 },
  prop: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 2 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: spacing.md },
  dateText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  priceTag: {
    marginLeft: "auto",
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  priceText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  empty: { alignItems: "center", marginTop: 80, gap: spacing.sm },
  emptyText: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  emptySub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
