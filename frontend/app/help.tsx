import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { HELP_TOPICS, HelpTopic } from "@/src/data/help";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function matches(t: HelpTopic, q: string): boolean {
  if (!q) return true;
  const hay = [
    t.title,
    t.summary,
    ...(t.articles || []).flatMap((a) => [a.q, a.a]),
    ...(t.guides || []).flatMap((g) => [g.title, ...g.steps]),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export default function HelpCenter() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  const topics = useMemo(() => HELP_TOPICS.filter((t) => matches(t, query)), [query]);

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((cur) => (cur === id ? null : id));
  };

  async function ask() {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setAnswer("");
    try {
      const r = await api.post("/ai/help-ask", { question: q, screen: "Centre d'aide" });
      setAnswer(r.answer || "");
    } catch {
      setAnswer("Désolé, une erreur est survenue. Réessayez.");
    }
    setAsking(false);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="help-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Centre d'aide</Text>
        <View style={{ width: 34 }} />
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
        bottomOffset={20}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Assistant d'aide IA */}
        <View style={styles.aiCard}>
          <View style={styles.aiHead}>
            <Ionicons name="sparkles" size={16} color={colors.brandPrimary} />
            <Text style={styles.aiHeadText}>Assistant d'aide</Text>
          </View>
          <Text style={styles.aiSub}>Posez votre question sur l'utilisation de Casanéo.</Text>
          <View style={styles.askRow}>
            <TextInput
              testID="help-ask-input"
              value={question}
              onChangeText={setQuestion}
              placeholder="Ex : comment envoyer un relevé ?"
              placeholderTextColor={colors.onSurfaceTertiary}
              style={styles.askInput}
              multiline
              onSubmitEditing={ask}
            />
            <Pressable testID="help-ask-send" onPress={ask} style={styles.sendBtn}>
              {asking ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <Ionicons name="arrow-up" size={20} color={colors.onBrandPrimary} />
              )}
            </Pressable>
          </View>
          {!!answer && (
            <View style={styles.answerBox}>
              <Text style={styles.answerText}>{answer}</Text>
            </View>
          )}
        </View>

        {/* Recherche */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.onSurfaceTertiary} />
          <TextInput
            testID="help-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher un sujet…"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.searchInput}
          />
          {!!query && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          )}
        </View>

        {/* Thèmes */}
        {topics.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="help-circle-outline" size={40} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyText}>Aucun résultat pour « {query} »</Text>
            <Text style={styles.emptySub}>Essayez l'assistant d'aide ci-dessus.</Text>
          </View>
        ) : (
          topics.map((t) => {
            const expanded = open === t.id;
            return (
              <View key={t.id} style={styles.topicCard}>
                <Pressable testID={`help-topic-${t.id}`} onPress={() => toggle(t.id)} style={styles.topicHead}>
                  <View style={styles.topicIcon}>
                    <Ionicons name={t.icon as any} size={18} color={colors.onSurface} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.topicTitle}>{t.title}</Text>
                    <Text style={styles.topicSummary}>{t.summary}</Text>
                  </View>
                  <Ionicons
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={colors.onSurfaceTertiary}
                  />
                </Pressable>

                {expanded && (
                  <View style={styles.topicBody}>
                    {(t.guides || []).map((g, gi) => (
                      <View key={`g${gi}`} style={styles.guide}>
                        <View style={styles.guideHead}>
                          <Ionicons name="footsteps-outline" size={14} color={colors.brandPrimary} />
                          <Text style={styles.guideTitle}>{g.title}</Text>
                        </View>
                        {g.steps.map((s, si) => (
                          <View key={si} style={styles.stepRow}>
                            <View style={styles.stepNum}>
                              <Text style={styles.stepNumText}>{si + 1}</Text>
                            </View>
                            <Text style={styles.stepText}>{s}</Text>
                          </View>
                        ))}
                      </View>
                    ))}
                    {(t.articles || []).map((a, ai) => (
                      <View key={`a${ai}`} style={styles.article}>
                        <Text style={styles.articleQ}>{a.q}</Text>
                        <Text style={styles.articleA}>{a.a}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },

  aiCard: {
    backgroundColor: colors.brandPrimary + "0D",
    borderWidth: 1,
    borderColor: colors.brandPrimary + "26",
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  aiHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  aiHeadText: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  aiSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginTop: 2, marginBottom: spacing.md },
  askRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  askInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: font.regular,
    fontSize: fontSize.lg,
    color: colors.onSurface,
    maxHeight: 120,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  answerBox: { marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  answerText: { fontFamily: font.regular, fontSize: fontSize.lg, color: colors.onSurface, lineHeight: 22 },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 46,
    marginBottom: spacing.lg,
  },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: fontSize.lg, color: colors.onSurface },

  empty: { alignItems: "center", marginTop: 40, gap: spacing.sm },
  emptyText: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  emptySub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },

  topicCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    overflow: "hidden",
  },
  topicHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  topicIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  topicTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  topicSummary: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  topicBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },

  guide: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md },
  guideHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm },
  guideTitle: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginBottom: 6 },
  stepNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepNumText: { fontFamily: font.bold, fontSize: 11, color: colors.onBrandPrimary },
  stepText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 20 },

  article: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.md },
  articleQ: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface, marginBottom: 4 },
  articleA: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 20 },
});
