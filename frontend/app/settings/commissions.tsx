import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { usePreferences, DEFAULT_COMMISSION_RATES } from "@/src/context/PreferencesContext";
import { PlatformLogo } from "@/src/components/PlatformLogo";
import { PrimaryButton } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const PLATFORMS = ["Airbnb", "Booking.com", "Vrbo", "Direct", "Site web"];

export default function CommissionsSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { commissionRates, saveCommissionRates } = usePreferences();
  const [rates, setRates] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    PLATFORMS.forEach((p) => {
      const v = commissionRates?.[p] ?? DEFAULT_COMMISSION_RATES[p] ?? 0;
      init[p] = String(v);
    });
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const setRate = (p: string, v: string) => {
    setSaved(false);
    setRates((r) => ({ ...r, [p]: v.replace(",", ".") }));
  };

  async function save() {
    setSaving(true);
    const out: Record<string, number> = {};
    PLATFORMS.forEach((p) => {
      const n = parseFloat(rates[p]);
      out[p] = isNaN(n) ? 0 : Math.max(0, Math.min(100, n));
    });
    await saveCommissionRates(out);
    setSaving(false);
    setSaved(true);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="commissions-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Commissions</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={colors.onSurfaceSecondary} />
          <Text style={styles.infoText}>
            Lodgify ne transmet pas la commission des plateformes. Renseignez ici votre taux
            par plateforme : il sera appliqué automatiquement pour calculer votre revenu net.
            Vous pouvez ajuster le montant réservation par réservation.
          </Text>
        </View>

        {PLATFORMS.map((p) => (
          <View key={p} style={styles.row}>
            <PlatformLogo platform={p} size={28} />
            <Text style={styles.platform}>{p}</Text>
            <View style={styles.inputWrap}>
              <TextInput
                testID={`commission-rate-${p}`}
                value={rates[p]}
                onChangeText={(v) => setRate(p, v)}
                keyboardType="decimal-pad"
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.onSurfaceTertiary}
              />
              <Text style={styles.percent}>%</Text>
            </View>
          </View>
        ))}

        <PrimaryButton
          testID="save-commissions"
          label={saved ? "Enregistré ✓" : "Enregistrer"}
          onPress={save}
          loading={saving}
          style={{ marginTop: spacing.lg }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  infoBox: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg },
  infoText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  platform: { flex: 1, fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  inputWrap: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, minWidth: 90 },
  input: { flex: 1, fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, paddingVertical: 10, textAlign: "right" },
  percent: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurfaceSecondary, marginLeft: 4 },
});
