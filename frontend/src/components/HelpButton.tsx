import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { SCREEN_HELP } from "@/src/data/help";

export function HelpButton({ screen }: { screen: string }) {
  const [visible, setVisible] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const info = SCREEN_HELP[screen];

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  async function ask() {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setAnswer("");
    try {
      const r = await api.post("/ai/help-ask", { question: q, screen: info?.title || screen });
      setAnswer(r.answer || "");
    } catch {
      setAnswer("Désolé, une erreur est survenue. Réessayez.");
    }
    setAsking(false);
  }

  const openCenter = () => {
    setVisible(false);
    router.push("/help");
  };

  return (
    <>
      <Pressable
        testID={`help-button-${screen}`}
        onPress={() => setVisible(true)}
        style={styles.trigger}
        hitSlop={8}
      >
        <Ionicons name="help-circle-outline" size={22} color={colors.onSurface} />
      </Pressable>

      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.sheetHead}>
            <View style={styles.sheetTitleWrap}>
              <Ionicons name="help-buoy-outline" size={18} color={colors.brandPrimary} />
              <Text style={styles.sheetTitle}>Aide — {info?.title || "cet écran"}</Text>
            </View>
            <Pressable testID="help-modal-close" onPress={() => setVisible(false)} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.onSurfaceTertiary} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingBottom: spacing.md }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {!!info?.intro && <Text style={styles.intro}>{info.intro}</Text>}

            {(info?.tips || []).map((t, i) => (
              <View key={i} style={styles.tipRow}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} style={{ marginTop: 1 }} />
                <Text style={styles.tipText}>{t}</Text>
              </View>
            ))}

            {/* Question rapide à l'IA */}
            <View style={styles.askRow}>
              <TextInput
                testID="help-modal-ask-input"
                value={question}
                onChangeText={setQuestion}
                placeholder="Une question ? Demandez à l'assistant…"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={styles.askInput}
                multiline
                onSubmitEditing={ask}
              />
              <Pressable testID="help-modal-ask-send" onPress={ask} style={styles.sendBtn}>
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
          </ScrollView>

          <Pressable testID="help-open-center" onPress={openCenter} style={styles.centerBtn}>
            <Ionicons name="library-outline" size={16} color={colors.onSurface} />
            <Text style={styles.centerBtnText}>Ouvrir le centre d'aide</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: "82%",
  },
  grabber: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  sheetTitleWrap: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  sheetTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  intro: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 20, marginBottom: spacing.md },
  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginBottom: spacing.sm },
  tipText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, lineHeight: 20 },
  askRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.md },
  askInput: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: font.regular,
    fontSize: fontSize.lg,
    color: colors.onSurface,
    maxHeight: 100,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  answerBox: { marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md },
  answerText: { fontFamily: font.regular, fontSize: fontSize.lg, color: colors.onSurface, lineHeight: 22 },
  centerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    marginTop: spacing.md,
  },
  centerBtnText: { flex: 1, fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
});
