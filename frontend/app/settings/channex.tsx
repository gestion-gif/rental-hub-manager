import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Alert, Platform, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import dayjs from "dayjs";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

// Alert.alert n'est pas supporté sur web (react-native-web) → fallback navigateur
function notify(title: string, message?: string) {
  if (Platform.OS === "web") (globalThis as any).alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

function confirmDialog(title: string, message: string, confirmText: string, onConfirm: () => void, destructive = false) {
  if (Platform.OS === "web") {
    if ((globalThis as any).confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: "Annuler", style: "cancel" },
      { text: confirmText, style: destructive ? "destructive" : "default", onPress: onConfirm },
    ]);
  }
}

export default function ChannexSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<any>({ connected: false });
  const [apiKey, setApiKey] = useState("");
  const [env, setEnv] = useState<"staging" | "production">("staging");
  const [connecting, setConnecting] = useState(false);
  const [props, setProps] = useState<any[]>([]);
  const [loadingProps, setLoadingProps] = useState(false);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [reconfig, setReconfig] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const st = await api.get("/channex/status");
      setStatus(st);
      if (st.connected) {
        setEnv(st.environment || "staging");
        try { const l = await api.get("/channex/sync-logs"); setLogs(l.logs || []); } catch {}
      }
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function connect() {
    if (!apiKey.trim()) { notify("Clé requise", "Saisissez votre clé API Channex."); return; }
    setConnecting(true);
    try {
      const r = await api.post("/channex/connect", { api_key: apiKey.trim(), environment: env });
      setApiKey("");
      notify("Connecté", `Channex connecté (${r.environment}). ${r.properties_count} logement(s) détecté(s).`);
      setReconfig(false);
      await load();
    } catch (e: any) {
      notify("Échec de connexion", e?.message || "Clé ou environnement invalide.");
    }
    setConnecting(false);
  }

  async function importChannex() {
    if (importing) return;
    setImporting(true);
    try {
      const r = await api.post("/channex/import", {});
      notify("Import terminé", `${r.imported_properties} logement(s), ${r.imported_rooms} chambre(s), ${r.imported_rate_plans} tarif(s) importés dans Casanéo.`);
      await load();
    } catch (e: any) {
      notify("Erreur", e?.message || "Import impossible.");
    }
    setImporting(false);
  }

  async function registerWebhook() {
    if (webhookBusy) return;
    setWebhookBusy(true);
    try {
      const callback = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/channex/webhook`;
      await api.post("/channex/webhook/register", { callback_url: callback });
      notify("Réception activée", "Casanéo recevra désormais automatiquement les réservations Airbnb/Booking depuis Channex.");
      await load();
    } catch (e: any) {
      notify("Erreur", e?.message || "Activation impossible.");
    }
    setWebhookBusy(false);
  }

  async function syncBookings() {
    if (bookingBusy) return;
    setBookingBusy(true);
    try {
      const r = await api.post("/channex/bookings/sync", {});
      notify("Réservations récupérées", `${r.processed} réservation(s) traitée(s) depuis Channex.`);
      await load();
    } catch (e: any) {
      notify("Erreur", e?.message || "Récupération impossible.");
    }
    setBookingBusy(false);
  }

  async function fullSync() {
    if (syncing) return;
    confirmDialog(
      "Synchronisation complète",
      "Envoyer vers Channex 500 jours de disponibilités et de tarifs pour tous vos logements liés ? (recommandé lors de la mise en ligne)",
      "Envoyer",
      async () => {
        setSyncing(true);
        try {
          const r = await api.post("/channex/full-sync", { days: 500 });
          const tasks = (r.results || []).reduce((n: number, x: any) => n + (x.task_ids?.length || 0), 0);
          notify("Synchronisation envoyée", `${r.properties} logement(s) synchronisé(s) sur ${r.days} jours. ${tasks} tâche(s) Channex générée(s).`);
          await load();
        } catch (e: any) {
          notify("Erreur", e?.message || "Synchronisation impossible.");
        }
        setSyncing(false);
      },
    );
  }

  async function refreshProps() {
    setLoadingProps(true);
    try {
      const r = await api.get("/channex/properties");
      setProps(r.properties || []);
      setStatus((s: any) => ({ ...s, properties_count: r.count }));
    } catch (e: any) {
      notify("Erreur", e?.message || "Lecture impossible.");
    }
    setLoadingProps(false);
  }

  function disconnect() {
    confirmDialog("Déconnecter Channex", "La clé API sera supprimée. Lodgify n'est pas affecté.", "Déconnecter", async () => {
      try { await api.post("/channex/disconnect", {}); } catch {}
      setProps([]); setStatus({ connected: false }); load();
    }, true);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="channex-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Channex</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>Channel manager Channex</Text>
          <Text style={styles.introSub}>
            Connectez votre compte Channex pour importer vos logements et envoyer vos disponibilités et tarifs (synchronisation). N'affecte pas Lodgify (les deux peuvent coexister).
          </Text>

          {status.connected && !reconfig ? (
            <>
              <View style={styles.statusCard}>
                <View style={styles.statusRow}>
                  <View style={styles.dotOn} />
                  <Text style={styles.statusOn}>Connecté</Text>
                  <View style={styles.envBadge}><Text style={styles.envBadgeText}>{status.environment}</Text></View>
                </View>
                <Text style={styles.statusSub}>{status.properties_count} logement(s) sur Channex</Text>
                {!!status.connected_at && <Text style={styles.statusMeta}>Connecté le {dayjs(status.connected_at).format("DD/MM/YYYY à HH:mm")}</Text>}
                <View style={styles.actionRow}>
                  <Pressable testID="channex-refresh" onPress={refreshProps} disabled={loadingProps} style={styles.primaryBtn}>
                    {loadingProps ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : (
                      <><Ionicons name="refresh" size={16} color={colors.onBrandPrimary} /><Text style={styles.primaryBtnText}>Lire les logements</Text></>
                    )}
                  </Pressable>
                  <Pressable testID="channex-disconnect" onPress={disconnect} style={styles.dangerBtn}>
                    <Ionicons name="unlink-outline" size={16} color="#E5484D" />
                    <Text style={styles.dangerText}>Déconnecter</Text>
                  </Pressable>
                </View>
                <Pressable testID="channex-import" onPress={importChannex} disabled={importing || (status.properties_count || 0) === 0} style={[styles.importBtn, ((status.properties_count || 0) === 0) && { opacity: 0.5 }]}>
                  {importing ? <ActivityIndicator size="small" color="#fff" /> : (
                    <><Ionicons name="download-outline" size={16} color="#fff" /><Text style={styles.importText}>Importer dans Casanéo (logements, chambres, tarifs)</Text></>
                  )}
                </Pressable>
                <Pressable testID="channex-fullsync" onPress={fullSync} disabled={syncing || (status.properties_count || 0) === 0} style={[styles.syncBtn, ((status.properties_count || 0) === 0) && { opacity: 0.5 }]}>
                  {syncing ? <ActivityIndicator size="small" color="#fff" /> : (
                    <><Ionicons name="cloud-upload-outline" size={16} color="#fff" /><Text style={styles.importText}>Synchronisation complète vers Channex (500 jours)</Text></>
                  )}
                </Pressable>
                <Pressable testID="channex-webhook" onPress={registerWebhook} disabled={webhookBusy} style={[styles.syncBtn, { backgroundColor: status.webhook_id ? "#17B0A6" : "#7A5AF8" }]}>
                  {webhookBusy ? <ActivityIndicator size="small" color="#fff" /> : (
                    <><Ionicons name={status.webhook_id ? "checkmark-circle-outline" : "notifications-outline"} size={16} color="#fff" /><Text style={styles.importText}>{status.webhook_id ? "Réception des réservations activée ✓ (réactiver)" : "Activer la réception des réservations (webhook)"}</Text></>
                  )}
                </Pressable>
                <Pressable testID="channex-bookings-sync" onPress={syncBookings} disabled={bookingBusy} style={styles.reconfigBtn}>
                  {bookingBusy ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : (
                    <><Ionicons name="download-outline" size={14} color={colors.brandPrimary} /><Text style={styles.reconfigText}>Récupérer les réservations maintenant</Text></>
                  )}
                </Pressable>
                <Pressable testID="channex-reconfig" onPress={() => { setEnv((status.environment === "production" ? "production" : "staging")); setReconfig(true); }} style={styles.reconfigBtn}>
                  <Ionicons name="settings-outline" size={14} color={colors.brandPrimary} />
                  <Text style={styles.reconfigText}>Changer de clé / passer en production</Text>
                </Pressable>
              </View>

              {status.properties_count === 0 && (
                <View style={styles.hintCard}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.brandPrimary} />
                  <Text style={styles.hintText}>Aucun logement dans votre compte Channex pour l'instant. Créez vos logements dans Channex, puis appuyez sur « Lire les logements ».</Text>
                </View>
              )}

              {props.length > 0 && (
                <View style={styles.listCard}>
                  <Text style={styles.listTitle}>Logements Channex ({props.length})</Text>
                  {props.map((p) => (
                    <View key={p.channex_id} style={styles.propRow}>
                      <View style={styles.propIcon}><Ionicons name="home-outline" size={16} color={colors.brandPrimary} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.propName}>{p.title}</Text>
                        <Text style={styles.propMeta}>{[p.city, p.currency].filter(Boolean).join(" · ")}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {logs.length > 0 && (
                <View style={styles.listCard}>
                  <Text style={styles.listTitle}>Journal de synchronisation</Text>
                  {logs.slice(0, 8).map((l, i) => (
                    <View key={i} style={styles.logRow}>
                      <View style={[styles.logDot, { backgroundColor: l.status === "success" ? "#17B0A6" : "#E5484D" }]} />
                      <Text style={styles.logType}>{l.type}</Text>
                      <Text style={styles.logMsg} numberOfLines={1}>{l.message || l.status}</Text>
                      <Text style={styles.logDate}>{dayjs(l.date).format("DD/MM HH:mm")}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : (
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Environnement</Text>
              <View style={styles.envRow}>
                {(["staging", "production"] as const).map((e) => (
                  <Pressable key={e} testID={`channex-env-${e}`} onPress={() => setEnv(e)} style={[styles.envChip, env === e && styles.envChipOn]}>
                    <Text style={[styles.envChipText, env === e && styles.envChipTextOn]}>{e === "staging" ? "Bac à sable (staging)" : "Production"}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.fieldLabel}>Clé API Channex</Text>
              <TextInput
                testID="channex-key"
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="Collez votre clé user-api-key"
                placeholderTextColor={colors.onSurfaceTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={styles.input}
              />
              <Pressable testID="channex-connect" onPress={connect} disabled={connecting} style={[styles.primaryBtnFull, connecting && { opacity: 0.6 }]}>
                {connecting ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Tester & connecter</Text>}
              </Pressable>
              {reconfig && (
                <Pressable testID="channex-cancel-reconfig" onPress={() => setReconfig(false)} style={styles.reconfigBtn}>
                  <Text style={styles.reconfigText}>Annuler</Text>
                </Pressable>
              )}
            </View>
          )}
        </KeyboardAwareScrollView>
      )}
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
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  fieldLabel: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginBottom: 6, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface },
  envRow: { flexDirection: "row", gap: spacing.sm },
  envChip: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  envChipOn: { backgroundColor: "#EAF3FA", borderColor: colors.brandPrimary },
  envChipText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  envChipTextOn: { color: colors.brandPrimary, fontFamily: font.semibold },
  primaryBtnFull: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 16, flex: 1 },
  primaryBtnText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
  statusCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dotOn: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#17B0A6" },
  statusOn: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  envBadge: { marginLeft: "auto", backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  envBadgeText: { fontFamily: font.medium, fontSize: fontSize.xs, color: colors.onSurfaceSecondary },
  statusSub: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface, marginTop: 8 },
  statusMeta: { fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, marginTop: 2 },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  dangerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: "#E5484D", borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 16 },
  dangerText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: "#E5484D" },
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#17B0A6", borderRadius: radius.md, paddingVertical: 12, marginTop: spacing.sm },
  syncBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#2A6F9E", borderRadius: radius.md, paddingVertical: 12, marginTop: spacing.sm },
  importText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: "#fff", flexShrink: 1 },
  reconfigBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10, marginTop: 4 },
  reconfigText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.brandPrimary },
  hintCard: { flexDirection: "row", gap: 8, backgroundColor: "#EAF3FA", borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  hintText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, lineHeight: 19 },
  listCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  listTitle: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurface, marginBottom: spacing.sm },
  propRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  propIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  propName: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  propMeta: { fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary },
  logRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  logDot: { width: 8, height: 8, borderRadius: 4 },
  logType: { fontFamily: font.medium, fontSize: fontSize.xs, color: colors.onSurface },
  logMsg: { flex: 1, fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary },
  logDate: { fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary },
});
