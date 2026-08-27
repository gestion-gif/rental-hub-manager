import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal, TextInput, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";
import dayjs from "dayjs";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function AccessTokensScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      setKeys(await api.get("/api-keys"));
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Chargement impossible");
    }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function revoke(k: any) {
    Alert.alert("Révoquer la clé", `« ${k.label} » ne fonctionnera plus immédiatement. Continuer ?`, [
      { text: "Annuler", style: "cancel" },
      { text: "Révoquer", style: "destructive", onPress: async () => { await api.del(`/api-keys/${k.id}`); load(); } },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="tokens-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Clés API</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
          <View style={styles.infoCard}>
            <Ionicons name="key-outline" size={20} color={colors.brandPrimary} />
            <Text style={styles.infoText}>
              Une clé API permet à une application externe (ex. votre version web PC) d’accéder à
              vos données Casanéo sans connexion Google. Envoyez-la dans le header{" "}
              <Text style={styles.mono}>Authorization: Bearer csk_…</Text>
            </Text>
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Text style={styles.section}>Clés actives</Text>
          {keys.length === 0 ? (
            <View style={styles.card}><Text style={styles.empty}>Aucune clé API. Créez-en une ci-dessous.</Text></View>
          ) : keys.map((k) => (
            <View key={k.id} style={styles.keyCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.keyLabel}>{k.label}</Text>
                <Text style={styles.keyValue}>{k.key_prefix}…{k.key_last4}</Text>
                <Text style={styles.keyMeta}>
                  Créée le {dayjs(k.created_at).format("DD/MM/YYYY")}
                  {k.last_used_at ? ` · Utilisée le ${dayjs(k.last_used_at).format("DD/MM/YYYY HH:mm")}` : " · Jamais utilisée"}
                </Text>
              </View>
              <Pressable testID={`token-revoke-${k.id}`} onPress={() => revoke(k)} hitSlop={8} style={styles.revokeBtn}>
                <Ionicons name="trash-outline" size={17} color="#E5484D" />
              </Pressable>
            </View>
          ))}

          <Pressable testID="token-create" onPress={() => setCreateOpen(true)} style={styles.createBtn}>
            <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.createText}>Créer une clé API</Text>
          </Pressable>

          <Text style={styles.hint}>
            ⚠️ Traitez chaque clé comme un mot de passe : ne la partagez jamais publiquement.
            En cas de doute, révoquez-la et créez-en une nouvelle.
          </Text>
        </ScrollView>
      )}

      <CreateKeyModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(k: any) => { setCreateOpen(false); setNewKey(k); load(); }}
      />
      <ShowKeyModal newKey={newKey} onClose={() => setNewKey(null)} />
    </View>
  );
}

function CreateKeyModal({ open, onClose, onCreated }: any) {
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => { if (open) setLabel(""); }, [open]);

  async function create() {
    setSaving(true);
    try {
      const k = await api.post("/api-keys", { label: label.trim() || "Version web PC" });
      onCreated(k);
    } catch (e: any) { Alert.alert("Erreur", e?.message || "Création impossible."); }
    setSaving(false);
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Nouvelle clé API</Text>
            <Pressable onPress={onClose}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
          </View>
          <Text style={styles.mLabel}>Nom de la clé (pour vous y retrouver)</Text>
          <TextInput
            testID="token-label"
            value={label}
            onChangeText={setLabel}
            placeholder="Version web PC"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.mInput}
          />
          <Pressable testID="token-save" onPress={create} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Générer la clé</Text>}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ShowKeyModal({ newKey, onClose }: any) {
  const [copied, setCopied] = useState(false);

  React.useEffect(() => { if (newKey) setCopied(false); }, [newKey]);

  async function copy() {
    if (!newKey?.key) return;
    await Clipboard.setStringAsync(newKey.key);
    setCopied(true);
  }

  return (
    <Modal visible={!!newKey} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.centerBackdrop}>
        <View style={styles.keyBox}>
          <Ionicons name="key" size={28} color={colors.brandPrimary} style={{ alignSelf: "center" }} />
          <Text style={styles.keyBoxTitle}>Clé créée !</Text>
          <Text style={styles.keyBoxWarn}>
            Copiez-la maintenant : elle ne sera plus jamais affichée.
          </Text>
          <View style={styles.rawKeyBox}>
            <Text testID="token-raw" style={styles.rawKey} selectable>{newKey?.key}</Text>
          </View>
          <Pressable testID="token-copy" onPress={copy} style={[styles.copyBtn, copied && styles.copyBtnDone]}>
            <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={colors.onBrandPrimary} />
            <Text style={styles.copyText}>{copied ? "Copiée !" : "Copier la clé"}</Text>
          </Pressable>
          <Pressable testID="token-close" onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>J’ai bien copié ma clé — Fermer</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  infoCard: { flexDirection: "row", gap: spacing.md, backgroundColor: colors.brandPrimary + "0F", borderWidth: 1, borderColor: colors.brandPrimary + "33", borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, alignItems: "flex-start" },
  infoText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 19 },
  mono: { fontFamily: font.semibold, color: colors.onSurface },
  error: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.error, marginBottom: spacing.sm },
  section: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.md, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center" },
  keyCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  keyLabel: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  keyValue: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  keyMeta: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  revokeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#E5484D14", alignItems: "center", justifyContent: "center" },
  createBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.lg, paddingVertical: 14, marginTop: spacing.md },
  createText: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onBrandPrimary },
  hint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: spacing.md, lineHeight: 18 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: 40 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  sheetTitle: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  mLabel: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginBottom: 6 },
  mInput: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, marginBottom: spacing.md },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.lg, paddingVertical: 15, alignItems: "center" },
  saveText: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onBrandPrimary },
  centerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  keyBox: { width: "100%", maxWidth: 420, backgroundColor: colors.surface, borderRadius: 20, padding: spacing.lg },
  keyBoxTitle: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface, textAlign: "center", marginTop: spacing.sm },
  keyBoxWarn: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.error, textAlign: "center", marginTop: 4, marginBottom: spacing.md },
  rawKeyBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  rawKey: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurface },
  copyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.lg, paddingVertical: 13 },
  copyBtnDone: { backgroundColor: "#17B0A6" },
  copyText: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onBrandPrimary },
  closeBtn: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  closeText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
});
