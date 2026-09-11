import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, ActivityIndicator } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function AssistantSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [autoDraft, setAutoDraft] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const p = await api.get("/preferences");
      setAutoDraft(p.ai_auto_draft !== false);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function toggle(value: boolean) {
    const prev = autoDraft;
    setAutoDraft(value);
    try {
      await api.put("/preferences", { ai_auto_draft: value });
    } catch {
      setAutoDraft(prev);
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="assistant-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Assistant IA</Text>
        <View style={{ width: 34 }} />
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>Réponses voyageurs</Text>
          <Text style={styles.introSub}>Configurez la manière dont l'assistant IA prépare vos réponses.</Text>

          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={styles.brandIcon}>
                <Ionicons name="sparkles" size={20} color={colors.onBrandPrimary} />
              </View>
              <Text style={styles.cardTitle}>Brouillons automatiques</Text>
              <Switch
                testID="auto-draft-switch"
                value={autoDraft}
                onValueChange={toggle}
                trackColor={{ false: colors.border, true: colors.brandPrimary }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.bullets}>
              <Bullet on={autoDraft} text="Un brouillon de réponse est préparé automatiquement dès qu'un voyageur écrit." />
              <Bullet on={autoDraft} text="Une notification « réponse à valider » apparaît sur l'accueil." />
              <Bullet on={autoDraft} text="Rien n'est jamais envoyé sans votre validation." />
            </View>
            {!autoDraft && (
              <Text style={styles.note}>
                Désactivé : vous pourrez toujours générer un brouillon manuellement dans chaque conversation via « Proposer une réponse (IA) ».
              </Text>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function Bullet({ on, text }: { on: boolean; text: string }) {
  return (
    <View style={styles.bulletRow}>
      <Ionicons name="checkmark-circle" size={15} color={on ? colors.success : colors.onSurfaceTertiary} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  intro: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  introSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: spacing.md, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandPrimary },
  cardTitle: { flex: 1, fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  bullets: { marginTop: spacing.md, gap: 6 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  bulletText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 20 },
  note: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: spacing.md, lineHeight: 18 },
});
