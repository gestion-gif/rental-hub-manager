import React, { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  KeyboardAvoidingView,
  KeyboardAwareScrollView,
} from "react-native-keyboard-controller";
import { Platform } from "react-native";

import { api } from "@/src/api";
import { MenuButton } from "@/src/components/MenuButton";
import { HelpButton } from "@/src/components/HelpButton";
import { PrimaryButton } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Msg = { role: "guest" | "ai"; text: string };

const TONES = ["Chaleureux", "Professionnel", "Concis"];

export default function Assistant() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"messages" | "prix">("messages");

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={[styles.titleRow, { justifyContent: "space-between" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <MenuButton />
            <Text style={styles.title}>Assistant IA</Text>
          </View>
          <HelpButton screen="assistant" />
        </View>
        <View style={styles.segment}>
          {(["messages", "prix"] as const).map((t) => (
            <Pressable
              key={t}
              testID={`segment-${t}`}
              onPress={() => setTab(t)}
              style={[styles.segBtn, tab === t && styles.segBtnActive]}
            >
              <Text style={[styles.segText, tab === t && styles.segTextActive]}>
                {t === "messages" ? "Messages" : "Tarifs"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {tab === "messages" ? <MessagesTab /> : <PricingTab />}
    </View>
  );
}

function MessagesTab() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [tone, setTone] = useState("Chaleureux");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  async function generate() {
    const text = input.trim();
    if (!text || loading) return;
    setMessages((m) => [...m, { role: "guest", text }]);
    setInput("");
    setLoading(true);
    try {
      const res = await api.post("/ai/guest-reply", {
        guest_message: text,
        tone: tone.toLowerCase(),
      });
      setMessages((m) => [...m, { role: "ai", text: res.reply }]);
    } catch {
      setMessages((m) => [...m, { role: "ai", text: "Erreur, réessayez." }]);
    }
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  async function copy(text: string) {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="translate-with-padding"
      keyboardVerticalOffset={0}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 && (
          <View style={styles.hint}>
            <Ionicons name="chatbubbles-outline" size={36} color={colors.onSurfaceTertiary} />
            <Text style={styles.hintTitle}>Collez le message d'un voyageur</Text>
            <Text style={styles.hintSub}>
              L'IA rédige une réponse prête à envoyer. Choisissez le ton ci-dessous.
            </Text>
          </View>
        )}
        {messages.map((m, i) => (
          <View
            key={i}
            style={[m.role === "guest" ? styles.guestBubble : styles.aiBubble]}
          >
            {m.role === "ai" && (
              <View style={styles.aiTag}>
                <Ionicons name="sparkles" size={12} color={colors.brandPrimary} />
                <Text style={styles.aiTagText}>Réponse suggérée</Text>
              </View>
            )}
            <Text style={m.role === "guest" ? styles.guestText : styles.aiText}>
              {m.text}
            </Text>
            {m.role === "ai" && (
              <Pressable
                testID={`copy-reply-${i}`}
                onPress={() => copy(m.text)}
                style={styles.copyBtn}
              >
                <Ionicons name="copy-outline" size={14} color={colors.brandPrimary} />
                <Text style={styles.copyText}>Copier</Text>
              </Pressable>
            )}
          </View>
        ))}
        {loading && <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.brandPrimary} />}
      </ScrollView>

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 76 }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toneRow}>
          {TONES.map((t) => (
            <Pressable
              key={t}
              testID={`tone-${t}`}
              onPress={() => setTone(t)}
              style={[styles.toneChip, tone === t && styles.toneChipActive]}
            >
              <Text style={[styles.toneText, tone === t && styles.toneTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.inputRow}>
          <TextInput
            testID="guest-message-input"
            value={input}
            onChangeText={setInput}
            placeholder="Message du voyageur..."
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
            multiline
          />
          <Pressable testID="generate-reply-button" onPress={generate} style={styles.sendBtn}>
            <Ionicons name="arrow-up" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function PricingTab() {
  const insets = useSafeAreaInsets();
  const [props, setProps] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [period, setPeriod] = useState("");
  const [result, setResult] = useState("");
  const [seasons, setSeasons] = useState<any[]>([]);
  const [applied, setApplied] = useState(false);
  const [applying, setApplying] = useState(false);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      api.get("/properties").then((d) => {
        setProps(d);
        if (d.length && !selected) setSelected(d[0].id);
      }).catch(() => {});
    }, []),
  );

  async function generate() {
    if (!selected) return;
    setLoading(true);
    setResult("");
    setSeasons([]);
    setApplied(false);
    try {
      const res = await api.post("/ai/pricing-suggestion", {
        property_id: selected,
        period,
      });
      setResult(res.suggestion);
      setSeasons(res.seasons || []);
    } catch {
      setResult("Erreur lors de la génération. Réessayez.");
    }
    setLoading(false);
  }

  async function applySeasons() {
    if (!seasons.length || !selected || applying) return;
    const prop = props.find((p) => p.id === selected);
    if (!prop) return;
    setApplying(true);
    const toAdd = seasons.map((s, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      name: s.name,
      start_date: s.start_date,
      end_date: s.end_date,
      price: s.price,
    }));
    try {
      const updated = await api.put(`/properties/${selected}`, {
        ...prop,
        seasons: [...(prop.seasons || []), ...toAdd],
      });
      setProps((list) => list.map((p) => (p.id === selected ? updated : p)));
      setApplied(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
    setApplying(false);
  }

  async function copy() {
    await Clipboard.setStringAsync(result);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}
      bottomOffset={20}
      showsVerticalScrollIndicator={false}
    >
      {props.length === 0 ? (
        <View style={styles.hint}>
          <Ionicons name="pricetags-outline" size={36} color={colors.onSurfaceTertiary} />
          <Text style={styles.hintTitle}>Ajoutez un logement</Text>
          <Text style={styles.hintSub}>Créez un logement pour obtenir des recommandations de prix.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.fieldLabel}>Logement</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toneRow}>
            {props.map((p) => (
              <Pressable
                key={p.id}
                testID={`price-prop-${p.id}`}
                onPress={() => setSelected(p.id)}
                style={[styles.toneChip, selected === p.id && styles.toneChipActive]}
              >
                <Text style={[styles.toneText, selected === p.id && styles.toneTextActive]}>{p.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={[styles.fieldLabel, { marginTop: spacing.lg }]}>Période (optionnel)</Text>
          <TextInput
            testID="pricing-period-input"
            value={period}
            onChangeText={setPeriod}
            placeholder="ex: juillet, vacances de Noël..."
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.periodInput}
          />
          <PrimaryButton
            testID="generate-pricing-button"
            label="Analyser les tarifs"
            onPress={generate}
            loading={loading}
            style={{ marginTop: spacing.lg }}
            icon={<Ionicons name="sparkles" size={16} color={colors.onBrandPrimary} />}
          />
          {!!result && (
            <View style={styles.resultCard}>
              <View style={styles.aiTag}>
                <Ionicons name="trending-up" size={14} color={colors.success} />
                <Text style={styles.aiTagText}>Recommandation</Text>
              </View>
              <Text style={styles.resultText}>{result}</Text>
              <Pressable testID="copy-pricing" onPress={copy} style={styles.copyBtn}>
                <Ionicons name="copy-outline" size={14} color={colors.brandPrimary} />
                <Text style={styles.copyText}>Copier</Text>
              </Pressable>
            </View>
          )}
          {seasons.length > 0 && (
            <View style={styles.seasonCard}>
              <View style={styles.aiTag}>
                <Ionicons name="pricetag" size={14} color={colors.brandPrimary} />
                <Text style={styles.aiTagText}>Saisons suggérées</Text>
              </View>
              {seasons.map((s, i) => (
                <View key={i} style={[styles.seasonRow, i > 0 && styles.seasonRowBorder]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.seasonName}>{s.name}</Text>
                    <View style={styles.seasonMeta}>
                      <Ionicons name="calendar-outline" size={13} color={colors.onSurfaceTertiary} />
                      <Text style={styles.seasonMetaText}>{s.start_date} → {s.end_date}</Text>
                    </View>
                  </View>
                  <Text style={styles.seasonPrice}>{s.price} €</Text>
                </View>
              ))}
              {applied ? (
                <View style={styles.appliedRow}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                  <Text style={styles.appliedText}>Saisons ajoutées au logement</Text>
                </View>
              ) : (
                <PrimaryButton
                  testID="apply-seasons"
                  label={`Appliquer ${seasons.length > 1 ? `ces ${seasons.length} saisons` : "cette saison"}`}
                  onPress={applySeasons}
                  loading={applying}
                  style={{ marginTop: spacing.md }}
                  icon={<Ionicons name="add-circle" size={16} color={colors.onBrandPrimary} />}
                />
              )}
            </View>
          )}
        </>
      )}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface, marginBottom: spacing.md },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: 3,
  },
  segBtn: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: radius.sm },
  segBtnActive: { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  segText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  segTextActive: { color: colors.onSurface, fontFamily: font.semibold },
  hint: { alignItems: "center", marginTop: 60, gap: spacing.sm, paddingHorizontal: spacing.xl },
  hintTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  hintSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center" },
  guestBubble: {
    alignSelf: "flex-end",
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.lg,
    borderBottomRightRadius: 4,
    padding: spacing.md,
    marginBottom: spacing.sm,
    maxWidth: "85%",
  },
  guestText: { fontFamily: font.regular, fontSize: fontSize.lg, color: colors.onBrandPrimary },
  aiBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderBottomLeftRadius: 4,
    padding: spacing.md,
    marginBottom: spacing.md,
    maxWidth: "92%",
  },
  aiText: { fontFamily: font.regular, fontSize: fontSize.lg, color: colors.onSurface, lineHeight: 22 },
  aiTag: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  aiTagText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.md, alignSelf: "flex-start" },
  copyText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.brandPrimary },
  inputBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  toneRow: { gap: spacing.sm, paddingVertical: spacing.sm },
  toneChip: {
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
  },
  toneChipActive: { backgroundColor: colors.brandPrimary },
  toneText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  toneTextActive: { color: colors.onBrandPrimary },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.xs },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: font.regular,
    fontSize: fontSize.lg,
    color: colors.onSurface,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  periodInput: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontFamily: font.regular,
    fontSize: fontSize.lg,
    color: colors.onSurface,
  },
  resultCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  resultText: { fontFamily: font.regular, fontSize: fontSize.lg, color: colors.onSurface, lineHeight: 23 },
  seasonCard: {
    marginTop: spacing.md,
    backgroundColor: colors.brandPrimary + "0F",
    borderWidth: 1,
    borderColor: colors.brandPrimary + "40",
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  seasonName: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  seasonRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm, gap: spacing.sm },
  seasonRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  seasonMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  seasonMetaText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  seasonPrice: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.brandPrimary, marginTop: 6 },
  appliedRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  appliedText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.success },
});
