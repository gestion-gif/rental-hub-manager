import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const SOURCE_ICON: Record<string, any> = {
  Airbnb: "home",
  "Booking.com": "bed",
  Vrbo: "business",
  Direct: "person",
};

export default function Inbox() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [convs, setConvs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setConvs(await api.get("/inbox")); } catch {}
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="inbox-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Boîte de réception</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <FlatList
          data={convs}
          keyExtractor={(c) => c.thread_uid}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={40} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>Aucune conversation</Text>
              <Text style={styles.emptyText}>Connectez Lodgify et synchronisez vos réservations pour importer les messages voyageurs.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`conv-${item.thread_uid}`}
              onPress={() => router.push(`/inbox/${item.thread_uid}`)}
              style={styles.row}
            >
              <View style={styles.avatar}>
                <Ionicons name={SOURCE_ICON[item.source] || "chatbubble-ellipses"} size={18} color={colors.onSurfaceSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text style={styles.guest} numberOfLines={1}>{item.guest_name}</Text>
                  <View style={styles.sourceTag}><Text style={styles.sourceText}>{item.source}</Text></View>
                </View>
                <Text style={styles.prop} numberOfLines={1}>{item.property_name}</Text>
                <Text style={styles.dates}>
                  {item.arrival ? dayjs(item.arrival).format("DD MMM YYYY") : ""}
                  {item.departure ? ` → ${dayjs(item.departure).format("DD MMM YYYY")}` : ""}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  guest: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, flex: 1 },
  prop: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginTop: 2 },
  dates: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  sourceTag: { backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  sourceText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, marginTop: spacing.sm },
  emptyText: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", lineHeight: 20 },
});
