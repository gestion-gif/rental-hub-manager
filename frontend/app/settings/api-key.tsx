import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api, ApiError } from "@/src/api";
import { Field, PrimaryButton } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function ApiKeyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [savingInt, setSavingInt] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await api.get("/channel/status")); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function changeInterval(minutes: number) {
    if (savingInt) return;
    setSavingInt(true);
    try {
      const r = await api.patch("/channel/sync-interval", { minutes });
      setStatus((s: any) => ({ ...s, sync_interval_min: r.sync_interval_min }));
    } catch {}
    setSavingInt(false);
  }

  async function changeReminderDays(days: number) {
    if (savingInt) return;
    setSavingInt(true);
    try {
      const r = await api.patch("/channel/reminder-days", { days });
      setStatus((s: any) => ({ ...s, deposit_reminder_days: r.deposit_reminder_days }));
    } catch {}
    setSavingInt(false);
  }

  async function connect() {
    if (!apiKey.trim()) return;
    setBusy("connect"); setMsg(null);
    try {
      const r = await api.post("/channel/connect", { api_key: apiKey.trim() });
      setApiKey("");
      setMsg({ type: "ok", text: `Clé enregistrée · ${r.properties_count} logement(s)` });
      await load();
    } catch (e: any) { setMsg({ type: "err", text: e instanceof ApiError ? e.message : "Échec" }); }
    setBusy(null);
  }
  async function disconnect() {
    setBusy("disc"); setMsg(null);
    try { await api.post("/channel/disconnect"); setMsg({ type: "ok", text: "Déconnecté" }); await load(); }
    catch { setMsg({ type: "err", text: "Échec" }); }
    setBusy(null);
  }

  const connected = !!status?.connected;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="apikey-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Clé API Lodgify</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} bottomOffset={20}>
          {connected && (
            <View style={styles.connCard}>
              <View style={styles.connTop}>
                <View style={styles.dot} />
                <Text style={styles.connStatus}>Connecté</Text>
              </View>
              <Text style={styles.connMeta}>{status.properties_count} logement(s) Lodgify · {status.mapped_count} lié(s)</Text>
              {!!status.last_sync && <Text style={styles.connMeta}>Dernière synchro : {new Date(status.last_sync).toLocaleString("fr-FR")}</Text>}
              <View style={{ height: spacing.md }} />
              <Text style={styles.intervalLabel}>Synchronisation automatique</Text>
              <Text style={styles.intervalHint}>Vos réservations Lodgify se mettent à jour automatiquement à cette fréquence.</Text>
              <View style={styles.chipsRow}>
                {[15, 30, 60, 120, 240].map((m) => {
                  const active = Number(status.sync_interval_min || 30) === m;
                  const lbl = m < 60 ? `${m} min` : `${m / 60} h`;
                  return (
                    <Pressable
                      key={m}
                      testID={`sync-interval-${m}`}
                      onPress={() => changeInterval(m)}
                      disabled={savingInt}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{lbl}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={{ height: spacing.md }} />
              <Text style={styles.intervalLabel}>Relance caution</Text>
              <Text style={styles.intervalHint}>Nombre de jours avant l'arrivée pour renvoyer automatiquement le lien de caution (si non validée).</Text>
              <View style={styles.chipsRow}>
                {[1, 2, 3, 5, 7].map((d) => {
                  const active = Number(status.deposit_reminder_days ?? 2) === d;
                  return (
                    <Pressable
                      key={d}
                      testID={`reminder-days-${d}`}
                      onPress={() => changeReminderDays(d)}
                      disabled={savingInt}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>J-{d}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={{ height: spacing.md }} />
              <PrimaryButton testID="disconnect-key" label="Déconnecter" onPress={disconnect} loading={busy === "disc"} variant="danger" />
            </View>
          )}

          <Text style={styles.label}>{connected ? "Remplacer la clé API" : "Saisir la clé API"}</Text>
          <Text style={styles.hint}>Trouvez votre clé dans Lodgify : Paramètres → API publique.</Text>
          <View style={{ height: spacing.md }} />
          <Field label="Clé API" testID="apikey-input" value={apiKey} onChangeText={setApiKey} placeholder="Collez votre clé" autoCapitalize="none" secureTextEntry />
          <PrimaryButton testID="save-key" label={connected ? "Mettre à jour la clé" : "Connecter"} onPress={connect} loading={busy === "connect"} icon={<Ionicons name="link" size={16} color={colors.onBrandPrimary} />} />
          {!!msg && <Text style={[styles.msg, { color: msg.type === "ok" ? colors.success : colors.error }]}>{msg.text}</Text>}
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
  connCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.xl },
  connTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
  connStatus: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  connMeta: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginTop: 2 },
  intervalLabel: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  intervalHint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2, marginBottom: spacing.sm },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.onBrandPrimary },
  label: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.xs },
  hint: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  msg: { fontFamily: font.medium, fontSize: fontSize.base, marginTop: spacing.md, textAlign: "center" },
});
