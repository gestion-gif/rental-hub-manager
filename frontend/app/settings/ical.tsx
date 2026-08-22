import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { Picker } from "@/src/components/Picker";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const PLATFORMS = [
  { id: "Airbnb", name: "Airbnb" },
  { id: "Booking.com", name: "Booking.com" },
  { id: "Vrbo", name: "Vrbo" },
  { id: "Autre", name: "Autre" },
];

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;

export default function IcalSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [properties, setProperties] = useState<any[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [links, setLinks] = useState<{ platform: string; url: string }[]>([]);
  const [exportUrl, setExportUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>("");
  // new link draft
  const [draftPlatform, setDraftPlatform] = useState("Airbnb");
  const [draftUrl, setDraftUrl] = useState("");

  const load = useCallback(async () => {
    try {
      const props = await api.get("/properties");
      setProperties(props);
      if (props.length && !selected) selectProperty(props[0], props);
    } catch {}
    setLoading(false);
  }, [selected]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function selectProperty(prop: any, list = properties) {
    const p = (list.find((x) => x.id === prop.id) || prop);
    setSelected(p.id);
    setLinks((p.ical_links || []).map((l: any) => ({ platform: l.platform || "Autre", url: l.url || "" })));
    setSyncMsg("");
    try {
      const ex = await api.get(`/properties/${p.id}/ical-export`);
      setExportUrl(`${BASE}${ex.path}`);
    } catch {
      setExportUrl("");
    }
  }

  function addDraft() {
    if (!draftUrl.trim()) {
      Alert.alert("Lien requis", "Collez l'URL du calendrier .ics à importer.");
      return;
    }
    setLinks((l) => [...l, { platform: draftPlatform, url: draftUrl.trim() }]);
    setDraftUrl("");
  }

  function removeLink(i: number) {
    setLinks((l) => l.filter((_, idx) => idx !== i));
  }

  async function saveLinks() {
    if (saving) return;
    setSaving(true);
    try {
      await api.put(`/properties/${selected}/ical-links`, { links });
      // refresh local property copy
      setProperties((ps) => ps.map((p) => (p.id === selected ? { ...p, ical_links: links } : p)));
      Alert.alert("Enregistré", "Vos liens d'import iCal ont été enregistrés.");
    } catch {
      Alert.alert("Erreur", "Enregistrement impossible.");
    }
    setSaving(false);
  }

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg("");
    try {
      await api.put(`/properties/${selected}/ical-links`, { links });
      const res = await api.post(`/properties/${selected}/sync`, {});
      const parts: string[] = [];
      if (typeof res.imported === "number") parts.push(`${res.imported} importée(s)`);
      if (typeof res.updated === "number") parts.push(`${res.updated} mise(s) à jour`);
      const errs = (res.errors || []).length ? ` · ${res.errors.join(" ")}` : "";
      setSyncMsg((parts.join(" · ") || "Terminé") + errs);
    } catch {
      setSyncMsg("Échec de la synchronisation.");
    }
    setSyncing(false);
  }

  async function copyExport() {
    if (!exportUrl) return;
    await Clipboard.setStringAsync(exportUrl);
    Alert.alert("Copié", "Le lien d'export a été copié. Collez-le dans Airbnb/Booking pour importer votre disponibilité.");
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <Header insets={insets} onBack={() => router.back()} />
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      </View>
    );
  }

  const selectedProp = properties.find((p) => p.id === selected);

  return (
    <View style={styles.container}>
      <Header insets={insets} onBack={() => router.back()} />
      <KeyboardAwareScrollView
        bottomOffset={20}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>Import / Export des calendriers</Text>
        <Text style={styles.introSub}>Synchronisez la disponibilité de vos logements avec Airbnb, Booking et autres via des liens iCal (.ics).</Text>

        {properties.length === 0 ? (
          <Text style={styles.empty}>Aucun logement. Ajoutez un logement pour configurer la synchronisation iCal.</Text>
        ) : (
          <>
            <Picker
              label="Logement"
              testID="ical-property-picker"
              title="Choisir un logement"
              value={selected}
              items={properties.map((p) => ({ id: p.id, name: p.name }))}
              onSelect={(id) => { const p = properties.find((x) => x.id === id); if (p) selectProperty(p); }}
            />

            {/* EXPORT */}
            <View style={styles.sectionHead}>
              <Ionicons name="arrow-up-circle-outline" size={18} color={colors.onSurface} />
              <Text style={styles.sectionTitle}>Exporter ce calendrier</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.hint}>Partagez ce lien sur Airbnb / Booking pour qu'ils bloquent les dates réservées ici.</Text>
              <View style={styles.urlBox}>
                <Text style={styles.urlText} numberOfLines={2} selectable>{exportUrl || "…"}</Text>
              </View>
              <Pressable testID="copy-export" onPress={copyExport} style={styles.copyBtn}>
                <Ionicons name="copy-outline" size={16} color={colors.onBrandPrimary} />
                <Text style={styles.copyText}>Copier le lien d'export</Text>
              </Pressable>
            </View>

            {/* IMPORT */}
            <View style={styles.sectionHead}>
              <Ionicons name="arrow-down-circle-outline" size={18} color={colors.onSurface} />
              <Text style={styles.sectionTitle}>Importer des calendriers</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.hint}>Collez les liens iCal exportés par les plateformes pour importer leurs réservations ici.</Text>

              {links.length === 0 && <Text style={styles.noLinks}>Aucun lien d'import pour l'instant.</Text>}
              {links.map((l, i) => (
                <View key={i} style={styles.linkRow} testID={`ical-link-${i}`}>
                  <View style={styles.platTag}><Text style={styles.platText}>{l.platform}</Text></View>
                  <Text style={styles.linkUrl} numberOfLines={1}>{l.url}</Text>
                  <Pressable testID={`remove-link-${i}`} onPress={() => removeLink(i)} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color={colors.error} />
                  </Pressable>
                </View>
              ))}

              {/* add draft */}
              <View style={styles.divider} />
              <Picker
                label="Plateforme"
                testID="ical-draft-platform"
                title="Plateforme du lien"
                value={draftPlatform}
                items={PLATFORMS}
                onSelect={setDraftPlatform}
              />
              <Text style={styles.fieldLabel}>Lien iCal (.ics)</Text>
              <TextInput
                testID="ical-draft-url"
                value={draftUrl}
                onChangeText={setDraftUrl}
                placeholder="https://www.airbnb.com/calendar/ical/....ics"
                placeholderTextColor={colors.onSurfaceTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <Pressable testID="add-link" onPress={addDraft} style={styles.addBtn}>
                <Ionicons name="add" size={18} color={colors.onSurface} />
                <Text style={styles.addText}>Ajouter ce lien</Text>
              </Pressable>
            </View>

            <View style={styles.actions}>
              <Pressable testID="save-links" onPress={saveLinks} style={[styles.actionBtn, styles.actionSecondary]}>
                {saving ? <ActivityIndicator color={colors.onSurface} /> : <Text style={styles.actionSecondaryText}>Enregistrer</Text>}
              </Pressable>
              <Pressable testID="sync-now" onPress={syncNow} style={[styles.actionBtn, styles.actionPrimary]}>
                {syncing ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                  <>
                    <Ionicons name="sync" size={16} color={colors.onBrandPrimary} />
                    <Text style={styles.actionPrimaryText}>Synchroniser</Text>
                  </>
                )}
              </Pressable>
            </View>
            {!!syncMsg && <Text style={styles.syncMsg}>{syncMsg}</Text>}
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

function Header({ insets, onBack }: any) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="ical-back" onPress={onBack} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title}>Import / Export iCal</Text>
      <View style={{ width: 34 }} />
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
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: 40 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  hint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, lineHeight: 18, marginBottom: spacing.md },
  urlBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  urlText: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurface },
  copyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12 },
  copyText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
  noLinks: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginBottom: spacing.sm },
  linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 10 },
  platTag: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  platText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  linkUrl: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  fieldLabel: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, marginBottom: spacing.md },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: 12 },
  addText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radius.md, paddingVertical: 14 },
  actionSecondary: { backgroundColor: colors.surfaceSecondary },
  actionSecondaryText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  actionPrimary: { backgroundColor: colors.brandPrimary },
  actionPrimaryText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
  syncMsg: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: spacing.md, textAlign: "center" },
});
