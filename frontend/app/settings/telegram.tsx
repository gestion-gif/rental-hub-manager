import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  Switch, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const TG_BLUE = "#2AABEE"; // couleur de marque Telegram (identique clair/sombre)

export default function TelegramSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [chatOps, setChatOps] = useState("");
  const [chatOpsLabel, setChatOpsLabel] = useState("");
  const [chatAdmin, setChatAdmin] = useState("");
  const [chatAdminLabel, setChatAdminLabel] = useState("");
  const [notifBookings, setNotifBookings] = useState(true);
  const [notifPayments, setNotifPayments] = useState(true);
  const [notifReschedule, setNotifReschedule] = useState(true);
  const [notifDaily, setNotifDaily] = useState(true);
  const [notifSync, setNotifSync] = useState(true);
  const [dailyHour, setDailyHour] = useState(7);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<any[] | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState("");

  const load = useCallback(async () => {
    try {
      const p = await api.get("/preferences");
      const c = p.telegram || {};
      setEnabled(!!c.enabled);
      setBotToken(c.bot_token || "");
      setChatOps(c.chat_ops || "");
      setChatOpsLabel(c.chat_ops_label || "");
      setChatAdmin(c.chat_admin || "");
      setChatAdminLabel(c.chat_admin_label || "");
      setNotifBookings(c.notify_bookings ?? true);
      setNotifPayments(c.notify_payments ?? true);
      setNotifReschedule(c.notify_reschedule ?? true);
      setNotifDaily(c.notify_daily ?? true);
      setNotifSync(c.notify_sync ?? true);
      setDailyHour(c.daily_hour ?? 7);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function buildPayload(overrides: any = {}) {
    return {
      enabled, bot_token: botToken.trim(),
      chat_ops: chatOps.trim(), chat_ops_label: chatOpsLabel,
      chat_admin: chatAdmin.trim(), chat_admin_label: chatAdminLabel,
      notify_bookings: notifBookings, notify_payments: notifPayments,
      notify_reschedule: notifReschedule, notify_daily: notifDaily,
      notify_sync: notifSync,
      daily_hour: dailyHour,
      ...overrides,
    };
  }

  async function save(overrides: any = {}) {
    setSaving(true);
    setFeedback(null);
    try {
      await api.put("/preferences", { telegram: buildPayload(overrides) });
      setFeedback({ ok: true, msg: "Réglages Telegram enregistrés." });
    } catch (e: any) {
      setFeedback({ ok: false, msg: String(e?.message || "Erreur d'enregistrement") });
    }
    setSaving(false);
  }

  async function detectChats() {
    if (!botToken.trim()) {
      setFeedback({ ok: false, msg: "Collez d'abord le token du bot." });
      return;
    }
    setDetecting(true);
    setFeedback(null);
    try {
      const r = await api.get(`/telegram/chats?token=${encodeURIComponent(botToken.trim())}`);
      setDetected(r.chats || []);
      if (!(r.chats || []).length) {
        setFeedback({ ok: false, msg: "Aucun chat détecté. Envoyez /start au bot (ou dans le groupe après l'y avoir ajouté), puis réessayez." });
      }
    } catch (e: any) {
      setDetected(null);
      setFeedback({ ok: false, msg: String(e?.message || "Détection impossible") });
    }
    setDetecting(false);
  }

  async function sendTest(target: "ops" | "admin") {
    setTesting(target);
    setFeedback(null);
    try {
      await api.post("/telegram/test", {
        target,
        token: botToken.trim(),
        chat_id: target === "ops" ? chatOps.trim() : chatAdmin.trim(),
      });
      setFeedback({ ok: true, msg: "Message de test envoyé — vérifiez Telegram !" });
    } catch (e: any) {
      setFeedback({ ok: false, msg: String(e?.message || "Envoi impossible") });
    }
    setTesting("");
  }

  const Row = ({ title, sub, value, onChange, testID }: any) => (
    <View style={styles.optRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.optTitle}>{title}</Text>
        <Text style={styles.optSub}>{sub}</Text>
      </View>
      <Switch testID={testID} value={value} onValueChange={(v) => onChange(v)}
        trackColor={{ true: TG_BLUE }} />
    </View>
  );

  if (loading) {
    return <View style={styles.container}><ActivityIndicator style={{ marginTop: 80 }} color={colors.brandPrimary} /></View>;
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="tg-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Notifications Telegram</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60 }}>
        <View style={styles.introCard}>
          <Ionicons name="paper-plane" size={22} color={TG_BLUE} />
          <Text style={styles.introText}>
            Recevez sur Telegram les nouvelles réservations, paiements, le programme du jour et les tâches décalées — dans des chats séparés pour la gestion et l'équipe terrain.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.optRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.optTitle}>Activer Telegram</Text>
              <Text style={styles.optSub}>Envoi automatique des notifications.</Text>
            </View>
            <Switch testID="tg-enabled" value={enabled}
              onValueChange={(v) => { setEnabled(v); save({ enabled: v }); }}
              trackColor={{ true: TG_BLUE }} />
          </View>
        </View>

        <Text style={styles.group}>1 · Token du bot</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>
            Ouvrez Telegram → cherchez <Text style={styles.bold}>@BotFather</Text> → envoyez /newbot → suivez les étapes → collez le token ici.
          </Text>
          <TextInput
            testID="tg-token"
            value={botToken}
            onChangeText={setBotToken}
            placeholder="123456789:AAH..."
            placeholderTextColor={colors.onSurfaceTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </View>

        <Text style={styles.group}>2 · Chats destinataires</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>
            Envoyez /start au bot (chat privé) et ajoutez-le à vos groupes (envoyez /start dedans), puis détectez les chats.
          </Text>
          <Pressable testID="tg-detect" onPress={detectChats} disabled={detecting} style={styles.detectBtn}>
            {detecting ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Ionicons name="search" size={15} color="#fff" />
                <Text style={styles.detectBtnText}>Détecter les chats</Text>
              </>
            )}
          </Pressable>
          {!!detected?.length && detected.map((c) => (
            <View key={c.chat_id} style={styles.chatRow}>
              <Ionicons name={c.type === "private" ? "person-circle-outline" : "people-circle-outline"} size={20} color={colors.onSurfaceSecondary} />
              <Text style={styles.chatName} numberOfLines={1}>{c.name}</Text>
              <Pressable testID={`tg-assign-ops-${c.chat_id}`}
                onPress={() => { setChatOps(c.chat_id); setChatOpsLabel(c.name); }}
                style={[styles.assignBtn, chatOps === c.chat_id && styles.assignBtnOn]}>
                <Text style={[styles.assignText, chatOps === c.chat_id && styles.assignTextOn]}>Équipe</Text>
              </Pressable>
              <Pressable testID={`tg-assign-admin-${c.chat_id}`}
                onPress={() => { setChatAdmin(c.chat_id); setChatAdminLabel(c.name); }}
                style={[styles.assignBtn, chatAdmin === c.chat_id && styles.assignBtnOn]}>
                <Text style={[styles.assignText, chatAdmin === c.chat_id && styles.assignTextOn]}>Gestion</Text>
              </Pressable>
            </View>
          ))}

          <Text style={styles.fieldLabel}>Chat équipe terrain (ménages, tâches, récap du jour)</Text>
          <TextInput testID="tg-chat-ops" value={chatOps} onChangeText={setChatOps}
            placeholder="ID du chat (ex. -100123456789)" placeholderTextColor={colors.onSurfaceTertiary}
            autoCapitalize="none" style={styles.input} />
          {!!chatOpsLabel && <Text style={styles.chatLabelTag}>{chatOpsLabel}</Text>}

          <Text style={styles.fieldLabel}>Chat gestion (réservations, annulations, paiements)</Text>
          <TextInput testID="tg-chat-admin" value={chatAdmin} onChangeText={setChatAdmin}
            placeholder="ID du chat (ex. 987654321)" placeholderTextColor={colors.onSurfaceTertiary}
            autoCapitalize="none" style={styles.input} />
          {!!chatAdminLabel && <Text style={styles.chatLabelTag}>{chatAdminLabel}</Text>}

          <View style={styles.testRow}>
            <Pressable testID="tg-test-ops" onPress={() => sendTest("ops")} disabled={!!testing || !chatOps}
              style={[styles.testBtn, !chatOps && { opacity: 0.4 }]}>
              {testing === "ops" ? <ActivityIndicator size="small" color={TG_BLUE} /> : <Text style={styles.testBtnText}>Tester équipe</Text>}
            </Pressable>
            <Pressable testID="tg-test-admin" onPress={() => sendTest("admin")} disabled={!!testing || !chatAdmin}
              style={[styles.testBtn, !chatAdmin && { opacity: 0.4 }]}>
              {testing === "admin" ? <ActivityIndicator size="small" color={TG_BLUE} /> : <Text style={styles.testBtnText}>Tester gestion</Text>}
            </Pressable>
          </View>
        </View>

        <Text style={styles.group}>3 · Événements</Text>
        <View style={styles.card}>
          <Row testID="tg-notif-bookings" title="Réservations & annulations" sub="Airbnb, Booking, site direct → chat gestion"
            value={notifBookings} onChange={(v: boolean) => { setNotifBookings(v); }} />
          <Row testID="tg-notif-payments" title="Paiements & cautions" sub="Paiement reçu, solde, caution encaissée → chat gestion"
            value={notifPayments} onChange={(v: boolean) => { setNotifPayments(v); }} />
          <Row testID="tg-notif-reschedule" title="Tâches décalées" sub="Ménage ou intervention déplacé(e) → chat équipe"
            value={notifReschedule} onChange={(v: boolean) => { setNotifReschedule(v); }} />
          <Row testID="tg-notif-daily" title="Programme du jour" sub="Récap quotidien : départs, arrivées, ménages → chat équipe"
            value={notifDaily} onChange={(v: boolean) => { setNotifDaily(v); }} />
          <Row testID="tg-notif-sync" title="Alertes de synchronisation" sub="Échec de synchro Channex → chat gestion (1 alerte max / 6 h)"
            value={notifSync} onChange={(v: boolean) => { setNotifSync(v); }} />
          <View style={styles.hourRow}>
            <Text style={styles.fieldLabel}>Heure d'envoi du récap</Text>
            <View style={styles.hourControls}>
              <Pressable testID="tg-hour-minus" onPress={() => setDailyHour((h) => Math.max(0, h - 1))} style={styles.hourBtn}>
                <Ionicons name="remove" size={18} color={colors.onSurface} />
              </Pressable>
              <Text style={styles.hourValue}>{String(dailyHour).padStart(2, "0")}h00</Text>
              <Pressable testID="tg-hour-plus" onPress={() => setDailyHour((h) => Math.min(23, h + 1))} style={styles.hourBtn}>
                <Ionicons name="add" size={18} color={colors.onSurface} />
              </Pressable>
            </View>
          </View>
        </View>

        {!!feedback && (
          <View style={[styles.feedback, feedback.ok ? styles.feedbackOk : styles.feedbackErr]}>
            <Ionicons name={feedback.ok ? "checkmark-circle" : "alert-circle"} size={16}
              color={feedback.ok ? colors.success : colors.error} />
            <Text style={[styles.feedbackText, { color: feedback.ok ? colors.success : colors.error }]}>{feedback.msg}</Text>
          </View>
        )}

        <Pressable testID="tg-save" onPress={() => save()} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Enregistrer</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  introCard: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start", backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  introText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, lineHeight: 19 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  group: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm, textTransform: "uppercase", letterSpacing: 0.5 },
  optRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  optTitle: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  optSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  hint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, lineHeight: 19, marginBottom: spacing.md },
  bold: { fontFamily: font.bold, color: colors.onSurface },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  detectBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: TG_BLUE, borderRadius: radius.pill, paddingVertical: 12, marginBottom: spacing.md },
  detectBtnText: { fontFamily: font.semibold, fontSize: fontSize.base, color: "#fff" },
  chatRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  chatName: { flex: 1, fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurface },
  assignBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  assignBtnOn: { backgroundColor: TG_BLUE, borderColor: TG_BLUE },
  assignText: { fontFamily: font.semibold, fontSize: fontSize.xs, color: colors.onSurfaceSecondary },
  assignTextOn: { color: "#fff" },
  fieldLabel: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: spacing.md, marginBottom: 6 },
  chatLabelTag: { fontFamily: font.medium, fontSize: fontSize.xs, color: TG_BLUE, marginTop: 4 },
  testRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  testBtn: { flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: TG_BLUE, borderRadius: radius.pill, paddingVertical: 10 },
  testBtnText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: TG_BLUE },
  hourRow: { marginTop: spacing.sm },
  hourControls: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: 4 },
  hourBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  hourValue: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, minWidth: 60, textAlign: "center" },
  feedback: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  feedbackOk: { backgroundColor: colors.success + "18" },
  feedbackErr: { backgroundColor: colors.error + "18" },
  feedbackText: { flex: 1, fontFamily: font.medium, fontSize: fontSize.sm },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingVertical: 14, alignItems: "center" },
  saveText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
});
