import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Company = {
  name: string; address: string; postal_code: string; city: string;
  phone: string; email: string; website: string; siret: string; vat: string;
};

const EMPTY: Company = {
  name: "", address: "", postal_code: "", city: "",
  phone: "", email: "", website: "", siret: "", vat: "",
};

const FIELDS: { key: keyof Company; label: string; placeholder: string; keyboard?: any; half?: boolean }[] = [
  { key: "name", label: "Nom de la société / conciergerie", placeholder: "Ma Conciergerie" },
  { key: "address", label: "Adresse", placeholder: "12 rue des Oliviers" },
  { key: "postal_code", label: "Code postal", placeholder: "06000", half: true },
  { key: "city", label: "Ville", placeholder: "Nice", half: true },
  { key: "phone", label: "Téléphone", placeholder: "+33 6 12 34 56 78", keyboard: "phone-pad" },
  { key: "email", label: "Email", placeholder: "contact@societe.fr", keyboard: "email-address" },
  { key: "website", label: "Site web", placeholder: "www.societe.fr" },
  { key: "siret", label: "SIRET", placeholder: "123 456 789 00012", half: true },
  { key: "vat", label: "N° TVA", placeholder: "FR12345678900", half: true },
];

export default function CompanySettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [form, setForm] = useState<Company>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const prefs = await api.get("/preferences");
      setForm({ ...EMPTY, ...(prefs.company || {}) });
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function set(k: keyof Company, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await api.put("/preferences", { company: form });
      Alert.alert("Enregistré", "Les coordonnées de votre société ont été enregistrées. Elles apparaîtront sur les relevés PDF et emails.");
    } catch {
      Alert.alert("Erreur", "Enregistrement impossible.");
    }
    setSaving(false);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="company-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Ma société</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <KeyboardAwareScrollView
          bottomOffset={20}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 80 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>Coordonnées de la conciergerie</Text>
          <Text style={styles.introSub}>
            Ces informations et le logo Casanéo apparaissent en en-tête des relevés propriétaires (PDF et emails).
          </Text>

          <View style={styles.card}>
            <View style={styles.grid}>
              {FIELDS.map((f) => (
                <View key={f.key} style={f.half ? styles.halfField : styles.fullField}>
                  <Text style={styles.fieldLabel}>{f.label}</Text>
                  <TextInput
                    testID={`company-${f.key}`}
                    value={form[f.key]}
                    onChangeText={(v) => set(f.key, v)}
                    placeholder={f.placeholder}
                    placeholderTextColor={colors.onSurfaceTertiary}
                    keyboardType={f.keyboard || "default"}
                    autoCapitalize={f.key === "email" || f.key === "website" ? "none" : "sentences"}
                    style={styles.input}
                  />
                </View>
              ))}
            </View>
          </View>

          <Pressable
            testID="company-save"
            onPress={save}
            disabled={saving}
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          >
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Enregistrer</Text>}
          </Pressable>
        </KeyboardAwareScrollView>
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
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  fullField: { width: "100%", marginBottom: spacing.md },
  halfField: { width: "48%", marginBottom: spacing.md },
  fieldLabel: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginBottom: 6 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface },
  saveBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  saveText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
});
