import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal, Switch, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { Field, PrimaryButton } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const PALETTE = ["#30D158", "#0A84FF", "#BF5AF2", "#FF9500", "#FF375F", "#5E5CE6", "#64D2FF", "#FFD60A", "#AC8E68", "#8E8E93"];

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ name: "", body: "", color: PALETTE[1], trigger_days: 3, enabled: false });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get("/message-templates")); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openNew() {
    setEditing(null);
    setForm({ name: "", body: "", color: PALETTE[1], trigger_days: 3, enabled: false });
    setModal(true);
  }
  function openEdit(t: any) {
    setEditing(t);
    setForm({ name: t.name, body: t.body || "", color: t.color, trigger_days: t.trigger_days ?? 3, enabled: !!t.enabled, kind: t.kind, trigger_event: t.trigger_event });
    setModal(true);
  }

  async function toggleEnabled(t: any, val: boolean) {
    await api.put(`/message-templates/${t.id}`, { ...t, enabled: val });
    await load();
  }

  async function save() {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      body: form.body,
      color: form.color,
      trigger_event: editing?.kind === "payment" ? "payment" : "before_arrival",
      trigger_days: parseInt(String(form.trigger_days)) || 0,
      enabled: form.enabled,
    };
    try {
      if (editing) await api.put(`/message-templates/${editing.id}`, payload);
      else await api.post("/message-templates", payload);
      setModal(false);
      await load();
    } catch {}
    setSaving(false);
  }

  function remove(t: any) {
    Alert.alert("Supprimer", `Supprimer le modèle "${t.name}" ?`, [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => { await api.del(`/message-templates/${t.id}`); await load(); } },
    ]);
  }

  const isPayment = editing?.kind === "payment";

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="messages-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Messages automatiques</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}>
          <Text style={styles.intro}>
            Chaque modèle a une couleur qui s'applique à la réservation dans le calendrier lorsqu'il est atteint. Les messages activés sont envoyés automatiquement au voyageur avant l'arrivée.
          </Text>
          {items.map((t) => (
            <Pressable key={t.id} testID={`tpl-${t.id}`} onPress={() => openEdit(t)} style={styles.row}>
              <View style={[styles.colorDot, { backgroundColor: t.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{t.name}</Text>
                <Text style={styles.rowSub}>
                  {t.kind === "payment" ? "Auto — quand la réservation est payée" : `Auto — ${t.trigger_days} j avant l'arrivée`}
                </Text>
              </View>
              {t.kind === "payment" ? (
                <View style={styles.autoTag}><Text style={styles.autoTagText}>Toujours</Text></View>
              ) : (
                <Switch
                  testID={`tpl-toggle-${t.id}`}
                  value={!!t.enabled}
                  onValueChange={(v) => toggleEnabled(t, v)}
                  trackColor={{ true: colors.brandPrimary, false: colors.surfaceTertiary }}
                />
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Pressable testID="add-tpl-fab" onPress={openNew} style={[styles.fab, { bottom: insets.bottom + 24 }]}>
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>

      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <View style={styles.modalWrap}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{editing ? "Modifier le modèle" : "Nouveau modèle"}</Text>
              <Pressable testID="close-tpl-modal" onPress={() => setModal(false)}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
            </View>
            <KeyboardAwareScrollView bottomOffset={20} showsVerticalScrollIndicator={false}>
              <Field label="Nom du marqueur" testID="tpl-name" value={form.name} onChangeText={(v: string) => setForm((f: any) => ({ ...f, name: v }))} placeholder="Ex: Livret d'accueil" />
              <Text style={styles.label}>Couleur</Text>
              <View style={styles.palette}>
                {PALETTE.map((c) => (
                  <Pressable key={c} testID={`tpl-color-${c}`} onPress={() => setForm((f: any) => ({ ...f, color: c }))} style={[styles.swatch, { backgroundColor: c }, form.color === c && styles.swatchActive]}>
                    {form.color === c && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </Pressable>
                ))}
              </View>
              {!isPayment && (
                <>
                  <Field label="Message envoyé au voyageur" testID="tpl-body" value={form.body} onChangeText={(v: string) => setForm((f: any) => ({ ...f, body: v }))} placeholder="Utilisez {guest}, {property}, {welcome_book}, {caution}" multiline style={styles.textarea} />
                  <Text style={styles.varHint}>Variables : {"{guest}"} (voyageur), {"{property}"} (logement), {"{welcome_book}"} (lien du livret d'accueil), {"{caution}"} (lien de paiement de la caution)</Text>
                  <Field label="Envoyer combien de jours avant l'arrivée ?" testID="tpl-days" value={String(form.trigger_days)} onChangeText={(v: string) => setForm((f: any) => ({ ...f, trigger_days: v.replace(/[^0-9]/g, "") }))} keyboardType="number-pad" placeholder="3" />
                  <View style={styles.switchRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>Envoi automatique activé</Text>
                      <Text style={styles.rowSub}>Le message part seul au voyageur via Lodgify</Text>
                    </View>
                    <Switch testID="tpl-enabled" value={!!form.enabled} onValueChange={(v) => setForm((f: any) => ({ ...f, enabled: v }))} trackColor={{ true: colors.brandPrimary, false: colors.surfaceTertiary }} />
                  </View>
                </>
              )}
              <PrimaryButton testID="save-tpl" label={editing ? "Enregistrer" : "Créer"} onPress={save} loading={saving} disabled={!form.name.trim()} />
              {editing && !isPayment && (
                <PrimaryButton testID="delete-tpl" label="Supprimer" onPress={() => remove(editing)} variant="danger" style={{ marginTop: spacing.md, backgroundColor: colors.surfaceSecondary }} />
              )}
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  intro: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, lineHeight: 20, marginBottom: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  colorDot: { width: 16, height: 16, borderRadius: 8 },
  rowTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  rowSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  autoTag: { backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill },
  autoTagText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 6, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "88%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  sheetTitle: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  label: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  palette: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  swatchActive: { borderWidth: 3, borderColor: colors.onSurface },
  textarea: { minHeight: 90, textAlignVertical: "top", paddingTop: 12 },
  varHint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: -6, marginBottom: spacing.md },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.lg },
});
