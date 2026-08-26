import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import { api, ApiError } from "@/src/api";
import { ContactGuestModal } from "@/src/components/ContactGuestModal";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function ThreadDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { thread } = useLocalSearchParams<{ thread: string }>();
  const [data, setData] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftUsed, setDraftUsed] = useState(false);
  const [tone, setTone] = useState<"chaleureux" | "professionnel" | "concis">("chaleureux");
  const [showTrans, setShowTrans] = useState(true);
  const [quickReplies, setQuickReplies] = useState<any[]>([]);
  const [contactOpen, setContactOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/inbox/${thread}`);
      setData(d);
      setMessages(d.messages || []);
      if (d.ai_draft) {
        setDraft(d.ai_draft);
        // Pré-remplir la réponse avec le brouillon si l'utilisateur n'a rien saisi
        setReply((r) => (r.trim() ? r : d.ai_draft));
      }
    } catch {}
    setLoading(false);
  }, [thread]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useFocusEffect(useCallback(() => {
    api.get("/quick-replies").then(setQuickReplies).catch(() => {});
  }, []));

  function insertQuick(body: string) {
    setReply((r) => (r.trim() ? `${r.trim()}\n\n${body}` : body));
  }

  async function suggest() {
    setAiLoading(true); setError(null);
    try {
      const r = await api.post(`/inbox/${thread}/generate-draft`, { tone });
      setDraft(r.ai_draft);
      setReply(r.ai_draft);
      setDraftUsed(false);
    } catch { setError("Impossible de générer un brouillon."); }
    setAiLoading(false);
  }

  function useDraft() {
    if (draft) { setReply(draft); setDraftUsed(true); }
  }

  async function send() {
    await sendText(reply);
  }

  async function sendText(text: string) {
    const t = (text || "").trim();
    if (!t || sending) return;
    setSending(true); setError(null);
    try {
      const r = await api.post(`/inbox/${thread}/reply`, { message: t });
      setMessages((m) => [...m, r.message]);
      setReply("");
      setDraft(null);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : "Échec de l'envoi");
    }
    setSending(false);
  }

  const hasTrans = messages.some((m: any) => !m.mine && m.text_fr);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="thread-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{data?.guest_name || "Conversation"}</Text>
          {!!data?.property_name && <Text style={styles.subtitle} numberOfLines={1}>{data.property_name} · {data.source}</Text>}
        </View>
        {hasTrans ? (
          <Pressable testID="toggle-trans" onPress={() => setShowTrans((s) => !s)} style={[styles.transToggle, showTrans && styles.transToggleOn]}>
            <Ionicons name="language" size={18} color={showTrans ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
          </Pressable>
        ) : (
          <View style={{ width: 34 }} />
        )}
        {!!data?.reservation_id && (
          <Pressable testID="thread-contact" onPress={() => setContactOpen(true)} style={styles.transToggle}>
            <Ionicons name="paper-plane-outline" size={18} color={colors.onSurfaceSecondary} />
          </Pressable>
        )}
      </View>
      {!!data?.reservation_id && (
        <ContactGuestModal visible={contactOpen} reservationId={String(data.reservation_id)} onClose={() => setContactOpen(false)} />
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="translate-with-padding">
          <ScrollView contentContainerStyle={{ padding: spacing.lg }} showsVerticalScrollIndicator={false}>
            {messages.length === 0 && <Text style={styles.emptyText}>Aucun message dans cette conversation.</Text>}
            {messages.map((m: any) => (
              <View key={m.id} style={[styles.bubbleRow, m.mine ? styles.rowRight : styles.rowLeft]}>
                <View style={[styles.bubble, m.mine ? styles.bubbleMine : styles.bubbleGuest]}>
                  <Text style={[styles.msgText, m.mine && styles.msgTextMine]}>{m.text}</Text>
                  {!m.mine && !!m.text_fr && showTrans && (
                    <View style={styles.transBox}>
                      <View style={styles.transHead}>
                        <Ionicons name="language" size={11} color={colors.brandPrimary} />
                        <Text style={styles.transLabel}>Traduction FR</Text>
                      </View>
                      <Text style={styles.transText}>{m.text_fr}</Text>
                    </View>
                  )}
                  <Text style={[styles.msgDate, m.mine && styles.msgDateMine]}>{m.date ? dayjs(m.date).format("DD MMM · HH:mm") : ""}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
            {!!error && <Text style={styles.error}>{error}</Text>}
            {!!draft && !draftUsed && reply.trim() !== draft && (
              <View style={styles.draftCard}>
                <View style={styles.draftHead}>
                  <Ionicons name="sparkles" size={14} color={colors.brandPrimary} />
                  <Text style={styles.draftHeadText}>Brouillon IA — à valider</Text>
                </View>
                <Text style={styles.draftText} numberOfLines={4}>{draft}</Text>
                <View style={styles.draftActions}>
                  <Pressable testID="use-draft" onPress={useDraft} style={styles.useDraftBtn}>
                    <Ionicons name="create-outline" size={14} color={colors.brandPrimary} />
                    <Text style={styles.useDraftText}>Modifier</Text>
                  </Pressable>
                  <Pressable testID="send-draft" onPress={() => sendText(draft)} disabled={sending} style={[styles.sendDraftBtn, sending && { opacity: 0.6 }]}>
                    {sending ? (
                      <ActivityIndicator size="small" color={colors.onBrandPrimary} />
                    ) : (
                      <>
                        <Ionicons name="paper-plane" size={14} color={colors.onBrandPrimary} />
                        <Text style={styles.sendDraftText}>Valider et envoyer</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            )}
            {quickReplies.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
                {quickReplies.map((q) => (
                  <Pressable key={q.id} testID={`quick-${q.id}`} onPress={() => insertQuick(q.body)} style={styles.quickChip}>
                    <Ionicons name="flash" size={12} color={colors.brandPrimary} />
                    <Text style={styles.quickChipText} numberOfLines={1}>{q.title}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View style={styles.toneRow}>
              <Text style={styles.toneLabel}>Ton :</Text>
              {(["chaleureux", "professionnel", "concis"] as const).map((t) => (
                <Pressable
                  key={t}
                  testID={`tone-${t}`}
                  onPress={() => setTone(t)}
                  style={[styles.toneChip, tone === t && styles.toneChipActive]}
                >
                  <Text style={[styles.toneChipText, tone === t && styles.toneChipTextActive]}>
                    {t === "chaleureux" ? "Chaleureux" : t === "professionnel" ? "Pro" : "Concis"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable testID="ai-suggest" onPress={suggest} style={styles.suggestBtn} disabled={aiLoading}>
              {aiLoading ? (
                <ActivityIndicator size="small" color={colors.brandPrimary} />
              ) : (
                <>
                  <Ionicons name="refresh" size={14} color={colors.brandPrimary} />
                  <Text style={styles.suggestText}>{draft ? "Régénérer le brouillon (IA)" : "Proposer une réponse (IA)"}</Text>
                </>
              )}
            </Pressable>
            <View style={styles.inputRow}>
              <TextInput
                testID="reply-input"
                value={reply}
                onChangeText={setReply}
                placeholder="Écrivez votre réponse..."
                placeholderTextColor={colors.onSurfaceTertiary}
                style={styles.input}
                multiline
              />
              <Pressable testID="send-reply" onPress={send} disabled={!reply.trim() || sending} style={[styles.sendBtn, (!reply.trim() || sending) && { opacity: 0.5 }]}>
                {sending ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Ionicons name="send" size={18} color={colors.onBrandPrimary} />}
              </Pressable>
            </View>
            <Text style={styles.disclaimer}>Le message sera envoyé au voyageur via {data?.source || "la plateforme"}.</Text>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  transToggle: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  transToggleOn: { backgroundColor: colors.brandPrimary },
  title: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  subtitle: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 1 },
  bubbleRow: { flexDirection: "row", marginBottom: spacing.md },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },
  bubble: { maxWidth: "82%", borderRadius: radius.lg, padding: spacing.md },
  bubbleGuest: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: 4 },
  bubbleMine: { backgroundColor: colors.surfaceInverse, borderTopRightRadius: 4 },
  msgText: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, lineHeight: 20 },
  msgTextMine: { color: colors.onSurfaceInverse },
  msgDate: { fontFamily: font.regular, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 6, alignSelf: "flex-end" },
  msgDateMine: { color: "rgba(255,255,255,0.6)" },
  emptyText: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: 40 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: colors.surface },
  error: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.error, marginBottom: spacing.sm, textAlign: "center" },
  suggestBtn: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, marginBottom: spacing.sm },
  suggestText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary },
  toneRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm, flexWrap: "wrap" },
  quickRow: { gap: 6, paddingBottom: spacing.sm, paddingRight: spacing.lg },
  quickChip: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 180, paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brandPrimary + "12", borderWidth: 1, borderColor: colors.brandPrimary + "33" },
  quickChipText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary, flexShrink: 1 },
  toneLabel: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  toneChip: { paddingVertical: 4, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  toneChipActive: { backgroundColor: colors.brandPrimary },
  toneChipText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  toneChipTextActive: { color: colors.onBrandPrimary, fontFamily: font.semibold },
  draftCard: { backgroundColor: colors.brandPrimary + "0F", borderWidth: 1, borderColor: colors.brandPrimary + "40", borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  draftHead: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 },
  draftHeadText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary },
  draftText: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, lineHeight: 19 },
  draftActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  useDraftBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  useDraftText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary },
  sendDraftBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.brandPrimary },
  sendDraftText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onBrandPrimary },
  transBox: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  transHead: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 3 },
  transLabel: { fontFamily: font.semibold, fontSize: 10, color: colors.brandPrimary, textTransform: "uppercase", letterSpacing: 0.4 },
  transText: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 19, fontStyle: "italic" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingTop: 12, paddingBottom: 12, fontFamily: font.regular, fontSize: fontSize.lg, color: colors.onSurface, maxHeight: 120 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  disclaimer: { fontFamily: font.regular, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 6, textAlign: "center" },
});
