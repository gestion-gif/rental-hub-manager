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
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
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
      const d = await api.get("/properties");
      setItems(d);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Logements</Text>
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <FlatList
          testID="properties-list"
          data={items}
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
              <LinearGradient
                colors={["transparent", "rgba(28,28,30,0.85)"]}
                style={styles.scrim}
              />
              <View style={styles.cardBody}>
                <Text style={styles.propName}>{item.name}</Text>
                {!!item.location && (
                  <View style={styles.locRow}>
                    <Ionicons name="location-outline" size={13} color="rgba(255,255,255,0.85)" />
                    <Text style={styles.loc}>{item.location}</Text>
                  </View>
                )}
              </View>
              <View style={styles.metaRow}>
                <Meta icon="cash-outline" text={`${item.base_price} €/nuit`} />
                <Meta icon="bed-outline" text={`${item.bedrooms} ch.`} />
                <Meta icon="people-outline" text={`${item.capacity} pers.`} />
              </View>
            </Pressable>
          )}
        />
      )}

      <Pressable
        testID="add-property-fab"
        onPress={() => router.push("/property-form")}
        style={[styles.fab, { bottom: insets.bottom + 76 }]}
      >
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

function Meta({ icon, text }: any) {
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={15} color={colors.onSurfaceSecondary} />
      <Text style={styles.metaText}>{text}</Text>
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
  },
  title: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    overflow: "hidden",
  },
  image: { width: "100%", height: 170 },
  scrim: { position: "absolute", left: 0, right: 0, top: 60, height: 110 },
  cardBody: { position: "absolute", left: spacing.lg, top: 130 },
  propName: { fontFamily: font.bold, fontSize: fontSize.xl, color: "#fff" },
  locRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  loc: { fontFamily: font.regular, fontSize: fontSize.sm, color: "rgba(255,255,255,0.85)" },
  metaRow: {
    flexDirection: "row",
    gap: spacing.lg,
    padding: spacing.lg,
  },
  meta: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
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
