import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, ActivityIndicator } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Checkin = {
  enabled: boolean;
  require_before_arrival: boolean;
  auto_reminders: boolean;
  predefined: Record<string, boolean>;
  custom_questions: { id: string; label: string }[];
};

const DEFAULT: Checkin = {
  enabled: false,
  require_before_arrival: false,
  auto_reminders: true,
  predefined: { guests_count: true, phone_email: true, arrival_info: true, arrival_time: true, holder_id: false, other_guests_id: false, upload_id: false },
  custom_questions: [],
};

export default function OnlineCheckinSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [cfg, setCfg] = useState<Checkin>(DEFAULT);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const p = await api.get("/preferences");
      setCfg({ ...DEFAULT, ...(p.online_checkin || {}) });
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function toggleEnabled(v: boolean) {
    const next = { ...cfg, enabled: v };
    setCfg(next);
    try { await api.put("/preferences", { online_checkin: next }); } catch { setCfg(cfg); }
  }

  const activeCount = Object.values(cfg.predefined || {}).filter(Boolean).length + (cfg.custom_questions?.length || 0);

  if (loading) {
    return (
      <View style={styles.container}>
        <Header insets={insets} onBack={() => router.back()} />
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header insets={insets} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Enregistrement en ligne</Text>
        <Text style={styles.introSub}>
          Gagnez du temps et de l'énergie en gérant vos enregistrements à partir d'un seul endroit. Des formulaires intégrés
          permettent de recueillir les coordonnées des clients et de répondre aux exigences réglementaires, tandis que des
          rappels automatisés permettent aux clients de ne pas oublier.
        </Text>

        <Text style={styles.group}>Enregistrement de la réservation</Text>
        <View style={styles.card} testID="checkin-form-card">
          <View style={styles.cardHead}>
            <View style={styles.brandIcon}><Ionicons name="clipboard-outline" size={20} color="#fff" /></View>
            <Text style={styles.cardTitle}>Formulaire d'enregistrement</Text>
            <View style={[styles.statusBadge, cfg.enabled ? styles.statusOn : styles.statusOff]}>
              <Text style={[styles.statusText, cfg.enabled ? styles.statusTextOn : styles.statusTextOff]}>
                {cfg.enabled ? "Activé" : "Désactivé"}
              </Text>
            </View>
            <Switch
              testID="checkin-enabled-switch"
              value={cfg.enabled}
              onValueChange={toggleEnabled}
              trackColor={{ false: colors.border, true: colors.brandPrimary }}
              thumbColor="#fff"
            />
          </View>
          <Text style={styles.cardSub}>
            Recueillez les informations essentielles sur l'invité avant l'arrivée grâce à des questions prédéfinies et personnalisées.
          </Text>
          <Pressable testID="open-checkin-form" onPress={() => router.push("/settings/checkin-form")} style={styles.editRow}>
            <Ionicons name="create-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.editText}>Modifier le formulaire d'enregistrement</Text>
            <View style={{ flex: 1 }} />
            <Text style={styles.countText}>{activeCount} question(s)</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </Pressable>
        </View>

        {cfg.enabled && (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.infoText}>
              Le formulaire est actif. Configurez les questions et les rappels dans « Modifier le formulaire d'enregistrement ».
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Header({ insets, onBack }: any) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="checkin-back" onPress={onBack} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title}>Enregistrement en ligne</Text>
      <View style={{ width: 34 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  intro: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  introSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: spacing.md, lineHeight: 20 },
  group: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#2A6F9E" },
  cardTitle: { flex: 1, fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  cardSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 20, marginTop: spacing.md },
  statusBadge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  statusOn: { backgroundColor: "#E7F8EC" },
  statusOff: { backgroundColor: colors.surfaceSecondary },
  statusText: { fontFamily: font.semibold, fontSize: fontSize.sm },
  statusTextOn: { color: "#2FB350" },
  statusTextOff: { color: colors.onSurfaceTertiary },
  editRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  editText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.brandPrimary },
  countText: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginRight: 4 },
  infoBox: { flexDirection: "row", gap: spacing.sm, backgroundColor: "#EAF3FA", borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm },
  infoText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, lineHeight: 19 },
});
