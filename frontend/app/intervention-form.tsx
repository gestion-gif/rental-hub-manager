import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Switch } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { ensurePhotoAccess } from "@/src/utils/photoAccess";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api, uploadFile, fileUrl } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { canModify } from "@/src/permissions";
import { Field, PrimaryButton } from "@/src/components/ui";
import DateField from "@/src/components/DateField";
import { INTERVENTION_TYPES } from "@/src/interventionTypes";
import { InterventionIcon } from "@/src/components/InterventionIcon";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function InterventionForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { id, date: dateParam, property: propParam } = useLocalSearchParams<{ id?: string; date?: string; property?: string }>();
  const editing = !!id;

  const [props, setProps] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    property_id: propParam || "",
    kind: "menage",
    date: dateParam || "",
    description: "",
    not_done_reason: "",
  });
  const [intervenants, setIntervenants] = useState<string[]>([]);
  const [customName, setCustomName] = useState("");
  const [cautionAmount, setCautionAmount] = useState("");
  const [cautionDebited, setCautionDebited] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [pr, st] = await Promise.all([api.get("/properties"), api.get("/staff")]);
        setProps(pr);
        setStaff(st);
        if (editing) {
          const list = await api.get("/interventions");
          const iv = list.find((x: any) => x.id === id);
          if (iv) {
            setForm({
              property_id: iv.property_id,
              kind: iv.kind || "menage",
              date: iv.date,
              description: iv.description || "",
              not_done_reason: iv.not_done_reason || "",
            });
            setIntervenants(
              (iv.intervenants && iv.intervenants.length)
                ? iv.intervenants
                : (iv.intervenant ? [iv.intervenant] : [])
            );
            setCautionAmount(iv.caution_amount ? String(iv.caution_amount) : "");
            setCautionDebited(!!iv.caution_debited);
            setPhotos(iv.photos || []);
          }
        } else if (pr.length && !propParam) {
          setForm((f) => ({ ...f, property_id: pr[0].id }));
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.property_id && form.date;

  async function pickPhotos() {
    if (!(await ensurePhotoAccess())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.6,
    });
    if (result.canceled) return;
    setUploading(true);
    for (const asset of result.assets) {
      try {
        const name = asset.fileName || `etat_${Date.now()}.jpg`;
        const path = await uploadFile(asset.uri, name, asset.mimeType || "image/jpeg");
        setPhotos((p) => [...p, path]);
      } catch {}
    }
    setUploading(false);
  }

  async function save(markDone = false) {
    if (!valid || saving) return;
    setSaving(true);
    const payload = {
      ...form,
      intervenants,
      caution_amount: parseFloat(cautionAmount) || 0,
      caution_debited: cautionDebited,
      photos,
      done: markDone,
    };
    try {
      if (editing) await api.put(`/interventions/${id}`, payload);
      else await api.post("/interventions", payload);
      router.back();
    } catch {
      setSaving(false);
    }
  }

  async function remove() {
    await api.del(`/interventions/${id}`);
    router.back();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>{editing ? "Modifier l'intervention" : "Nouvelle intervention"}</Text>
        <Pressable testID="close-intervention-form" onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      {props.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.hint}>Ajoutez d'abord un logement.</Text>
        </View>
      ) : (
        <KeyboardAwareScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
          bottomOffset={20}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.label}>Type d'intervention</Text>
          <View style={styles.typeRow}>
            {INTERVENTION_TYPES.map((t) => {
              const active = form.kind === t.key;
              return (
                <Pressable
                  key={t.key}
                  testID={`intervention-kind-${t.key}`}
                  onPress={() => set("kind", t.key)}
                  style={[styles.typeCard, active && { borderColor: t.color, backgroundColor: t.color + "1A" }]}
                >
                  <InterventionIcon kind={t.key} size={18} color={t.color} />
                  <Text style={[styles.typeLabel, active && { color: t.color }]}>{t.label}</Text>
                  {active && <Ionicons name="checkmark-circle" size={18} color={t.color} />}
                </Pressable>
              );
            })}
          </View>

          <View style={{ height: spacing.lg }} />
          <Text style={styles.label}>Logement</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {props.map((p) => {
              const active = form.property_id === p.id;
              return (
                <Pressable
                  key={p.id}
                  testID={`intervention-prop-${p.id}`}
                  onPress={() => set("property_id", p.id)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{p.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={{ height: spacing.lg }} />
          <DateField label="Date" testID="intervention-date" value={form.date} onChange={(v) => set("date", v)} />
          {staff.length > 0 && (
            <>
              <Text style={styles.label}>Intervenants</Text>
              <View style={styles.staffWrap}>
                {staff.map((s) => {
                  const active = intervenants.includes(s.name);
                  return (
                    <Pressable
                      key={s.id}
                      testID={`staff-chip-${s.id}`}
                      onPress={() => setIntervenants((cur) => active ? cur.filter((n) => n !== s.name) : [...cur, s.name])}
                      style={[styles.staffChip, active && styles.staffChipActive]}
                    >
                      {active && <Ionicons name="checkmark" size={14} color={colors.onBrandPrimary} />}
                      <Text style={[styles.staffChipText, active && styles.staffChipTextActive]} numberOfLines={1}>{s.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
          <Text style={styles.label}>{staff.length > 0 ? "Ajouter un autre intervenant" : "Intervenant"}</Text>
          <View style={styles.addRow}>
            <View style={{ flex: 1 }}>
              <Field label="" testID="intervention-intervenant" value={customName} onChangeText={setCustomName} placeholder="Nom de l'intervenant / société" />
            </View>
            <Pressable
              testID="add-intervenant"
              onPress={() => { const n = customName.trim(); if (n && !intervenants.includes(n)) { setIntervenants((c) => [...c, n]); setCustomName(""); } }}
              style={styles.addBtn}
            >
              <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
            </Pressable>
          </View>
          {intervenants.length > 0 && (
            <View style={styles.selectedWrap}>
              {intervenants.map((n) => (
                <View key={n} style={styles.selectedChip}>
                  <Text style={styles.selectedChipText}>{n}</Text>
                  <Pressable testID={`remove-intervenant-${n}`} onPress={() => setIntervenants((c) => c.filter((x) => x !== n))} hitSlop={6}>
                    <Ionicons name="close-circle" size={16} color={colors.onSurfaceTertiary} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {form.kind === "caution" && (
            <View style={styles.cautionBox}>
              <Field label="Montant de la caution (€)" testID="caution-amount" value={cautionAmount} onChangeText={setCautionAmount} keyboardType="decimal-pad" placeholder="0" />
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchTitle}>Caution débitée</Text>
                  <Text style={styles.switchSub}>Activez si vous retenez tout ou partie de la caution</Text>
                </View>
                <Switch testID="caution-debited" value={cautionDebited} onValueChange={setCautionDebited} trackColor={{ true: colors.error, false: colors.surfaceTertiary }} />
              </View>
              {cautionDebited && (
                <>
                  <Text style={styles.label}>Photos de l'état des lieux</Text>
                  <View style={styles.photoGrid}>
                    {photos.map((p, i) => (
                      <View key={p} style={styles.photoWrap}>
                        <Image source={{ uri: fileUrl(p) }} style={styles.photo} contentFit="cover" />
                        <Pressable testID={`remove-photo-${i}`} onPress={() => setPhotos((ph) => ph.filter((x) => x !== p))} style={styles.photoDel}>
                          <Ionicons name="close-circle" size={20} color="#fff" />
                        </Pressable>
                      </View>
                    ))}
                    <Pressable testID="add-photo" onPress={pickPhotos} style={styles.addPhoto} disabled={uploading}>
                      {uploading ? <ActivityIndicator color={colors.brandPrimary} /> : <Ionicons name="camera-outline" size={26} color={colors.onSurfaceSecondary} />}
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          )}
          <Field label="Description" testID="intervention-description" value={form.description} onChangeText={(v) => set("description", v)} placeholder="Détail de l'intervention..." multiline style={styles.textarea} />
          <Field label="Motif si non exécutée (optionnel)" testID="intervention-reason" value={form.not_done_reason} onChangeText={(v) => set("not_done_reason", v)} placeholder="Ex: accès impossible, reporté..." multiline style={styles.textarea} />

          <PrimaryButton
            testID="save-intervention"
            label={editing ? "Enregistrer / Reporter" : "Ajouter au calendrier"}
            onPress={() => save(false)}
            loading={saving}
            disabled={!valid || !canModify(user)}
          />
          {editing && canModify(user) && (
            <PrimaryButton
              testID="validate-intervention"
              label="Valider (retirer du calendrier)"
              onPress={() => save(true)}
              variant="secondary"
              style={{ marginTop: spacing.md }}
              icon={<Ionicons name="checkmark-circle" size={18} color={colors.onSurface} />}
            />
          )}
          {editing && canModify(user) && (
            <PrimaryButton
              testID="delete-intervention"
              label="Supprimer"
              onPress={remove}
              variant="danger"
              style={{ marginTop: spacing.md, backgroundColor: colors.surfaceSecondary }}
            />
          )}
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface, flex: 1 },
  closeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  label: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  typeRow: { flexDirection: "row", gap: spacing.md },
  typeCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  typeDot: { width: 12, height: 12, borderRadius: 999 },
  typeLabel: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface, flex: 1 },
  chipRow: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    flexShrink: 0,
    maxWidth: 180,
    height: 38,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.onBrandPrimary },
  staffWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  staffChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.surfaceSecondary },
  staffChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  staffChipText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, maxWidth: 160 },
  staffChipTextActive: { color: colors.onBrandPrimary },
  addRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  addBtn: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  selectedWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs, marginBottom: spacing.md },
  selectedChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill },
  selectedChipText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  cautionBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  switchTitle: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  switchSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  photoWrap: { width: 84, height: 84, borderRadius: radius.md, overflow: "hidden" },
  photo: { width: "100%", height: "100%" },
  photoDel: { position: "absolute", top: 2, right: 2, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 12 },
  addPhoto: { width: 84, height: 84, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  textarea: { minHeight: 90, textAlignVertical: "top", paddingTop: 12 },
  hint: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
});
