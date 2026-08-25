import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Alert, Switch, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api, uploadFile, fileUrl } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const BASIS_OPTIONS = [
  { key: "unique", label: "Charge unique" },
  { key: "per_quantity", label: "Par quantité" },
  { key: "per_guest", label: "Par invité" },
  { key: "per_room", label: "Par chambre" },
];
const PERIOD_OPTIONS = [
  { key: "per_stay", label: "Par séjour" },
  { key: "per_night", label: "Par nuit" },
];

export default function SupplementForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [properties, setProperties] = useState<any[]>([]);
  const [propsOpen, setPropsOpen] = useState(false);

  const [form, setForm] = useState({
    name: "",
    description: "",
    photo_path: "",
    calc_model: "fixed",
    amount: "",
    percent_base: "nights",
    charge_basis: "unique",
    period: "per_stay",
    vat_rate: "20",
    price_includes_vat: true,
    property_ids: [] as string[],
    active: true,
  });

  useEffect(() => {
    (async () => {
      try {
        const props = await api.get("/properties");
        setProperties(props.map((p: any) => ({ id: p.id, name: p.name })));
        if (editing) {
          const list = await api.get("/supplements");
          const s = list.find((x: any) => x.id === id);
          if (s) {
            setForm({
              name: s.name || "",
              description: s.description || "",
              photo_path: s.photo_path || "",
              calc_model: s.calc_model || "fixed",
              amount: s.amount ? String(s.amount) : "",
              percent_base: s.percent_base || "nights",
              charge_basis: s.charge_basis || "unique",
              period: s.period || "per_stay",
              vat_rate: String(s.vat_rate ?? 20),
              price_includes_vat: s.price_includes_vat !== false,
              property_ids: s.property_ids || [],
              active: s.active !== false,
            });
          }
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const isPercent = form.calc_model === "percent";

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Autorisation requise", "Autorisez l'accès aux photos pour illustrer votre supplément.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const name = asset.fileName || `supplement_${Date.now()}.jpg`;
      const path = await uploadFile(asset.uri, name, asset.mimeType || "image/jpeg");
      set("photo_path", path);
    } catch {
      Alert.alert("Erreur", "Téléversement de la photo impossible.");
    }
    setUploading(false);
  }

  function toggleProperty(pid: string) {
    setForm((f) => ({
      ...f,
      property_ids: f.property_ids.includes(pid)
        ? f.property_ids.filter((x) => x !== pid)
        : [...f.property_ids, pid],
    }));
  }

  async function save() {
    if (!form.name.trim()) {
      Alert.alert("Nom requis", "Donnez un nom à votre supplément.");
      return;
    }
    if (saving) return;
    setSaving(true);
    const payload = {
      ...form,
      amount: parseFloat((form.amount || "0").replace(",", ".")) || 0,
      vat_rate: parseFloat((form.vat_rate || "0").replace(",", ".")) || 0,
    };
    try {
      if (editing) await api.put(`/supplements/${id}`, payload);
      else await api.post("/supplements", payload);
      router.back();
    } catch {
      Alert.alert("Erreur", "Enregistrement impossible.");
      setSaving(false);
    }
  }

  async function remove() {
    try {
      await api.del(`/supplements/${id}`);
      router.back();
    } catch {}
  }

  const selCount = form.property_ids.length;

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="supform-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{editing ? "Modifier le supplément" : "Nouveau supplément"}</Text>
        <View style={{ width: 34 }} />
      </View>

      <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
        {/* Photo */}
        <Text style={styles.label}>Photo</Text>
        <View style={styles.photoRow}>
          <View style={styles.photoPreview}>
            {form.photo_path ? (
              <Image source={{ uri: fileUrl(form.photo_path) }} style={styles.photoImg} contentFit="cover" />
            ) : (
              <Ionicons name="image-outline" size={26} color={colors.onSurfaceTertiary} />
            )}
          </View>
          <View style={{ flex: 1, gap: 8 }}>
            <Pressable testID="supform-photo" onPress={pickPhoto} disabled={uploading} style={styles.photoBtn}>
              {uploading ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : (
                <>
                  <Ionicons name="cloud-upload-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.photoBtnText}>{form.photo_path ? "Changer la photo" : "Ajouter une photo"}</Text>
                </>
              )}
            </Pressable>
            {!!form.photo_path && (
              <Pressable testID="supform-photo-remove" onPress={() => set("photo_path", "")} style={styles.photoRemove}>
                <Ionicons name="trash-outline" size={14} color="#E5484D" />
                <Text style={styles.photoRemoveText}>Retirer</Text>
              </Pressable>
            )}
          </View>
        </View>

        <Text style={styles.label}>Nom du supplément</Text>
        <TextInput testID="supform-name" value={form.name} onChangeText={(v) => set("name", v)} placeholder="Lit bébé, panier d'accueil…" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />

        <Text style={styles.label}>Descriptif</Text>
        <TextInput testID="supform-description" value={form.description} onChangeText={(v) => set("description", v)} placeholder="Décrivez ce supplément pour vos voyageurs…" placeholderTextColor={colors.onSurfaceTertiary} multiline style={[styles.input, styles.textarea]} />

        {/* Modèle de calcul */}
        <Text style={styles.section}>Modèle de calcul</Text>
        <Text style={styles.hint}>Indiquez comment le supplément doit être calculé.</Text>
        <View style={styles.chipRow}>
          <Chip testID="supform-model-fixed" label="Frais fixe" active={!isPercent} onPress={() => set("calc_model", "fixed")} />
          <Chip testID="supform-model-percent" label="Pourcentage" active={isPercent} onPress={() => set("calc_model", "percent")} />
        </View>

        <Text style={styles.label}>{isPercent ? "Taux (%)" : "Montant (€)"}</Text>
        <TextInput testID="supform-amount" value={form.amount} onChangeText={(v) => set("amount", v)} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />

        {isPercent ? (
          <>
            <Text style={styles.label}>Base du pourcentage</Text>
            <View style={styles.chipRow}>
              <Chip testID="supform-base-nights" label="Prix des nuitées" active={form.percent_base === "nights"} onPress={() => set("percent_base", "nights")} />
              <Chip testID="supform-base-total" label="Nuitées + ménage" active={form.percent_base === "total"} onPress={() => set("percent_base", "total")} />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.label}>Facturation</Text>
            <View style={styles.chipRow}>
              {BASIS_OPTIONS.map((o) => (
                <Chip key={o.key} testID={`supform-basis-${o.key}`} label={o.label} active={form.charge_basis === o.key} onPress={() => set("charge_basis", o.key)} />
              ))}
            </View>
            <Text style={styles.label}>Fréquence</Text>
            <View style={styles.chipRow}>
              {PERIOD_OPTIONS.map((o) => (
                <Chip key={o.key} testID={`supform-period-${o.key}`} label={o.label} active={form.period === o.key} onPress={() => set("period", o.key)} />
              ))}
            </View>
          </>
        )}

        {/* TVA */}
        <Text style={styles.section}>TVA</Text>
        <Text style={styles.hint}>Définissez la taxe de vente / TVA de votre supplément.</Text>
        <Text style={styles.label}>Taux de TVA (%)</Text>
        <TextInput testID="supform-vat" value={form.vat_rate} onChangeText={(v) => set("vat_rate", v)} keyboardType="decimal-pad" placeholder="20" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
        <View style={styles.chipRow}>
          <Chip testID="supform-vat-incl" label="Prix incl. TVA" active={form.price_includes_vat} onPress={() => set("price_includes_vat", true)} />
          <Chip testID="supform-vat-excl" label="Prix excl. TVA" active={!form.price_includes_vat} onPress={() => set("price_includes_vat", false)} />
        </View>

        {/* Hébergements */}
        <Text style={styles.section}>Sélectionner les hébergements</Text>
        <Text style={styles.hint}>Attribuer ce supplément à un ou plusieurs hébergements.</Text>
        <Pressable testID="supform-properties" onPress={() => setPropsOpen(true)} style={styles.dropdown}>
          <Ionicons name="home-outline" size={16} color={colors.onSurfaceSecondary} />
          <Text style={styles.dropdownText}>
            {selCount === 0 ? "Tous les hébergements" : `${selCount} hébergement${selCount > 1 ? "s" : ""} sélectionné${selCount > 1 ? "s" : ""}`}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.onSurfaceTertiary} />
        </Pressable>

        <View style={styles.activeRow}>
          <Text style={styles.activeLabel}>Supplément actif</Text>
          <Switch testID="supform-active" value={form.active} onValueChange={(v) => set("active", v)} trackColor={{ false: colors.border, true: colors.brandPrimary }} thumbColor="#fff" />
        </View>

        <Pressable testID="supform-save" onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Enregistrer</Text>}
        </Pressable>
        {editing && (
          <Pressable testID="supform-delete" onPress={remove} style={styles.deleteBtn}>
            <Text style={styles.deleteText}>Supprimer</Text>
          </Pressable>
        )}
      </KeyboardAwareScrollView>

      {/* Sélecteur d'hébergements (cases à cocher) */}
      <Modal visible={propsOpen} animationType="slide" transparent onRequestClose={() => setPropsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Hébergements</Text>
              <Pressable testID="supform-props-close" onPress={() => setPropsOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.modalHint}>Aucune case cochée = le supplément s'applique à tous les hébergements.</Text>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {properties.map((p) => {
                const on = form.property_ids.includes(p.id);
                return (
                  <Pressable key={p.id} testID={`supform-prop-${p.id}`} onPress={() => toggleProperty(p.id)} style={styles.propRow}>
                    <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.brandPrimary : colors.onSurfaceTertiary} />
                    <Text style={styles.propName} numberOfLines={1}>{p.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable testID="supform-props-done" onPress={() => setPropsOpen(false)} style={styles.saveBtn}>
              <Text style={styles.saveText}>Valider</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Chip({ testID, label, active, onPress }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  label: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: spacing.md, marginBottom: 6 },
  section: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginTop: spacing.xl },
  hint: { fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, marginTop: 2, marginBottom: spacing.sm, lineHeight: 16 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface },
  textarea: { minHeight: 90, textAlignVertical: "top" },
  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  photoPreview: { width: 84, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photoImg: { width: "100%", height: "100%" },
  photoBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: 10 },
  photoBtnText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary },
  photoRemove: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  photoRemoveText: { fontFamily: font.medium, fontSize: fontSize.xs, color: "#E5484D" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: 4 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "12" },
  chipText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.brandPrimary },
  dropdown: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 13 },
  dropdownText: { flex: 1, fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
  activeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg, paddingVertical: 4 },
  activeLabel: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  saveBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  saveText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
  deleteBtn: { marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: 13, alignItems: "center" },
  deleteText: { fontFamily: font.semibold, fontSize: fontSize.base, color: "#E5484D" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  modalHint: { fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: spacing.sm },
  propRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  propName: { flex: 1, fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
});
