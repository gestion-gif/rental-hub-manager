import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Methods = { stripe: boolean; paypal: boolean; manual: boolean };

const OTHER_GATEWAYS = ["Adyen", "Braintree", "Mollie", "Square", "Authorize.net"];

export default function PaymentsSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [methods, setMethods] = useState<Methods>({ stripe: true, paypal: false, manual: true });
  const [loading, setLoading] = useState(true);
  const [showOthers, setShowOthers] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api.get("/preferences");
      setMethods({ ...{ stripe: true, paypal: false, manual: true }, ...(p.payment_methods || {}) });
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function toggle(key: keyof Methods, value: boolean) {
    const next = { ...methods, [key]: value };
    setMethods(next);
    try {
      await api.put("/preferences", { payment_methods: next });
    } catch {
      setMethods(methods); // revert on failure
    }
  }

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
        <Text style={styles.intro}>Traitement des paiements</Text>
        <Text style={styles.introSub}>Choisissez les passerelles et méthodes de paiement disponibles pour vos réservations.</Text>

        <Text style={styles.group}>Passerelles de paiement en ligne</Text>
        <GatewayCard
          testID="pay-stripe"
          icon="card"
          iconBg="#635BFF"
          title="Stripe"
          enabled={methods.stripe}
          onToggle={(v) => toggle("stripe", v)}
          bullets={[
            "Plus de 135 devises prises en charge pour une flexibilité globale.",
            "Connexion transparente avec vos réservations.",
            "Paiement via portefeuilles électroniques (Apple et Google Pay).",
          ]}
          note="Connecté via Emergent — aucune clé requise."
        />

        {!showOthers ? (
          <Pressable testID="show-other-gateways" onPress={() => setShowOthers(true)} style={styles.linkRow}>
            <Text style={styles.linkText}>Voir d'autres passerelles de paiement</Text>
            <Ionicons name="chevron-down" size={16} color={colors.brandPrimary} />
          </Pressable>
        ) : (
          <View style={styles.othersBox}>
            {OTHER_GATEWAYS.map((g) => (
              <View key={g} style={styles.otherRow}>
                <View style={styles.otherLeft}>
                  <View style={styles.otherIcon}><Ionicons name="card-outline" size={16} color={colors.onSurfaceSecondary} /></View>
                  <Text style={styles.otherName}>{g}</Text>
                </View>
                <View style={styles.soonBadge}><Text style={styles.soonText}>Bientôt</Text></View>
              </View>
            ))}
            <Pressable testID="hide-other-gateways" onPress={() => setShowOthers(false)} style={styles.linkRow}>
              <Text style={styles.linkText}>Masquer</Text>
              <Ionicons name="chevron-up" size={16} color={colors.brandPrimary} />
            </Pressable>
          </View>
        )}

        <Text style={styles.group}>Méthodes alternatives</Text>
        <GatewayCard
          testID="pay-paypal"
          icon="logo-paypal"
          iconBg="#003087"
          title="PayPal"
          enabled={methods.paypal}
          onToggle={(v) => toggle("paypal", v)}
          bullets={[
            "Nombre de devises prises en charge limité.",
            "La connexion nécessite une configuration supplémentaire.",
            "Diverses options de paiement.",
          ]}
        />
        <GatewayCard
          testID="pay-manual"
          icon="cash-outline"
          iconBg="#34C759"
          title="Paiements manuels"
          enabled={methods.manual}
          onToggle={(v) => toggle("manual", v)}
          bullets={[
            "Encaissement hors ligne : espèces, virement, chèque.",
            "Suivi manuel des paiements dans chaque réservation.",
          ]}
        />
      </ScrollView>
    </View>
  );
}

function Header({ insets, onBack }: any) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="payments-back" onPress={onBack} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title}>Paiement</Text>
      <View style={{ width: 34 }} />
    </View>
  );
}

function GatewayCard({ testID, icon, iconBg, title, enabled, onToggle, bullets, note }: any) {
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.cardHead}>
        <View style={[styles.brandIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={20} color="#fff" />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
        <View style={[styles.statusBadge, enabled ? styles.statusOn : styles.statusOff]}>
          <Text style={[styles.statusText, enabled ? styles.statusTextOn : styles.statusTextOff]}>
            {enabled ? "Activé" : "Désactivé"}
          </Text>
        </View>
        <Switch
          testID={`${testID}-switch`}
          value={enabled}
          onValueChange={onToggle}
          trackColor={{ false: colors.border, true: colors.brandPrimary }}
          thumbColor="#fff"
        />
      </View>
      <View style={styles.bullets}>
        {bullets.map((b: string, i: number) => (
          <View key={i} style={styles.bulletRow}>
            <Ionicons name="checkmark-circle" size={15} color={enabled ? colors.success : colors.onSurfaceTertiary} />
            <Text style={styles.bulletText}>{b}</Text>
          </View>
        ))}
      </View>
      {!!note && <Text style={styles.note}>{note}</Text>}
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
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle: { flex: 1, fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  statusBadge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  statusOn: { backgroundColor: "#E7F8EC" },
  statusOff: { backgroundColor: colors.surfaceSecondary },
  statusText: { fontFamily: font.semibold, fontSize: fontSize.sm },
  statusTextOn: { color: "#2FB350" },
  statusTextOff: { color: colors.onSurfaceTertiary },
  bullets: { marginTop: spacing.md, gap: 6 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  bulletText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 20 },
  note: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.brandPrimary, marginTop: spacing.md },
  linkRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: spacing.md },
  linkText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.brandPrimary },
  othersBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  otherRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  otherLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  otherIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  otherName: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
  soonBadge: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  soonText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
});
