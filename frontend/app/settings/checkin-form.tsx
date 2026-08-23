import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, ActivityIndicator, TextInput, Alert, Platform, KeyboardAvoidingView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Q = { id: string; label: string };
type Checkin = {
  enabled: boolean;
  require_before_arrival: boolean;
  auto_reminders: boolean;
  predefined: Record<string, boolean>;
  custom_questions: Q[];
};

const DEFAULT: Checkin = {
  enabled: false,
  require_before_arrival: false,
  auto_reminders: true,
  predefined: { guests_count: true, phone_email: true, arrival_info: true, arrival_time: true, holder_id: false, other_guests_id: false, upload_id: false },
  custom_questions: [],
};

// key, label, mandatory (non désactivable)
const PREDEFINED: { key: string; label: string; mandatory?: boolean }[] = [
  { key: "guests_count", label: "Combien d'invités séjourneront ?", mandatory: true },
  { key: "phone_email", label: "Veuillez indiquer votre numéro de téléphone et votre email." },
  { key: "arrival_info", label: "Faites-nous part de toute information qui pourrait nous aider à faciliter votre arrivée." },
  { key: "arrival_time", label: "À quelle heure pensez-vous arriver ?" },
  { key: "holder_id", label: "Veuillez fournir le nom complet et le numéro de pièce d'identité légale du titulaire de la réservation." },
  { key: "other_guests_id", label: "Veuillez indiquer les noms complets et les numéros des documents d'identité légaux de tous les autres invités (y compris les enfants)." },
  { key: "upload_id", label: "Veuillez télécharger des copies de tous les documents d'identité légaux." },
];

const MAX_CUSTOM = 5;

export default function CheckinFormBuilder() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [cfg, setCfg] = useState<Checkin>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api.get("/preferences");
      const oc = { ...DEFAULT, ...(p.online_checkin || {}) };
      oc.predefined = { ...DEFAULT.predefined, ...(oc.predefined || {}) };
      oc.predefined.guests_count = true;
      setCfg(oc);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function togglePredef(key: string) {
    if (key === "guests_count") return; // obligatoire
    setCfg((c) => ({ ...c, predefined: { ...c.predefined, [key]: !c.predefined[key] } }));
  }
  function addCustom() {
    setCfg((c) => {
      if ((c.custom_questions?.length || 0) >= MAX_CUSTOM) return c;
      const id = Math.random().toString(36).slice(2, 10);
      return { ...c, custom_questions: [...(c.custom_questions || []), { id, label: "" }] };
    });
  }
  function editCustom(id: string, label: string) {
    setCfg((c) => ({ ...c, custom_questions: c.custom_questions.map((q) => (q.id === id ? { ...q, label } : q)) }));
  }
  function removeCustom(id: string) {
    setCfg((c) => ({ ...c, custom_questions: c.custom_questions.filter((q) => q.id !== id) }));
  }

  async function save() {
    setSaving(true);
    const payload = { ...cfg, custom_questions: cfg.custom_questions.filter((q) => q.label.trim()) };
    try {
      await api.put("/preferences", { online_checkin: payload });
      setCfg(payload);
      Alert.alert("Enregistré", "Le formulaire d'enregistrement a été mis à jour.");
    } catch {
      Alert.alert("Erreur", "Impossible d'enregistrer. Réessayez.");
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <Header insets={insets} onBack={() => router.back()} />
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      </View>
    );
  }

  const customCount = cfg.custom_questions?.length || 0;

  return (
    <View style={styles.container}>
      <Header insets={insets} onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={insets.top + 60}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>Formulaire d'enregistrement</Text>
          <Text style={styles.introSub}>
            Oblige tous les futurs clients à remplir le formulaire d'enregistrement avant leur arrivée. Des rappels automatiques
            sont également activés pour s'assurer que le formulaire est bien rempli.
          </Text>

          <View style={styles.optCard}>
            <View style={styles.optRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.optTitle}>Rendre obligatoire avant l'arrivée</Text>
                <Text style={styles.optSub}>Le client doit compléter le formulaire avant son séjour.</Text>
              </View>
              <Switch
                testID="checkin-require-switch"
                value={cfg.require_before_arrival}
                onValueChange={(v) => setCfg((c) => ({ ...c, require_before_arrival: v }))}
                trackColor={{ false: colors.border, true: colors.brandPrimary }}
                thumbColor="#fff"
              />
            </View>
            <View style={[styles.optRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.md }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.optTitle}>Rappels automatiques</Text>
                <Text style={styles.optSub}>Relancer le client s'il n'a pas rempli le formulaire.</Text>
              </View>
              <Switch
                testID="checkin-reminders-switch"
                value={cfg.auto_reminders}
                onValueChange={(v) => setCfg((c) => ({ ...c, auto_reminders: v }))}
                trackColor={{ false: colors.border, true: colors.brandPrimary }}
                thumbColor="#fff"
              />
            </View>
          </View>

          <Text style={styles.group}>Questions prédéfinies</Text>
          <View style={styles.card}>
            {PREDEFINED.map((q, i) => {
              const on = q.mandatory ? true : !!cfg.predefined[q.key];
              return (
                <Pressable
                  key={q.key}
                  testID={`checkin-predef-${q.key}`}
                  onPress={() => togglePredef(q.key)}
                  disabled={q.mandatory}
                  style={[styles.qRow, i > 0 && styles.qRowBorder]}
                >
                  <View style={[styles.checkbox, on && styles.checkboxOn, q.mandatory && styles.checkboxLocked]}>
                    {on && <Ionicons name="checkmark" size={15} color="#fff" />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.qLabel}>{q.label}</Text>
                    {q.mandatory && <Text style={styles.mandatory}>Obligatoire</Text>}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.group}>Questions personnalisées</Text>
          <Text style={styles.groupSub}>Incluez jusqu'à 5 questions supplémentaires.</Text>
          <View style={styles.card}>
            {customCount === 0 ? (
              <Text style={styles.empty}>Aucune question personnalisée pour l'instant.</Text>
            ) : (
              cfg.custom_questions.map((q, i) => (
                <View key={q.id} style={[styles.customRow, i > 0 && styles.qRowBorder]}>
                  <View style={styles.numBadge}><Text style={styles.numText}>{i + 1}</Text></View>
                  <TextInput
                    testID={`checkin-custom-input-${i}`}
                    value={q.label}
                    onChangeText={(t) => editCustom(q.id, t)}
                    placeholder="Votre question…"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    style={styles.input}
                    multiline
                  />
                  <Pressable testID={`checkin-custom-del-${i}`} onPress={() => removeCustom(q.id)} style={styles.delBtn}>
                    <Ionicons name="trash-outline" size={18} color="#E5484D" />
                  </Pressable>
                </View>
              ))
            )}
            {customCount < MAX_CUSTOM ? (
              <Pressable testID="checkin-add-custom" onPress={addCustom} style={styles.addRow}>
                <Ionicons name="add-circle-outline" size={20} color={colors.brandPrimary} />
                <Text style={styles.addText}>Ajouter une question ({customCount}/{MAX_CUSTOM})</Text>
              </Pressable>
            ) : (
              <Text style={styles.maxNote}>Limite de {MAX_CUSTOM} questions atteinte.</Text>
            )}
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Pressable testID="checkin-save" onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Enregistrer</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Header({ insets, onBack }: any) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="checkin-form-back" onPress={onBack} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title}>Formulaire d'enregistrement</Text>
      <View style={{ width: 34 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  intro: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  introSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: spacing.md, lineHeight: 20 },
  optCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  optRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  optTitle: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  optSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2, lineHeight: 18 },
  group: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  groupSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: -4, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  qRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.md },
  qRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  checkboxLocked: { backgroundColor: colors.onSurfaceTertiary, borderColor: colors.onSurfaceTertiary },
  qLabel: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, lineHeight: 20 },
  mandatory: { fontFamily: font.semibold, fontSize: fontSize.sm, color: "#E5844B", marginTop: 3 },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, paddingVertical: spacing.sm },
  customRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  numBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  numText: { fontFamily: font.bold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  input: { flex: 1, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 42 },
  delBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  addRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.md, marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  addText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.brandPrimary },
  maxNote: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, paddingTop: spacing.md, marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  saveBtn: { backgroundColor: "#17B0A6", borderRadius: radius.lg, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  saveText: { fontFamily: font.bold, fontSize: fontSize.lg, color: "#fff" },
});
