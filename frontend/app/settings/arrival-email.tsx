import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  Switch, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const DAYS = [0, 1, 2, 3, 5, 7];

export default function ArrivalEmailSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState(2);
  const [extra, setExtra] = useState("");
  const [savedExtra, setSavedExtra] = useState("");

  const load = useCallback(async () => {
    try {
      const p = await api.get("/preferences");
      const c = p.arrival_email || {};
      setEnabled(!!c.enabled);
      setDays(c.days_before ?? 2);
      setExtra(c.extra_message || "");
      setSavedExtra(c.extra_message || "");
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function save(next: { enabled?: boolean; days_before?: number; extra_message?: string }) {
    setSaving(true);
    try {
      const p = await api.put("/preferences", {
        arrival_email: {
          enabled: next.enabled ?? enabled,
          days_before: next.days_before ?? days,
          extra_message: next.extra_message ?? extra,
        },
      });
      const c = p.arrival_email || {};
      setEnabled(!!c.enabled);
      setDays(c.days_before ?? 2);
      setSavedExtra(c.extra_message || "");
    } catch {}
    setSaving(false);
  }

  const dayLabel = (d: number) => (d === 0 ? "Le jour même" : `J-${d}`);
  const extraDirty = extra !== savedExtra;

  if (loading) {
    return (
      <View style={styles.container}>
        <Header insets={insets} onBack={() => router.back()} saving={saving} />
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.container}>
        <Header insets={insets} onBack={() => router.back()} saving={saving} />
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>Email avant l'arrivée</Text>
          <Text style={styles.introSub}>
            Envoie automatiquement un email au voyageur avant son arrivée avec l'adresse du logement,
            les instructions d'accès et les codes (boîte à clés), plus un message personnalisé.
          </Text>

          <View style={styles.card}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Activer l'envoi automatique</Text>
                <Text style={styles.switchSub}>Un seul email par réservation, si le voyageur a un email.</Text>
              </View>
              <Switch
                testID="arrival-email-toggle"
                value={enabled}
                onValueChange={(v) => { setEnabled(v); save({ enabled: v }); }}
                trackColor={{ true: colors.brandPrimary }}
              />
            </View>
          </View>

          <Text style={styles.group}>Quand envoyer ?</Text>
          <View style={styles.card}>
            <View style={styles.chips}>
              {DAYS.map((d) => (
                <Pressable
                  key={d}
                  testID={`arrival-email-days-${d}`}
                  onPress={() => { if (d !== days) { setDays(d); save({ days_before: d }); } }}
                  style={[styles.chip, days === d && styles.chipOn]}
                >
                  <Text style={[styles.chipText, days === d && styles.chipTextOn]}>{dayLabel(d)}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.selectedRow}>
              <Ionicons name="mail-unread-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.selectedText}>
                Envoi : <Text style={{ fontFamily: font.bold }}>{dayLabel(days)}</Text>
                {days > 0 ? ` (${days} jour${days > 1 ? "s" : ""} avant l'arrivée)` : " (jour de l'arrivée)"}
              </Text>
            </View>
          </View>

          <Text style={styles.group}>Message personnalisé (optionnel)</Text>
          <View style={styles.card}>
            <TextInput
              testID="arrival-email-extra"
              style={styles.input}
              value={extra}
              onChangeText={setExtra}
              placeholder="Ex. : Le parking se trouve derrière la résidence. Bon voyage !"
              placeholderTextColor={colors.onSurfaceTertiary}
              multiline
              maxLength={1500}
            />
            {extraDirty && (
              <Pressable testID="arrival-email-save" onPress={() => save({ extra_message: extra })} style={styles.saveBtn} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : (
                  <Text style={styles.saveBtnText}>Enregistrer le message</Text>
                )}
              </Pressable>
            )}
          </View>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.infoText}>
              Les instructions d'accès et codes proviennent de la fiche de chaque logement
              (champ « Instructions clés »). Si un logement n'a pas d'instructions et qu'aucun
              message personnalisé n'est défini, aucun email n'est envoyé pour ce logement.
            </Text>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function Header({ insets, onBack, saving }: any) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="arrival-email-back" onPress={onBack} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title}>Email avant l'arrivée</Text>
      <View style={{ width: 34, alignItems: "center" }}>
        {saving && <ActivityIndicator size="small" color={colors.brandPrimary} />}
      </View>
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
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  switchLabel: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  switchSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  chipOn: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  chipTextOn: { color: colors.onBrandPrimary },
  selectedRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  selectedText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  input: { minHeight: 90, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, textAlignVertical: "top" },
  saveBtn: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  saveBtnText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
  infoBox: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, alignItems: "flex-start" },
  infoText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, lineHeight: 19 },
});
