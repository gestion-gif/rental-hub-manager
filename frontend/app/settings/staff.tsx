import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { Field, PrimaryButton } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function StaffScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", role: "", phone: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get("/staff")); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openNew() { setEditing(null); setForm({ name: "", role: "", phone: "" }); setModal(true); }
  function openEdit(s: any) { setEditing(s); setForm({ name: s.name, role: s.role || "", phone: s.phone || "" }); setModal(true); }

  async function save() {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      if (editing) await api.put(`/staff/${editing.id}`, form);
      else await api.post("/staff", form);
      setModal(false);
      await load();
    } catch {}
    setSaving(false);
  }
  async function remove(id: string) { await api.del(`/staff/${id}`); await load(); }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="staff-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Intervenants</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}
          ListEmptyComponent={<Text style={styles.empty}>Aucun intervenant. Ajoutez votre équipe ménage / technique.</Text>}
          renderItem={({ item }) => (
            <Pressable testID={`staff-${item.id}`} onPress={() => openEdit(item)} style={styles.row}>
              <View style={styles.avatar}><Ionicons name="person" size={18} color={colors.onSurfaceSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                {!!(item.role || item.phone) && <Text style={styles.rowSub}>{[item.role, item.phone].filter(Boolean).join(" · ")}</Text>}
              </View>
              <Pressable testID={`del-staff-${item.id}`} onPress={() => remove(item.id)} style={styles.trash}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </Pressable>
          )}
        />
      )}

      <Pressable testID="add-staff-fab" onPress={openNew} style={[styles.fab, { bottom: insets.bottom + 24 }]}>
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>

      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <View style={styles.modalWrap}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{editing ? "Modifier" : "Nouvel intervenant"}</Text>
              <Pressable testID="close-staff-modal" onPress={() => setModal(false)}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
            </View>
            <KeyboardAwareScrollView bottomOffset={20}>
              <Field label="Nom" testID="staff-name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Ex: Martine / Société Clean" />
              <Field label="Rôle (optionnel)" testID="staff-role" value={form.role} onChangeText={(v) => setForm((f) => ({ ...f, role: v }))} placeholder="Ménage, Technique, Jardinier..." />
              <Field label="Téléphone (optionnel)" testID="staff-phone" value={form.phone} onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="06 12 34 56 78" keyboardType="phone-pad" />
              <PrimaryButton testID="save-staff" label={editing ? "Enregistrer" : "Ajouter"} onPress={save} loading={saving} disabled={!form.name.trim()} />
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
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: 60, paddingHorizontal: spacing.xl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  rowSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  trash: { padding: 6 },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 6, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  sheetTitle: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
});
