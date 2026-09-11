import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  Switch, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const DAYS = [0, 1, 2, 3, 5, 7];

export default function ArrivalEmailSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState(2);
  const [extra, setExtra] = useState("");
  const [savedExtra, setSavedExtra] = useState("");
  const [props, setProps] = useState<any[]>([]);
  const [previewPid, setPreviewPid] = useState<string>("");
  const [preview, setPreview] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, pr] = await Promise.all([api.get("/preferences"), api.get("/properties")]);
      setProps(pr || []);
      const c = p.arrival_email || {};
      setEnabled(!!c.enabled);
      setDays(c.days_before ?? 2);
      setExtra(c.extra_message || "");
      setSavedExtra(c.extra_message || "");
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function save(next: { enabled?: boolean; days_before?: number; extra_message?: string }) {
    setSaving(true);
    try {
      const p = await api.put("/preferences", {
        arrival_email: {
          enabled: next.enabled ?? enabled,
          days_before: next.days_before ?? days,
          extra_message: next.extra_message ?? extra,
        },
      });
      const c = p.arrival_email || {};
      setEnabled(!!c.enabled);
      setDays(c.days_before ?? 2);
      setSavedExtra(c.extra_message || "");
    } catch {}
    setSaving(false);
  }

  const dayLabel = (d: number) => (d === 0 ? "Le jour même" : `J-${d}`);
  const extraDirty = extra !== savedExtra;

  async function showPreview(pid: string) {
    setPreviewPid(pid);
    setLoadingPreview(true);
    setTestResult(null);
    if (!testEmail) setTestEmail(user?.email || "");
    try {
      const pv = await api.get(`/preferences/arrival-email-preview?property_id=${pid}`);
      setPreview(pv);
    } catch {
      setPreview(null);
    }
    setLoadingPreview(false);
  }

  async function sendTest() {
    if (!previewPid || sendingTest) return;
    setSendingTest(true);
    setTestResult(null);
    try {
      const res = await api.post("/preferences/arrival-email-test", { property_id: previewPid, email: testEmail.trim() });
      setTestResult({ ok: true, msg: `Email de test envoyé à ${res.to}. Vérifiez votre boîte de réception.` });
    } catch (e: any) {
      setTestResult({ ok: false, msg: e?.message || "Échec de l'envoi de l'email de test." });
    }
    setSendingTest(false);
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <Header insets={insets} onBack={() => router.back()} saving={saving} />
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.container}>
        <Header insets={insets} onBack={() => router.back()} saving={saving} />
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>Email avant l'arrivée</Text>
          <Text style={styles.introSub}>
            Envoie automatiquement un email au voyageur avant son arrivée avec l'adresse du logement,
            les instructions d'accès et les codes (boîte à clés), plus un message personnalisé.
          </Text>

          <View style={styles.card}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Activer l'envoi automatique</Text>
                <Text style={styles.switchSub}>Un seul email par réservation, si le voyageur a un email.</Text>
              </View>
              <Switch
                testID="arrival-email-toggle"
                value={enabled}
                onValueChange={(v) => { setEnabled(v); save({ enabled: v }); }}
                trackColor={{ true: colors.brandPrimary }}
              />
            </View>
          </View>

          <Text style={styles.group}>Quand envoyer ?</Text>
          <View style={styles.card}>
            <View style={styles.chips}>
              {DAYS.map((d) => (
                <Pressable
                  key={d}
                  testID={`arrival-email-days-${d}`}
                  onPress={() => { if (d !== days) { setDays(d); save({ days_before: d }); } }}
                  style={[styles.chip, days === d && styles.chipOn]}
                >
                  <Text style={[styles.chipText, days === d && styles.chipTextOn]}>{dayLabel(d)}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.selectedRow}>
              <Ionicons name="mail-unread-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.selectedText}>
                Envoi : <Text style={{ fontFamily: font.bold }}>{dayLabel(days)}</Text>
                {days > 0 ? ` (${days} jour${days > 1 ? "s" : ""} avant l'arrivée)` : " (jour de l'arrivée)"}
              </Text>
            </View>
          </View>

          <Text style={styles.group}>Message global (optionnel)</Text>
          <View style={styles.card}>
            <TextInput
              testID="arrival-email-extra"
              style={styles.input}
              value={extra}
              onChangeText={setExtra}
              placeholder="Ex. : Le parking se trouve derrière la résidence. Bon voyage !"
              placeholderTextColor={colors.onSurfaceTertiary}
              multiline
              maxLength={1500}
            />
            {extraDirty && (
              <Pressable testID="arrival-email-save" onPress={() => save({ extra_message: extra })} style={styles.saveBtn} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : (
                  <Text style={styles.saveBtnText}>Enregistrer le message</Text>
                )}
              </Pressable>
            )}
          </View>

          <Text style={styles.group}>Aperçu de l'email</Text>
          <View style={styles.card}>
            <Text style={styles.switchSub}>
              Choisissez un logement pour voir l'email tel que le voyageur le recevra
              (exemple avec « Jean Dupont »).
            </Text>
            <View style={[styles.chips, { marginTop: spacing.md }]}>
              {props.map((p) => (
                <Pressable key={p.id} testID={`preview-prop-${p.id}`} onPress={() => showPreview(p.id)}
                  style={[styles.chip, previewPid === p.id && styles.chipOn]}>
                  <Text style={[styles.chipText, previewPid === p.id && styles.chipTextOn]} numberOfLines={1}>{p.name}</Text>
                </Pressable>
              ))}
            </View>
            {loadingPreview && <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.brandPrimary} />}
            {!loadingPreview && preview?.empty && (
              <View style={styles.previewEmpty}>
                <Ionicons name="alert-circle-outline" size={16} color="#FF9500" />
                <Text style={styles.previewEmptyText}>
                  Aucun email ne serait envoyé pour « {preview.property_name} » : ce logement n'a ni
                  instructions clés ni message personnalisé, et aucun message global n'est défini.
                </Text>
              </View>
            )}
            {!loadingPreview && preview && !preview.empty && (
              <View style={styles.mail} testID="email-preview">
                <View style={styles.mailSubjectRow}>
                  <Text style={styles.mailSubjectLabel}>Objet</Text>
                  <Text style={styles.mailSubject} numberOfLines={2}>{preview.subject}</Text>
                </View>
                <View style={styles.mailBody}>
                  <Text style={styles.mailBrand}>{preview.parts.brand}</Text>
                  <Text style={styles.mailText}>Bonjour {preview.parts.guest_name},</Text>
                  <Text style={styles.mailText}>
                    Votre séjour à <Text style={styles.mailBold}>{preview.parts.property_name}</Text> approche
                    {" "}({preview.parts.check_in} → {preview.parts.check_out}). Voici les informations pour votre arrivée :
                  </Text>
                  {!!preview.parts.address && (
                    <Text style={styles.mailText}><Text style={styles.mailBold}>Adresse :</Text> {preview.parts.address}</Text>
                  )}
                  {!!preview.parts.checkin_time && (
                    <Text style={styles.mailText}><Text style={styles.mailBold}>Arrivée à partir de :</Text> {preview.parts.checkin_time}</Text>
                  )}
                  {!!preview.parts.instructions && (
                    <View style={styles.mailInstr}>
                      <Text style={styles.mailInstrTitle}>Instructions d'accès & codes</Text>
                      <Text style={styles.mailInstrText}>{preview.parts.instructions}</Text>
                    </View>
                  )}
                  {preview.parts.photos?.length > 0 && (
                    <Text style={styles.mailLink}>
                      📎 {preview.parts.photos.length} photo{preview.parts.photos.length > 1 ? "s" : ""} (accès aux clés) en lien dans l'email
                    </Text>
                  )}
                  {!!preview.parts.message && <Text style={styles.mailText}>{preview.parts.message}</Text>}
                  <Text style={styles.mailText}>Excellent séjour !</Text>
                  <Text style={styles.mailFooter}>Envoyé par {preview.parts.brand}.</Text>
                </View>
              </View>
            )}
            {!loadingPreview && preview && !preview.empty && (
              <View style={styles.testBox}>
                <Text style={styles.testLabel}>Recevoir cet email en conditions réelles</Text>
                <TextInput
                  testID="test-email-input"
                  style={styles.testInput}
                  value={testEmail}
                  onChangeText={(v) => { setTestEmail(v); setTestResult(null); }}
                  placeholder="votre@email.com"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  testID="send-test-email"
                  onPress={sendTest}
                  disabled={sendingTest || !testEmail.trim()}
                  style={[styles.testBtn, (sendingTest || !testEmail.trim()) && { opacity: 0.5 }]}
                >
                  {sendingTest ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : (
                    <>
                      <Ionicons name="paper-plane-outline" size={15} color={colors.onBrandPrimary} />
                      <Text style={styles.testBtnText}>M'envoyer l'email de test</Text>
                    </>
                  )}
                </Pressable>
                {testResult && (
                  <View style={styles.testResultRow}>
                    <Ionicons name={testResult.ok ? "checkmark-circle" : "alert-circle"} size={15}
                      color={testResult.ok ? colors.success : "#FF3B30"} />
                    <Text style={[styles.testResultText, { color: testResult.ok ? colors.success : "#FF3B30" }]}>
                      {testResult.msg}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.infoText}>
              Les instructions d'accès et codes proviennent de la fiche de chaque logement
              (champ « Instructions clés »). Chaque logement peut aussi définir son propre
              message dans sa fiche (section « Email avant l'arrivée ») — il remplace alors
              le message global ci-dessus. Si un logement n'a ni instructions ni message,
              aucun email n'est envoyé pour ce logement.
            </Text>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function Header({ insets, onBack, saving }: any) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="arrival-email-back" onPress={onBack} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title}>Email avant l'arrivée</Text>
      <View style={{ width: 34, alignItems: "center" }}>
        {saving && <ActivityIndicator size="small" color={colors.brandPrimary} />}
      </View>
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
  group: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  switchLabel: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  switchSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  chipOn: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  chipTextOn: { color: colors.onBrandPrimary },
  selectedRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  selectedText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  input: { minHeight: 90, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, textAlignVertical: "top" },
  saveBtn: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  saveBtnText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
  infoBox: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, alignItems: "flex-start" },
  infoText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, lineHeight: 19 },
  // Aperçu email : couleurs fixes (l'email est identique en thème clair et sombre)
  previewEmpty: { flexDirection: "row", gap: 6, marginTop: spacing.md, alignItems: "flex-start" },
  previewEmptyText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: "#FF9500", lineHeight: 18 },
  mail: { marginTop: spacing.md, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: "#E5E5EA", backgroundColor: "#FFFFFF" },
  mailSubjectRow: { flexDirection: "row", gap: 8, padding: spacing.md, backgroundColor: "#F5F5F7", borderBottomWidth: 1, borderBottomColor: "#E5E5EA", alignItems: "center" },
  mailSubjectLabel: { fontFamily: font.bold, fontSize: fontSize.xs, color: "#8E8E93", textTransform: "uppercase" },
  mailSubject: { flex: 1, fontFamily: font.semibold, fontSize: fontSize.sm, color: "#1C1C1E" },
  mailBody: { padding: spacing.lg, gap: spacing.sm },
  mailBrand: { fontFamily: font.bold, fontSize: fontSize.lg, color: "#1C1C1E", marginBottom: 2 },
  mailText: { fontFamily: font.regular, fontSize: fontSize.sm, color: "#3A3A3C", lineHeight: 20 },
  mailBold: { fontFamily: font.bold, color: "#1C1C1E" },
  mailInstr: { backgroundColor: "#F5F5F7", borderRadius: radius.md, padding: spacing.md },
  mailInstrTitle: { fontFamily: font.bold, fontSize: fontSize.sm, color: "#1C1C1E", marginBottom: 4 },
  mailInstrText: { fontFamily: font.regular, fontSize: fontSize.sm, color: "#3A3A3C", lineHeight: 20 },
  mailLink: { fontFamily: font.medium, fontSize: fontSize.sm, color: "#2A6F9E" },
  mailFooter: { fontFamily: font.regular, fontSize: fontSize.xs, color: "#8E8E93", marginTop: 4 },
  testBox: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  testLabel: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurface, marginBottom: spacing.sm },
  testInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, backgroundColor: colors.surfaceSecondary },
  testBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12 },
  testBtnText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
  testResultRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: spacing.sm },
  testResultText: { flex: 1, fontFamily: font.medium, fontSize: fontSize.sm, lineHeight: 18 },
});
