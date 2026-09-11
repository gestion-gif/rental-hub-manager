import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Alert } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function PublicCheckin() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { slug, rid } = useLocalSearchParams<{ slug: string; rid: string }>();
  const [data, setData] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/public/site/${slug}/checkin/${rid}`);
      setData(d);
      setDone(!!d.submitted);
    } catch {}
    setLoading(false);
  }, [slug, rid]);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    const missing = (data?.questions || []).filter((q: any) => q.required && !(answers[q.id] || "").trim());
    if (missing.length) { Alert.alert("Champs requis", "Merci de répondre aux questions obligatoires."); return; }
    setSaving(true);
    try {
      await api.post(`/public/site/${slug}/checkin/${rid}`, { answers });
      setDone(true);
    } catch { Alert.alert("Erreur", "Envoi impossible."); }
    setSaving(false);
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  if (!data) return <View style={styles.center}><Text style={styles.err}>Formulaire indisponible.</Text></View>;

  if (done) {
    return (
      <View style={styles.center}>
        <View style={styles.okIcon}><Ionicons name="checkmark-circle" size={54} color="#2FB350" /></View>
        <Text style={styles.title}>Enregistrement complété</Text>
        <Text style={styles.sub}>Merci ! Vos informations ont bien été transmises.</Text>
        <Pressable testID="checkin-home" onPress={() => router.replace(`/book/${slug}`)} style={styles.homeBtn}>
          <Text style={styles.homeText}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="checkin-back" onPress={() => router.replace(`/book/${slug}`)} style={styles.backBtn}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.htitle}>Enregistrement</Text>
        <View style={{ width: 34 }} />
      </View>
      <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60, maxWidth: 680, alignSelf: "center", width: "100%" }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{data.property_name}</Text>
        <Text style={styles.sub}>{data.check_in} → {data.check_out}{data.guest_name ? ` · ${data.guest_name}` : ""}</Text>
        <Text style={styles.intro}>Merci de compléter votre formulaire d'arrivée avant votre séjour.</Text>

        {(data.questions || []).map((q: any) => (
          <View key={q.id} style={{ marginTop: spacing.md }}>
            <Text style={styles.qLabel}>{q.label}{q.required ? " *" : ""}</Text>
            {q.type === "upload" ? (
              <Text style={styles.uploadNote}>Merci de préparer les copies des pièces d'identité (à présenter ou envoyer avant l'arrivée).</Text>
            ) : (
              <TextInput
                testID={`checkin-q-${q.id}`}
                value={answers[q.id] || ""}
                onChangeText={(t) => setAnswers((a) => ({ ...a, [q.id]: t }))}
                placeholder="Votre réponse"
                placeholderTextColor={colors.onSurfaceTertiary}
                style={styles.input}
                multiline={q.id === "arrival_info" || q.id === "other_guests_id"}
              />
            )}
          </View>
        ))}

        <Pressable testID="checkin-submit" onPress={submit} disabled={saving} style={[styles.submitBtn, saving && { opacity: 0.6 }]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Envoyer mon enregistrement</Text>}
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, padding: spacing.xl, gap: spacing.sm },
  err: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  htitle: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  title: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface, textAlign: "center" },
  sub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 4, textAlign: "center" },
  intro: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginTop: spacing.md, lineHeight: 20 },
  qLabel: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface, marginBottom: 6 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, minHeight: 46 },
  uploadNote: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, lineHeight: 18 },
  submitBtn: { backgroundColor: "#17B0A6", borderRadius: radius.lg, paddingVertical: 16, alignItems: "center", marginTop: spacing.xl },
  submitText: { fontFamily: font.bold, fontSize: fontSize.lg, color: "#fff" },
  okIcon: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center", backgroundColor: "#E7F8EC" },
  homeBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: spacing.xl, marginTop: spacing.md },
  homeText: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onBrandPrimary },
});
