import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api, ApiError } from "@/src/api";
import { Field, PrimaryButton } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const ICAL_PLATFORMS = ["Airbnb", "Booking.com", "Vrbo", "Autre"];

/* ------------------------------------------------------------------ */
/* Global view: Lodgify connection + inbox + per-property iCal list    */
/* ------------------------------------------------------------------ */
function GlobalView({ insets, router }: any) {
  const [props, setProps] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([
        api.get("/properties"),
        api.get("/channel/status"),
      ]);
      setProps(list);
      setStatus(st);
    } catch {}
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function connect() {
    if (!apiKey.trim()) return;
    setBusy("connect"); setMsg(null);
    try {
      const r = await api.post("/channel/connect", { api_key: apiKey.trim() });
      setApiKey("");
      setMsg({ type: "ok", text: `Connecté · ${r.properties_count} logement(s) Lodgify détecté(s)` });
      await load();
    } catch (e: any) {
      setMsg({ type: "err", text: e instanceof ApiError ? e.message : "Échec de la connexion" });
    }
    setBusy(null);
  }

  async function disconnect() {
    setBusy("disconnect"); setMsg(null);
    try { await api.post("/channel/disconnect"); setMsg({ type: "ok", text: "Déconnecté de Lodgify" }); await load(); }
    catch { setMsg({ type: "err", text: "Échec" }); }
    setBusy(null);
  }

  async function importProps() {
    setBusy("import"); setMsg(null);
    try {
      const r = await api.post("/channel/import-properties");
      setMsg({ type: "ok", text: r.imported > 0 ? `${r.imported} logement(s) importé(s)` : "Tous les logements sont déjà importés" });
      await load();
    } catch (e: any) { setMsg({ type: "err", text: e instanceof ApiError ? e.message : "Échec de l'import" }); }
    setBusy(null);
  }

  async function sync() {
    setBusy("sync"); setMsg(null);
    try {
      const r = await api.post("/channel/sync");
      const parts = [`${r.imported} importée(s)`, `${r.updated} mise(s) à jour`];
      if (r.unmapped) parts.push(`${r.unmapped} ignorée(s)`);
      setMsg({ type: "ok", text: parts.join(" · ") });
      await load();
    } catch (e: any) { setMsg({ type: "err", text: e instanceof ApiError ? e.message : "Échec de la synchronisation" }); }
    setBusy(null);
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  }

  const connected = !!status?.connected;

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
      bottomOffset={20}
      showsVerticalScrollIndicator={false}
    >
      {/* Inbox entry */}
      <Pressable testID="open-inbox" onPress={() => router.push("/inbox")} style={styles.inboxCard}>
        <View style={styles.inboxIcon}><Ionicons name="mail" size={20} color={colors.onBrandPrimary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.inboxTitle}>Boîte de réception</Text>
          <Text style={styles.inboxSub}>Messages voyageurs Airbnb, Booking, Vrbo</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
      </Pressable>

      {/* Lodgify connection */}
      <Text style={styles.sectionTitle}>Connexion Lodgify</Text>
      {connected ? (
        <View style={styles.connCard}>
          <View style={styles.connTop}>
            <View style={styles.connDot} />
            <Text style={styles.connStatus}>Connecté à Lodgify</Text>
          </View>
          <Text style={styles.connMeta}>{status.properties_count} logement(s) Lodgify · {status.mapped_count} lié(s) dans l'app</Text>
          {!!status.last_sync && (
            <Text style={styles.connMeta}>Dernière synchro : {new Date(status.last_sync).toLocaleString("fr-FR")}</Text>
          )}
          <View style={{ height: spacing.md }} />
          <PrimaryButton testID="import-props" label="Importer les logements Lodgify" onPress={importProps} loading={busy === "import"} variant="secondary" icon={<Ionicons name="download-outline" size={16} color={colors.onSurface} />} />
          <View style={{ height: spacing.sm }} />
          <PrimaryButton testID="sync-reservations" label="Synchroniser les réservations" onPress={sync} loading={busy === "sync"} icon={<Ionicons name="sync" size={16} color={colors.onBrandPrimary} />} />
          <View style={{ height: spacing.sm }} />
          <PrimaryButton testID="disconnect" label="Déconnecter" onPress={disconnect} loading={busy === "disconnect"} variant="danger" />
        </View>
      ) : (
        <View style={styles.addBox}>
          <Text style={styles.sectionHint}>
            Connectez votre compte Lodgify pour synchroniser automatiquement vos réservations et messages Airbnb / Booking / Vrbo.
          </Text>
          <View style={{ height: spacing.md }} />
          <Field label="Clé API Lodgify" testID="lodgify-key" value={apiKey} onChangeText={setApiKey} placeholder="Collez votre clé API" autoCapitalize="none" secureTextEntry />
          <PrimaryButton testID="connect-lodgify" label="Connecter" onPress={connect} loading={busy === "connect"} icon={<Ionicons name="link" size={16} color={colors.onBrandPrimary} />} />
        </View>
      )}
      {!!msg && (
        <Text testID="channel-msg" style={[styles.resultMsg, { color: msg.type === "ok" ? colors.success : colors.error }]}>{msg.text}</Text>
      )}

      {/* Per-property iCal */}
      <Text style={styles.sectionTitle}>Synchronisation iCal par logement</Text>
      <Text style={styles.sectionHint}>Pour les plateformes non gérées par Lodgify, ajoutez un lien iCal (.ics) sur un logement.</Text>
      <View style={{ height: spacing.md }} />
      {props.map((p) => (
        <Pressable key={p.id} testID={`cm-prop-${p.id}`} onPress={() => router.push(`/channel-manager?property=${p.id}`)} style={styles.propRow}>
          <Ionicons name="business-outline" size={18} color={colors.onSurfaceSecondary} />
          <Text style={styles.propName} numberOfLines={1}>{p.name}</Text>
          <View style={styles.countPill}><Text style={styles.countText}>{(p.ical_links || []).length}</Text></View>
          <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
        </Pressable>
      ))}
      {props.length === 0 && <Text style={styles.intro}>Ajoutez d'abord un logement.</Text>}
    </KeyboardAwareScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Per-property iCal management                                        */
/* ------------------------------------------------------------------ */
function PropertyView({ property, insets }: any) {
  const [prop, setProp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [icalPlatform, setIcalPlatform] = useState("Airbnb");
  const [icalUrl, setIcalUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setProp(await api.get(`/properties/${property}`)); } catch {}
    setLoading(false);
  }, [property]);

  useEffect(() => { load(); }, [load]);

  async function persist(next: any) {
    setProp(next);
    await api.put(`/properties/${property}`, {
      name: next.name, location: next.location, image_url: next.image_url,
      base_price: next.base_price, capacity: next.capacity, bedrooms: next.bedrooms,
      owner: next.owner || "", surface: next.surface || 0, address: next.address || "",
      postal_code: next.postal_code || "", city: next.city || "",
      address_complement: next.address_complement || "", description: next.description || "",
      rooms: next.rooms || [], amenities: next.amenities || [],
      seasons: next.seasons || [], ical_links: next.ical_links || [],
    });
  }
  function addIcal() {
    if (!icalUrl.trim()) return;
    persist({ ...prop, ical_links: [...(prop.ical_links || []), { platform: icalPlatform, url: icalUrl.trim() }] });
    setIcalUrl("");
  }
  function removeIcal(idx: number) {
    persist({ ...prop, ical_links: prop.ical_links.filter((_: any, i: number) => i !== idx) });
  }
  async function syncIcal() {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await api.post(`/properties/${property}/sync`);
      setSyncMsg((r.details && r.details.length) ? r.details.join("\n") : `${r.imported} importée(s), ${r.updated} maj`);
      await load();
    } catch { setSyncMsg("Échec de la synchronisation."); }
    setSyncing(false);
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  }

  return (
    <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} bottomOffset={20} showsVerticalScrollIndicator={false}>
      <Text style={styles.propTitle}>{prop?.name}</Text>
      <Text style={styles.sectionTitle}>iCal</Text>
      {(prop.ical_links || []).map((l: any, i: number) => (
        <View key={i} style={styles.listItem} testID={`ical-${i}`}>
          <Ionicons name="link-outline" size={18} color={colors.info} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text style={styles.itemTitle}>{l.platform}</Text>
            <Text style={styles.itemSub} numberOfLines={1}>{l.url}</Text>
          </View>
          <Pressable testID={`remove-ical-${i}`} onPress={() => removeIcal(i)} style={styles.trash}>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </Pressable>
        </View>
      ))}
      <View style={styles.addBox}>
        <Text style={styles.label}>Plateforme</Text>
        <View style={styles.platformRow}>
          {ICAL_PLATFORMS.map((p) => (
            <Pressable key={p} testID={`ical-platform-${p}`} onPress={() => setIcalPlatform(p)} style={[styles.pill, icalPlatform === p && styles.pillActive]}>
              <Text style={[styles.pillText, icalPlatform === p && styles.pillTextActive]}>{p}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="Lien iCal" testID="ical-url" value={icalUrl} onChangeText={setIcalUrl} placeholder="https://...ics" autoCapitalize="none" />
        <PrimaryButton testID="add-ical" label="Ajouter le lien" onPress={addIcal} variant="secondary" />
      </View>
      {(prop.ical_links || []).length > 0 && (
        <View style={{ marginTop: spacing.md }}>
          <PrimaryButton testID="sync-ical" label="Synchroniser maintenant" onPress={syncIcal} loading={syncing} icon={<Ionicons name="sync" size={16} color={colors.onBrandPrimary} />} />
          {!!syncMsg && <Text style={styles.syncMsg} testID="sync-result">{syncMsg}</Text>}
        </View>
      )}
    </KeyboardAwareScrollView>
  );
}

export default function ChannelManager() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { property } = useLocalSearchParams<{ property?: string }>();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="cm-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Channel Manager</Text>
        <View style={{ width: 34 }} />
      </View>
      {property ? (
        <PropertyView property={property} insets={insets} />
      ) : (
        <GlobalView insets={insets} router={router} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  intro: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginBottom: spacing.md },
  propTitle: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface, marginBottom: spacing.sm },
  propRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.sm },
  propName: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, flex: 1 },
  countPill: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  countText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  sectionTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  sectionHint: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, lineHeight: 20 },
  inboxCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceInverse, borderRadius: radius.lg, padding: spacing.lg },
  inboxIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  inboxTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurfaceInverse },
  inboxSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  connCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg },
  connTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 6 },
  connDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  connStatus: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  connMeta: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginTop: 2 },
  resultMsg: { fontFamily: font.medium, fontSize: fontSize.base, marginTop: spacing.md, textAlign: "center" },
  listItem: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  itemTitle: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  itemSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  trash: { padding: 6 },
  addBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.sm },
  label: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  platformRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  pill: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  pillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  pillText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  pillTextActive: { color: colors.onBrandPrimary },
  syncMsg: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginTop: spacing.md, textAlign: "center" },
});
