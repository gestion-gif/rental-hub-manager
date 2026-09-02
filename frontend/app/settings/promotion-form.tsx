import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { ensurePhotoAccess } from "@/src/utils/photoAccess";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api, uploadFile, fileUrl } from "@/src/api";
import DateField from "@/src/components/DateField";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Form = {
  name: string; description: string; photo_path: string;
  require_code: boolean; code: string;
  calc_type: "none" | "fixed" | "percentage"; amount: string;
  period_enabled: boolean; start_date: string; end_date: string;
  property_ids: string[];
};

const EMPTY: Form = {
  name: "", description: "", photo_path: "",
  require_code: false, code: "",
  calc_type: "none", amount: "",
  period_enabled: false, start_date: "", end_date: "",
  property_ids: [],
};

const CALC = [
  { key: "none", label: "Aucune" },
  { key: "fixed", label: "Fixe" },
  { key: "percentage", label: "Pourcentage" },
] as const;

export default function PromotionForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id;
  const editing = !!id;

  const [form, setForm] = useState<Form>(EMPTY);
  const [props, setProps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const pr = await api.get("/properties");
      setProps(pr);
      if (editing) {
        const list = await api.get("/promotions");
        const p = list.find((x: any) => x.id === id);
        if (p) setForm({ ...EMPTY, ...p, amount: p.amount ? String(p.amount) : "" });
      }
    } catch {}
    setLoading(false);
  }, [id, editing]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function set<K extends keyof Form>(k: K, v: Form[K]) { setForm((f) => ({ ...f, [k]: v })); }
  function toggleProperty(pid: string) {
    setForm((f) => ({
      ...f,
      property_ids: f.property_ids.includes(pid) ? f.property_ids.filter((x) => x !== pid) : [...f.property_ids, pid],
    }));
  }

  async function pickPhoto() {
    if (!(await ensurePhotoAccess())) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const path = await uploadFile(asset.uri, asset.fileName || `promo_${Date.now()}.jpg`, asset.mimeType || "image/jpeg");
      set("photo_path", path);
    } catch { Alert.alert("Erreur", "Téléversement impossible."); }
    setUploading(false);
  }

  async function save() {
    if (saving) return;
    if (!form.name.trim()) { Alert.alert("Nom requis", "Donnez un nom à la promotion."); return; }
    setSaving(true);
    const payload = {
      ...form,
      amount: parseFloat(form.amount) || 0,
    };
    try {
      if (editing) await api.put(`/promotions/${id}`, payload);
      else await api.post("/promotions", payload);
      router.back();
    } catch {
      Alert.alert("Erreur", "Enregistrement impossible.");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <Header insets={insets} onBack={() => router.back()} editing={editing} />
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header insets={insets} onBack={() => router.back()} editing={editing} />
      <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
        {/* Photo */}
        <Text style={styles.group}>Photo</Text>
        <Pressable testID="promo-photo" onPress={pickPhoto} disabled={uploading} style={styles.photoBox}>
          {form.photo_path ? (
            <Image source={{ uri: fileUrl(form.photo_path) }} style={styles.photoImg} contentFit="cover" />
          ) : uploading ? (
            <ActivityIndicator color={colors.brandPrimary} />
          ) : (
            <View style={{ alignItems: "center", gap: 6 }}>
              <Ionicons name="camera-outline" size={28} color={colors.onSurfaceTertiary} />
              <Text style={styles.photoHint}>Ajouter une photo</Text>
            </View>
          )}
        </Pressable>
        {!!form.photo_path && (
          <Pressable testID="promo-photo-remove" onPress={() => set("photo_path", "")} style={styles.removeRow}>
            <Ionicons name="trash-outline" size={15} color="#E5484D" />
            <Text style={styles.removeText}>Retirer la photo</Text>
          </Pressable>
        )}

        {/* Nom */}
        <Text style={styles.group}>Nom de la promotion</Text>
        <TextInput testID="promo-name" value={form.name} onChangeText={(v) => set("name", v)}
          placeholder="Offre de printemps" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />

        {/* Description */}
        <Text style={styles.group}>Description</Text>
        <TextInput testID="promo-desc" value={form.description} onChangeText={(v) => set("description", v)}
          placeholder="Texte descriptif de la promotion…" placeholderTextColor={colors.onSurfaceTertiary}
          style={[styles.input, { minHeight: 84, textAlignVertical: "top" }]} multiline />

        {/* Code promo */}
        <Text style={styles.group}>Code de promotion</Text>
        <View style={styles.optRow}>
          <Text style={styles.optText}>Appliquer la promotion uniquement lorsqu'un code de promotion est fourni.</Text>
          <Switch value={form.require_code} onToggle={(v) => set("require_code", v)} testID="promo-require-code" />
        </View>
        {form.require_code && (
          <View style={styles.codeRow}>
            <View style={styles.codeInputWrap}>
              <TextInput testID="promo-code" value={form.code} onChangeText={(v) => set("code", v.toUpperCase())}
                placeholder="CODE PROMO" placeholderTextColor={colors.onSurfaceTertiary} autoCapitalize="characters" style={styles.codeInput} />
              {!!form.code && (
                <Pressable testID="promo-code-clear" onPress={() => set("code", "")} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.onSurfaceTertiary} />
                </Pressable>
              )}
            </View>
            <Pressable testID="promo-code-add" onPress={() => {}} style={[styles.addCodeBtn, !form.code && { opacity: 0.5 }]} disabled={!form.code}>
              <Text style={styles.addCodeText}>Ajouter</Text>
            </Pressable>
          </View>
        )}

        {/* Modèle de calcul */}
        <Text style={styles.group}>Modèle de calcul</Text>
        <Text style={styles.groupSub}>Définir comment la promotion doit être calculée.</Text>
        <View style={styles.chips}>
          {CALC.map((c) => (
            <Pressable key={c.key} testID={`promo-calc-${c.key}`} onPress={() => set("calc_type", c.key)}
              style={[styles.chip, form.calc_type === c.key && styles.chipOn]}>
              <Text style={[styles.chipText, form.calc_type === c.key && styles.chipTextOn]}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
        {form.calc_type !== "none" && (
          <>
            <View style={styles.amountRow}>
              <TextInput testID="promo-amount" value={form.amount} onChangeText={(v) => set("amount", v.replace(",", "."))}
                placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} keyboardType="decimal-pad"
                style={[styles.input, { flex: 1 }]} />
              <Text style={styles.unit}>{form.calc_type === "percentage" ? "%" : "€"}</Text>
            </View>
            {form.calc_type === "percentage" && (
              <Text style={styles.hint}>% de la valeur totale de la réservation (hors frais, taxes et promotions).</Text>
            )}
          </>
        )}

        {/* Période */}
        <Text style={styles.group}>Période de réservation</Text>
        <View style={styles.optRow}>
          <Text style={styles.optText}>Appliquer la promotion uniquement pour une plage de dates de réservation spécifique.</Text>
          <Switch value={form.period_enabled} onToggle={(v) => set("period_enabled", v)} testID="promo-period-toggle" />
        </View>
        {form.period_enabled && (
          <View style={{ marginTop: spacing.sm }}>
            <DateField testID="promo-start" label="Date de début" value={form.start_date} onChange={(iso) => set("start_date", iso)} />
            <DateField testID="promo-end" label="Date de fin" value={form.end_date} onChange={(iso) => set("end_date", iso)} minDate={form.start_date || undefined} />
          </View>
        )}

        {/* Hébergements */}
        <Text style={styles.group}>Sélectionner les hébergements</Text>
        <Text style={styles.groupSub}>Attribuer cette promotion à un ou plusieurs hébergements.</Text>
        <View style={styles.card}>
          {props.length === 0 ? (
            <Text style={styles.groupSub}>Aucun hébergement.</Text>
          ) : props.map((p, i) => {
            const on = form.property_ids.includes(p.id);
            return (
              <Pressable key={p.id} testID={`promo-prop-${p.id}`} onPress={() => toggleProperty(p.id)}
                style={[styles.propRow, i > 0 && styles.propBorder]}>
                <View style={[styles.checkbox, on && styles.checkboxOn]}>{on && <Ionicons name="checkmark" size={15} color="#fff" />}</View>
                <Text style={styles.propName} numberOfLines={1}>{p.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </KeyboardAwareScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Pressable testID="promo-save" onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{editing ? "Enregistrer" : "Créer la promotion"}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function Switch({ value, onToggle, testID }: { value: boolean; onToggle: (v: boolean) => void; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={() => onToggle(!value)} style={[styles.switch, value && styles.switchOn]}>
      <View style={[styles.knob, value && styles.knobOn]} />
    </Pressable>
  );
}

function Header({ insets, onBack, editing }: any) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="promo-form-back" onPress={onBack} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title}>{editing ? "Modifier la promotion" : "Nouvelle promotion"}</Text>
      <View style={{ width: 34 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  group: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurface, marginTop: spacing.lg, marginBottom: spacing.sm },
  groupSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: -4, marginBottom: spacing.sm, lineHeight: 18 },
  photoBox: { height: 150, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photoImg: { width: "100%", height: "100%" },
  photoHint: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  removeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm },
  removeText: { fontFamily: font.medium, fontSize: fontSize.sm, color: "#E5484D" },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface },
  optRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  optText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, lineHeight: 19 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  codeInputWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  codeInput: { flex: 1, paddingVertical: 12, fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface, letterSpacing: 1 },
  addCodeBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  addCodeText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
  chips: { flexDirection: "row", gap: spacing.sm },
  chip: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  chipTextOn: { color: colors.onBrandPrimary },
  amountRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  unit: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurfaceSecondary, width: 30, textAlign: "center" },
  hint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 6, lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  propRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  propBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  propName: { flex: 1, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface },
  switch: { width: 48, height: 28, borderRadius: 14, backgroundColor: colors.border, padding: 3, justifyContent: "center" },
  switchOn: { backgroundColor: colors.brandPrimary },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  saveBtn: { backgroundColor: "#17B0A6", borderRadius: radius.lg, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  saveText: { fontFamily: font.bold, fontSize: fontSize.lg, color: "#fff" },
});
