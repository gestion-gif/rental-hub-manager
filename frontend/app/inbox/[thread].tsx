import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import { api } from "@/src/api";
import { PrimaryButton } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function ThreadDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { thread } = useLocalSearchParams<{ thread: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.get(`/inbox/${thread}`)); } catch {}
    setLoading(false);
  }, [thread]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function generateReply() {
    if (!data?.messages?.length) return;
    const lastGuest = [...data.messages].reverse().find((m: any) => !m.mine);
    if (!lastGuest) return;
    setAiLoading(true); setDraft(null); setCopied(false);
    try {
      const r = await api.post("/ai/guest-reply", { guest_message: lastGuest.text, tone: "chaleureux" });
      setDraft(r.reply);
    } catch { setDraft("Impossible de générer une réponse pour le moment."); }
    setAiLoading(false);
  }

  async function copyDraft() {
    if (!draft) return;
    await Clipboard.setStringAsync(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

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
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          {(data?.messages || []).length === 0 && (
            <Text style={styles.emptyText}>Aucun message dans cette conversation.</Text>
          )}
          {(data?.messages || []).map((m: any) => (
            <View key={m.id} style={[styles.bubbleRow, m.mine ? styles.rowRight : styles.rowLeft]}>
              <View style={[styles.bubble, m.mine ? styles.bubbleMine : styles.bubbleGuest]}>
                <Text style={[styles.msgText, m.mine && styles.msgTextMine]}>{m.text}</Text>
                <Text style={[styles.msgDate, m.mine && styles.msgDateMine]}>{m.date ? dayjs(m.date).format("DD MMM · HH:mm") : ""}</Text>
              </View>
            </View>
          ))}

          {/* AI reply assistant */}
          <View style={styles.aiBox}>
            <View style={styles.aiHead}>
              <Ionicons name="sparkles" size={16} color={colors.brandPrimary} />
              <Text style={styles.aiTitle}>Réponse assistée par IA</Text>
            </View>
            {draft ? (
              <>
                <Text style={styles.draft}>{draft}</Text>
                <View style={styles.aiActions}>
                  <PrimaryButton testID="copy-draft" label={copied ? "Copié ✓" : "Copier"} onPress={copyDraft} variant="secondary" icon={<Ionicons name="copy-outline" size={16} color={colors.onSurface} />} />
                  <View style={{ width: spacing.sm }} />
                  <PrimaryButton testID="regen-draft" label="Régénérer" onPress={generateReply} loading={aiLoading} />
                </View>
              </>
            ) : (
              <PrimaryButton testID="gen-reply" label="Proposer une réponse" onPress={generateReply} loading={aiLoading} icon={<Ionicons name="sparkles-outline" size={16} color={colors.onBrandPrimary} />} />
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
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
  aiBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.lg },
  aiHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.md },
  aiTitle: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  draft: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, lineHeight: 21, marginBottom: spacing.md },
  aiActions: { flexDirection: "row" },
});
