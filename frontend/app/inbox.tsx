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

  const unreadCount = convs.filter((c) => c.unread).length;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="inbox-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Boîte de réception</Text>
          {unreadCount > 0 && (
            <View testID="inbox-unread-badge" style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </View>
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
              <Text style={styles.emptyText}>Les messages voyageurs (Booking.com, Airbnb) apparaîtront ici dès qu’une conversation existe sur Channex.</Text>
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
                {item.unread && <View style={styles.unreadDot} />}
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text style={[styles.guest, item.unread && styles.guestUnread]} numberOfLines={1}>{item.guest_name}</Text>
                  <View style={styles.sourceTag}><Text style={styles.sourceText}>{item.source}</Text></View>
                </View>
                <Text style={[styles.prop, item.unread && styles.propUnread]} numberOfLines={1}>{item.property_name}</Text>
                {!!item.last_preview && (
                  <Text style={[styles.preview, item.unread && styles.previewUnread]} numberOfLines={1}>{item.last_preview}</Text>
                )}
                {!!item.ai_draft && !item.ai_draft_validated && (
                  <View style={styles.draftTag}>
                    <Ionicons name="sparkles" size={11} color={colors.brandPrimary} />
                    <Text style={styles.draftTagText}>Brouillon IA prêt</Text>
                  </View>
                )}
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
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerBadge: { backgroundColor: colors.error, borderRadius: radius.pill, minWidth: 22, height: 22, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  headerBadgeText: { fontFamily: font.bold, fontSize: fontSize.sm, color: "#fff" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  unreadDot: { position: "absolute", top: -1, right: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.error, borderWidth: 2, borderColor: colors.surface },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  guest: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, flex: 1 },
  guestUnread: { fontFamily: font.bold },
  prop: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 2 },
  propUnread: { fontFamily: font.medium, color: colors.onSurfaceSecondary },
  preview: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2, fontStyle: "italic" },
  previewUnread: { fontFamily: font.semibold, color: colors.onSurface, fontStyle: "normal" },
  dates: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  sourceTag: { backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  sourceText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  draftTag: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 3, marginTop: 4, backgroundColor: colors.brandPrimary + "14", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  draftTagText: { fontFamily: font.semibold, fontSize: 11, color: colors.brandPrimary },
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: spacing.xl, gap: spacing.sm },
  emptyTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, marginTop: spacing.sm },
  emptyText: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", lineHeight: 20 },
});
