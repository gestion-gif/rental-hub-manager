import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, ActivityIndicator, Alert } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function QuickReplies() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.get("/quick-replies"));
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openNew() {
    setEditing({}); setTitle(""); setBody("");
  }
  function openEdit(q: any) {
    setEditing(q); setTitle(q.title); setBody(q.body);
  }
  function close() {
    setEditing(null); setTitle(""); setBody("");
  }

  async function save() {
    if (!title.trim() || !body.trim() || saving) return;
    setSaving(true);
    try {
      if (editing?.id) {
        await api.put(`/quick-replies/${editing.id}`, { title, body });
      } else {
        await api.post("/quick-replies", { title, body });
      }
      close();
      await load();
    } catch {}
    setSaving(false);
  }

  function remove(q: any) {
    Alert.alert("Supprimer", `Supprimer « ${q.title} » ?`, [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => { await api.delete(`/quick-replies/${q.id}`); load(); } },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="qr-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Réponses types</Text>
        <Pressable testID="qr-add" onPress={openNew} style={styles.iconBtn}>
          <Ionicons name="add" size={24} color={colors.brandPrimary} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>Réponses réutilisables en un tap dans vos conversations (arrivée, wifi, parking…).</Text>
          {items.map((q) => (
            <View key={q.id} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{q.title}</Text>
                <Text style={styles.cardBody} numberOfLines={2}>{q.body}</Text>
              </View>
              <Pressable testID={`qr-edit-${q.id}`} onPress={() => openEdit(q)} style={styles.smallBtn}>
                <Ionicons name="create-outline" size={18} color={colors.onSurfaceSecondary} />
              </Pressable>
              <Pressable testID={`qr-del-${q.id}`} onPress={() => remove(q)} style={styles.smallBtn}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </View>
          ))}
          {items.length === 0 && <Text style={styles.empty}>Aucune réponse type. Appuyez sur + pour en créer une.</Text>}
        </ScrollView>
      )}

      {editing !== null && (
        <KeyboardAvoidingView behavior="padding" style={styles.modalWrap}>
          <Pressable style={styles.backdrop} onPress={close} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Text style={styles.sheetTitle}>{editing?.id ? "Modifier" : "Nouvelle réponse type"}</Text>
            <Text style={styles.label}>Titre</Text>
            <TextInput testID="qr-title" value={title} onChangeText={setTitle} placeholder="Ex : Wifi" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <Text style={styles.label}>Message</Text>
            <TextInput testID="qr-body" value={body} onChangeText={setBody} placeholder="Le message à insérer…" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.input, styles.inputMulti]} multiline />
            <Pressable testID="qr-save" onPress={save} disabled={saving || !title.trim() || !body.trim()} style={[styles.saveBtn, (saving || !title.trim() || !body.trim()) && { opacity: 0.5 }]}>
              {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Enregistrer</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  intro: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginBottom: spacing.md, lineHeight: 20 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  cardTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  cardBody: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  smallBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: 40 },
  modalWrap: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  sheetTitle: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface, marginBottom: spacing.md },
  label: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginBottom: 6, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface },
  inputMulti: { minHeight: 90, textAlignVertical: "top" },
  saveBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingVertical: 14, alignItems: "center" },
  saveText: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onBrandPrimary },
});
