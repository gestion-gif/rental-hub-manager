import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { Field, PrimaryButton } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function OwnersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get("/owners")); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openNew() { setForm({ name: "", email: "", phone: "", notes: "" }); setModal(true); }

  async function save() {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try { await api.post("/owners", form); setModal(false); await load(); } catch {}
    setSaving(false);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="owners-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Propriétaires</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}
          ListEmptyComponent={<Text style={styles.empty}>Aucun propriétaire. Ajoutez une fiche pour suivre les revenus par propriétaire.</Text>}
          renderItem={({ item }) => (
            <Pressable testID={`owner-${item.id}`} onPress={() => router.push(`/settings/owner/${item.id}`)} style={styles.row}>
              <View style={styles.avatar}><Ionicons name="person" size={18} color={colors.onSurfaceSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowSub}>{item.property_count} logement(s){item.email ? ` · ${item.email}` : ""}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          )}
        />
      )}

      <Pressable testID="add-owner-fab" onPress={openNew} style={[styles.fab, { bottom: insets.bottom + 24 }]}>
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>

      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <View style={styles.modalWrap}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Nouveau propriétaire</Text>
              <Pressable testID="close-owner-modal" onPress={() => setModal(false)}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
            </View>
            <KeyboardAwareScrollView bottomOffset={20}>
              <Field label="Nom" testID="owner-name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Ex: M. Dupont / SCI Azur" />
              <Field label="Email (optionnel)" testID="owner-email" value={form.email} onChangeText={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="contact@exemple.fr" autoCapitalize="none" keyboardType="email-address" />
              <Field label="Téléphone (optionnel)" testID="owner-phone" value={form.phone} onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="06 12 34 56 78" keyboardType="phone-pad" />
              <Field label="Notes (optionnel)" testID="owner-notes" value={form.notes} onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))} placeholder="Informations complémentaires" multiline style={styles.textarea} />
              <PrimaryButton testID="save-owner" label="Ajouter" onPress={save} loading={saving} disabled={!form.name.trim()} />
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
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 6, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "85%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  sheetTitle: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  textarea: { minHeight: 80, textAlignVertical: "top", paddingTop: 12 },
});
