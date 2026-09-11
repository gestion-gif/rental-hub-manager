import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Alert, Switch } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { ensurePhotoAccess } from "@/src/utils/photoAccess";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api, uploadFile, fileUrl } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Company = {
  name: string; address: string; postal_code: string; city: string;
  phone: string; email: string; website: string; siret: string; vat: string;
  logo_path: string;
};

const EMPTY: Company = {
  name: "", address: "", postal_code: "", city: "",
  phone: "", email: "", website: "", siret: "", vat: "", logo_path: "",
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
  const [vatSubjected, setVatSubjected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const load = useCallback(async () => {
    try {
      const prefs = await api.get("/preferences");
      setForm({ ...EMPTY, ...(prefs.company || {}) });
      setVatSubjected(!!prefs.vat_subjected);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function set(k: keyof Company, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function pickLogo() {
    if (!(await ensurePhotoAccess("Autorisez l'accès aux photos pour choisir votre logo."))) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploadingLogo(true);
    try {
      const name = asset.fileName || `logo_${Date.now()}.png`;
      const path = await uploadFile(asset.uri, name, asset.mimeType || "image/png");
      setForm((f) => ({ ...f, logo_path: path }));
    } catch {
      Alert.alert("Erreur", "Téléversement du logo impossible.");
    }
    setUploadingLogo(false);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await api.put("/preferences", { company: form, vat_subjected: vatSubjected });
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
            Ces informations et votre logo apparaissent en en-tête des relevés propriétaires (PDF et emails).
          </Text>

          <View style={styles.logoCard}>
            <Text style={styles.fieldLabel}>Logo</Text>
            <View style={styles.logoRow}>
              <View style={styles.logoPreview}>
                {form.logo_path ? (
                  <Image source={{ uri: fileUrl(form.logo_path) }} style={styles.logoImg} contentFit="contain" />
                ) : (
                  <Ionicons name="image-outline" size={28} color={colors.onSurfaceTertiary} />
                )}
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <Pressable testID="company-logo-pick" onPress={pickLogo} disabled={uploadingLogo} style={styles.logoBtn}>
                  {uploadingLogo ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : (
                    <>
                      <Ionicons name="cloud-upload-outline" size={16} color={colors.brandPrimary} />
                      <Text style={styles.logoBtnText}>{form.logo_path ? "Changer le logo" : "Téléverser un logo"}</Text>
                    </>
                  )}
                </Pressable>
                {!!form.logo_path && (
                  <Pressable testID="company-logo-remove" onPress={() => set("logo_path", "")} style={styles.logoRemove}>
                    <Ionicons name="trash-outline" size={15} color="#E5484D" />
                    <Text style={styles.logoRemoveText}>Retirer</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>

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

          <View style={styles.vatCard}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text style={styles.vatTitle}>Soumis à TVA (20 %)</Text>
              <Text style={styles.vatHint}>
                {vatSubjected
                  ? "Vos factures clients détaillent la TVA (20 % sur nuitées et ménage) et la comptabilité affiche le suivi de TVA."
                  : "La mention « TVA non applicable, art. 293 B du CGI » figurera sur vos factures clients."}
              </Text>
            </View>
            <Switch
              testID="company-vat-toggle"
              value={vatSubjected}
              onValueChange={setVatSubjected}
              trackColor={{ false: colors.border, true: colors.brandPrimary }}
              thumbColor="#fff"
            />
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
  logoCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: 8 },
  logoPreview: { width: 96, height: 64, borderRadius: radius.md, backgroundColor: "#111", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  logoImg: { width: "100%", height: "100%" },
  logoBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: 10 },
  logoBtnText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary },
  logoRemove: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  logoRemoveText: { fontFamily: font.medium, fontSize: fontSize.xs, color: "#E5484D" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  vatCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md },
  vatTitle: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface, marginBottom: 4 },
  vatHint: { fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, lineHeight: 17 },
  fullField: { width: "100%", marginBottom: spacing.md },
  halfField: { width: "48%", marginBottom: spacing.md },
  fieldLabel: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginBottom: 6 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface },
  saveBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  saveText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
});
