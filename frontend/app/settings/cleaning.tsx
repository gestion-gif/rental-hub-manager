import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const OFFSETS = [0, 1, 2, 3, 4, 5];

export default function CleaningSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api.get("/preferences");
      setOffset(p.cleaning_offset_days ?? 0);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function pick(d: number) {
    if (d === offset) return;
    setOffset(d);
    setSaving(true);
    try { await api.put("/preferences", { cleaning_offset_days: d }); } catch {}
    setSaving(false);
  }

  const label = (d: number) => (d === 0 ? "Le jour du départ" : `J+${d}`);

  if (loading) {
    return (
      <View style={styles.container}>
        <Header insets={insets} onBack={() => router.back()} />
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header insets={insets} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Ménage automatique</Text>
        <Text style={styles.introSub}>
          À chaque réservation, un ménage est planifié automatiquement après le départ du voyageur.
          Choisissez le moment où il doit être programmé.
        </Text>

        <Text style={styles.group}>Quand planifier le ménage ?</Text>
        <View style={styles.card}>
          <View style={styles.chips}>
            {OFFSETS.map((d) => (
              <Pressable key={d} testID={`cleaning-offset-${d}`} onPress={() => pick(d)}
                style={[styles.chip, offset === d && styles.chipOn]}>
                <Text style={[styles.chipText, offset === d && styles.chipTextOn]}>{label(d)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.selectedRow}>
            <Ionicons name="sparkles-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.selectedText}>
              Ménage planifié : <Text style={{ fontFamily: font.bold }}>{label(offset)}</Text>
              {offset > 0 ? ` (${offset} jour${offset > 1 ? "s" : ""} après le check-out)` : ""}
            </Text>
            {saving && <ActivityIndicator size="small" color={colors.brandPrimary} style={{ marginLeft: 6 }} />}
          </View>
        </View>

        <Text style={styles.note}>
          En modifiant ce réglage, les ménages automatiques à venir (non encore effectués) sont replanifiés
          automatiquement à la nouvelle date. Les ménages déjà réalisés ou ajoutés manuellement ne sont pas modifiés.
        </Text>
      </ScrollView>
    </View>
  );
}

function Header({ insets, onBack }: any) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="cleaning-back" onPress={onBack} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title}>Ménage automatique</Text>
      <View style={{ width: 34 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  intro: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  introSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: spacing.md, lineHeight: 20 },
  group: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  chipOn: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  chipTextOn: { color: colors.onBrandPrimary },
  selectedRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  selectedText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  note: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: spacing.md, lineHeight: 18 },
});
