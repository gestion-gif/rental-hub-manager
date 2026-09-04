import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  FlatList,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";


import { api } from "@/src/api";
import { MenuButton } from "@/src/components/MenuButton";
import { HelpButton } from "@/src/components/HelpButton";
import StatusBadge from "@/src/components/StatusBadge";
import { PlatformLogo } from "@/src/components/PlatformLogo";
import { usePreferences } from "@/src/context/PreferencesContext";
import { useAuth } from "@/src/context/AuthContext";
import { canModify, canSeePrices, guestLabel } from "@/src/permissions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { statuses } = usePreferences();
  const { user } = useAuth();
  const FILTERS = useMemo(
    () => [{ key: "all", label: "Toutes" }, ...statuses.map((s) => ({ key: s.key, label: s.label }))],
    [statuses],
  );
  const [items, setItems] = useState<any[]>([]);
  const [props, setProps] = useState<Record<string, any>>({});
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"check_in" | "amount" | "property">("check_in");
  const [sortAsc, setSortAsc] = useState(true);
  const [propFilter, setPropFilter] = useState<string>("all");

  const propertyList = useMemo(
    () =>
      Object.values(props as Record<string, any>)
        .filter((p: any) => p && p.id && p.name)
        .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), "fr")),
    [props],
  );
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
    () => {
      const norm = (s: any) =>
        String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const q = norm(query.trim());
      // Masquer les réservations dont le séjour est terminé (statut « Départ »)
      // sauf pendant une recherche, qui porte sur TOUTES les réservations.
      let base = q ? items : items.filter((i) => (i.display_status || i.status) !== "depart");
      if (propFilter !== "all") base = base.filter((i) => i.property_id === propFilter);
      if (filter !== "all") base = base.filter((i) => i.status === filter);
      if (!q) return base;
      return base.filter((i) => {
        const hay = norm(
          [
            i.guest_name,
            props[i.property_id]?.name,
            i.platform,
            i.guest_email,
            i.guest_phone,
            i.check_in,
            i.check_out,
            i.check_in && dayjs(i.check_in).format("DD MMMM YYYY"),
            i.check_out && dayjs(i.check_out).format("DD MMMM YYYY"),
          ].filter(Boolean).join(" "),
        );
        return hay.includes(q);
      });
    },
    [items, filter, query, props, propFilter],
  );

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "amount") {
        cmp = (Number(a.total_price) || 0) - (Number(b.total_price) || 0);
      } else if (sortKey === "property") {
        cmp = String(props[a.property_id]?.name || "").localeCompare(
          String(props[b.property_id]?.name || ""), "fr");
        if (cmp === 0) cmp = String(a.check_in || "").localeCompare(String(b.check_in || ""));
      } else {
        cmp = String(a.check_in || "").localeCompare(String(b.check_in || ""));
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortAsc, props]);

  function onSort(key: "check_in" | "amount" | "property") {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(key !== "amount"); // montant : décroissant par défaut
    }
  }

  const SORTS: { key: "check_in" | "amount" | "property"; label: string }[] = [
    { key: "check_in", label: "Arrivée" },
    { key: "amount", label: "Montant" },
    { key: "property", label: "Logement" },
  ];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={[styles.titleRow, { justifyContent: "space-between" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <MenuButton />
            <Text style={styles.title}>Réservations</Text>
          </View>
          <HelpButton screen="calendar" />
        </View>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={colors.onSurfaceTertiary} />
          <TextInput
            testID="reservation-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher (voyageur, logement, date…)"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable testID="reservation-search-clear" onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          )}
        </View>
        {query.trim().length > 0 && (
          <Text style={styles.searchCount}>
            {filtered.length} résultat{filtered.length > 1 ? "s" : ""} (recherche sur tout l'historique)
          </Text>
        )}
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
        {propertyList.length > 1 && (
          <View style={styles.propRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipContent}>
              <Pressable
                testID="prop-chip-all"
                onPress={() => setPropFilter("all")}
                style={[styles.propChip, propFilter === "all" && styles.propChipActive]}
              >
                <Text style={[styles.propChipText, propFilter === "all" && styles.propChipTextActive]}>
                  🏠 Tous les logements
                </Text>
              </Pressable>
              {propertyList.map((p: any) => {
                const active = propFilter === p.id;
                return (
                  <Pressable
                    key={p.id}
                    testID={`prop-chip-${p.id}`}
                    onPress={() => setPropFilter(active ? "all" : p.id)}
                    style={[styles.propChip, active && styles.propChipActive]}
                  >
                    <Text style={[styles.propChipText, active && styles.propChipTextActive]} numberOfLines={1}>
                      {p.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Trier :</Text>
          {SORTS.filter((s) => s.key !== "amount" || canSeePrices(user)).map((s) => {
            const active = sortKey === s.key;
            return (
              <Pressable
                key={s.key}
                testID={`sort-chip-${s.key}`}
                onPress={() => onSort(s.key)}
                style={[styles.sortChip, active && styles.sortChipActive]}
              >
                <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>
                  {s.label}{active ? (sortAsc ? " ↑" : " ↓") : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <FlatList
          testID="reservation-list"
          data={sorted}
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
                <View style={styles.guestRow}>
                  <PlatformLogo platform={item.platform} size={20} />
                  <Text style={styles.guest} numberOfLines={1}>{guestLabel(user, item.guest_name)}</Text>
                </View>
                <StatusBadge status={item.display_status || item.status} />
              </View>
              <Text style={styles.prop}>{props[item.property_id]?.name || "Logement"}</Text>
              <View style={styles.dateRow}>
                <Ionicons name="log-in-outline" size={15} color={colors.onSurfaceTertiary} />
                <Text style={styles.dateText}>{dayjs(item.check_in).format("DD MMM")}</Text>
                <Ionicons name="arrow-forward" size={13} color={colors.onSurfaceTertiary} />
                <Ionicons name="log-out-outline" size={15} color={colors.onSurfaceTertiary} />
                <Text style={styles.dateText}>{dayjs(item.check_out).format("DD MMM")}</Text>
                {canSeePrices(user) && (
                  <View style={styles.priceTag}>
                    <Text style={styles.priceText}>{item.total_price} €</Text>
                  </View>
                )}
              </View>
            </Pressable>
          )}
        />
      )}

      {canModify(user) && (
        <Pressable
          testID="add-reservation-fab"
          onPress={() => router.push("/reservation-form")}
          style={[styles.fab, { bottom: insets.bottom + 76 }]}
        >
          <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
        </Pressable>
      )}
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
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, marginTop: spacing.md, height: 42,
  },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, paddingVertical: 0 },
  searchCount: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: spacing.sm },
  sortRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  sortLabel: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  sortChip: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  sortChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  sortChipText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  sortChipTextActive: { color: colors.onBrandPrimary },
  propRow: { marginTop: spacing.sm },
  propChip: {
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, maxWidth: 220,
  },
  propChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  propChipText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  propChipTextActive: { color: colors.onBrandPrimary },
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
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  guestRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
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
