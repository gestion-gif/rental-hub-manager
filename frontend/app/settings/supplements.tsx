import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api, fileUrl } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const BASIS_LABEL: Record<string, string> = {
  unique: "charge unique", per_quantity: "par quantité", per_guest: "par invité", per_room: "par chambre",
};
const PERIOD_LABEL: Record<string, string> = { per_stay: "par séjour", per_night: "par nuit" };

function summaryOf(s: any): string {
  if (s.calc_model === "percent") {
    return `${s.amount} % ${s.percent_base === "total" ? "du séjour (nuitées + ménage)" : "des nuitées"}`;
  }
  return `${(Number(s.amount) || 0).toFixed(2)} € · ${BASIS_LABEL[s.charge_basis] || ""} · ${PERIOD_LABEL[s.period] || ""}`;
}

export default function SupplementsSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setItems(await api.get("/supplements"));
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="supplements-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Suppléments</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 110 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>Extras & services</Text>
          <Text style={styles.introSub}>
            Créez vos suppléments (lit bébé, ménage premium, panier d'accueil…). Ils sont ajoutables aux
            réservations et proposés aux voyageurs sur votre site de réservation.
          </Text>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="pricetag-outline" size={32} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>Aucun supplément pour l'instant.{"\n"}Touchez + pour en créer un.</Text>
            </View>
          ) : (
            items.map((s) => (
              <Pressable key={s.id} testID={`supplement-${s.id}`} onPress={() => router.push(`/supplement-form?id=${s.id}`)} style={styles.row}>
                <View style={styles.thumb}>
                  {s.photo_path ? (
                    <Image source={{ uri: fileUrl(s.photo_path) }} style={styles.thumbImg} contentFit="cover" />
                  ) : (
                    <Ionicons name="pricetag-outline" size={20} color={colors.onSurfaceTertiary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{s.name}</Text>
                  <Text style={styles.rowSummary} numberOfLines={1}>{summaryOf(s)}</Text>
                  <Text style={styles.rowProps} numberOfLines={1}>
                    {(s.property_ids || []).length ? `${s.property_ids.length} hébergement(s)` : "Tous les hébergements"}
                    {s.active === false ? " · Inactif" : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      <Pressable testID="supplement-add" onPress={() => router.push("/supplement-form")} style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}>
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  intro: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  introSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: spacing.lg, lineHeight: 20 },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: 50 },
  emptyText: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", lineHeight: 21 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  thumb: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  thumbImg: { width: "100%", height: "100%" },
  rowName: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  rowSummary: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.brandPrimary, marginTop: 2 },
  rowProps: { fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, marginTop: 2 },
  fab: { position: "absolute", right: spacing.lg, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
});
