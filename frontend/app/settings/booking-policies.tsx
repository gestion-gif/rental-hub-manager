import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const CANCEL_LABEL: any = {
  non_refundable: "Non-remboursable",
  fully_refundable: "Entièrement remboursable",
  partially_refundable: "Partiellement remboursable",
};

export default function BookingPolicies() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/booking-policies");
      setPolicies(r.policies || []);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function del(id: string) {
    Alert.alert("Supprimer la politique", "Cette action est définitive.", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => { try { await api.del(`/booking-policies/${id}`); load(); } catch {} } },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="bp-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Politiques de réservation</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 80 }}>
          <Text style={styles.intro}>Définissez vos conditions de paiement, d'annulation et de caution.</Text>

          <Pressable testID="bp-new" onPress={() => router.push("/settings/booking-policy-form")} style={styles.newBtn}>
            <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.newText}>Nouvelle politique</Text>
          </Pressable>

          {policies.length === 0 && <Text style={styles.empty}>Aucune politique pour l'instant.</Text>}

          {policies.map((p) => (
            <Pressable key={p.id} testID={`bp-${p.id}`} onPress={() => router.push(`/settings/booking-policy-form?id=${p.id}`)} style={styles.card}>
              <View style={styles.cardIcon}><Ionicons name="document-lock-outline" size={18} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{p.name}</Text>
                <Text style={styles.cardMeta}>
                  {p.payment_count} paiement{p.payment_count > 1 ? "s" : ""} · {CANCEL_LABEL[p.cancellation]} · {p.deposit_required ? "Caution requise" : "Sans caution"}
                </Text>
              </View>
              <Pressable testID={`bp-del-${p.id}`} onPress={() => del(p.id)} hitSlop={8}><Ionicons name="trash-outline" size={18} color="#E5484D" /></Pressable>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  intro: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginBottom: spacing.lg, lineHeight: 20 },
  newBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, marginBottom: spacing.lg },
  newText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  cardIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  cardName: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  cardMeta: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
});
