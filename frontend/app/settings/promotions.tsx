import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api, fileUrl } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Promo = {
  id: string; name: string; description: string; photo_path: string;
  calc_type: string; amount: number; require_code: boolean; code: string;
  period_enabled: boolean; start_date: string; end_date: string;
  property_ids: string[]; enabled: boolean;
};

function calcLabel(p: Promo) {
  if (p.calc_type === "percentage") return `-${p.amount}%`;
  if (p.calc_type === "fixed") return `-${p.amount} €`;
  return "Aucune réduction";
}

export default function PromotionsSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setItems(await api.get("/promotions")); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function remove(p: Promo) {
    Alert.alert("Supprimer", `Supprimer la promotion « ${p.name} » ?`, [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => {
        try { await api.del(`/promotions/${p.id}`); load(); } catch {}
      } },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="promos-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Promotions</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>Promotions</Text>
          <Text style={styles.introSub}>Créez des réductions (code promo, montant fixe ou pourcentage) applicables à vos hébergements.</Text>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="pricetags-outline" size={34} color={colors.onSurfaceTertiary} />
              <Text style={styles.emptyText}>Aucune promotion pour l'instant.</Text>
            </View>
          ) : (
            items.map((p) => (
              <Pressable key={p.id} testID={`promo-${p.id}`} onPress={() => router.push(`/settings/promotion-form?id=${p.id}`)} style={styles.card}>
                <View style={styles.thumb}>
                  {p.photo_path ? (
                    <Image source={{ uri: fileUrl(p.photo_path) }} style={styles.thumbImg} contentFit="cover" />
                  ) : (
                    <Ionicons name="pricetag" size={22} color={colors.brandPrimary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.cardSub} numberOfLines={1}>
                    {calcLabel(p)}{p.require_code && p.code ? ` · code ${p.code}` : ""}{` · ${p.property_ids?.length || 0} hébergement(s)`}
                  </Text>
                </View>
                <Pressable testID={`promo-del-${p.id}`} onPress={() => remove(p)} hitSlop={10} style={styles.delBtn}>
                  <Ionicons name="trash-outline" size={18} color="#E5484D" />
                </Pressable>
              </Pressable>
            ))
          )}

          <Pressable testID="promo-add" onPress={() => router.push("/settings/promotion-form")} style={styles.addBtn}>
            <Ionicons name="add" size={20} color={colors.onBrandPrimary} />
            <Text style={styles.addText}>Ajouter une promotion</Text>
          </Pressable>
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
  intro: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  introSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: spacing.lg, lineHeight: 20 },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl },
  emptyText: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  thumb: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  thumbImg: { width: "100%", height: "100%" },
  cardTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  cardSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  delBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.lg, paddingVertical: 15, marginTop: spacing.lg },
  addText: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onBrandPrimary },
});
