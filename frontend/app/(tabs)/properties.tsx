import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { MenuButton } from "@/src/components/MenuButton";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const FALLBACK =
  "https://images.unsplash.com/photo-1628744448839-a475cc0e90c3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2Mzl8MHwxfHNlYXJjaHwyfHxtb2Rlcm4lMjBjb3p5JTIwdmFjYXRpb24lMjByZW50YWwlMjBob3VzZSUyMGV4dGVyaW9yfGVufDB8fHx8MTc4NzI5MDMzM3ww&ixlib=rb-4.1.0&q=85";

export default function Properties() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.get("/properties"));
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerLeft}>
          <MenuButton />
          <Text style={styles.title}>Logements</Text>
        </View>
        <Pressable testID="channel-manager-btn" onPress={() => router.push("/channel-manager")} style={styles.cmBtn}>
          <Ionicons name="git-network-outline" size={16} color={colors.onSurface} />
          <Text style={styles.cmBtnText}>Channel Manager</Text>
        </Pressable>
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <FlatList
          testID="properties-list"
          data={items}
          keyExtractor={(i) => i.id}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md }}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40, gap: spacing.md }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="business-outline" size={40} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>Aucun logement</Text>
              <Text style={styles.emptySub}>Ajoutez votre premier logement</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`property-card-${item.id}`}
              onPress={() => router.push(`/property/${item.id}`)}
              style={styles.card}
            >
              <Image
                source={{ uri: item.image_url || FALLBACK }}
                style={styles.image}
                contentFit="cover"
              />
              <View style={styles.cardBody}>
                <Text style={styles.propName} numberOfLines={1}>{item.name}</Text>
                {!!item.location && (
                  <View style={styles.locRow}>
                    <Ionicons name="location-outline" size={12} color={colors.onSurfaceTertiary} />
                    <Text style={styles.loc} numberOfLines={1}>{item.location}</Text>
                  </View>
                )}
                <View style={styles.metaRow}>
                  <Text style={styles.price}>{item.base_price} €</Text>
                  <View style={styles.metaPill}>
                    <Ionicons name="people-outline" size={12} color={colors.onSurfaceSecondary} />
                    <Text style={styles.metaText}>{item.capacity}</Text>
                  </View>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      <Pressable
        testID="add-property-fab"
        onPress={() => router.push("/property-form")}
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
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
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  title: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  cmBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  cmBtnText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  card: {
    flex: 1,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  image: { width: "100%", aspectRatio: 1 },
  cardBody: { padding: spacing.md },
  propName: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  locRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  loc: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, flex: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  price: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  metaText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
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
