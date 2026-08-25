import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, ActivityIndicator, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Methods = { stripe: boolean; paypal: boolean; manual: boolean };
type Reminders = { enabled: boolean; mode: "all" | "direct"; excluded_platforms: string[]; days: number[] };
type AutoCharge = { enabled: boolean; days_before: number };

const OTHER_GATEWAYS = ["Adyen", "Braintree", "Mollie", "Square", "Authorize.net"];
const EXCLUDABLE_PLATFORMS = ["Airbnb", "Booking.com", "Vrbo"];
const DEFAULT_REMINDERS: Reminders = { enabled: false, mode: "all", excluded_platforms: [], days: [7, 3] };
const DEFAULT_AUTO_CHARGE: AutoCharge = { enabled: false, days_before: 60 };
const DELAY_PRESETS = [30, 45, 60, 90];

export default function PaymentsSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [methods, setMethods] = useState<Methods>({ stripe: true, paypal: false, manual: true });
  const [reminders, setReminders] = useState<Reminders>(DEFAULT_REMINDERS);
  const [autoCharge, setAutoCharge] = useState<AutoCharge>(DEFAULT_AUTO_CHARGE);
  const [customDays, setCustomDays] = useState("");
  const [loading, setLoading] = useState(true);
  const [showOthers, setShowOthers] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api.get("/preferences");
      setMethods({ ...{ stripe: true, paypal: false, manual: true }, ...(p.payment_methods || {}) });
      setReminders({ ...DEFAULT_REMINDERS, ...(p.payment_reminders || {}) });
      const ac = { ...DEFAULT_AUTO_CHARGE, ...(p.auto_charge || {}) };
      setAutoCharge(ac);
      setCustomDays(DELAY_PRESETS.includes(ac.days_before) ? "" : String(ac.days_before));
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

  async function saveReminders(next: Reminders) {
    setReminders(next);
    try {
      await api.put("/preferences", { payment_reminders: next });
    } catch {
      setReminders(reminders); // revert on failure
    }
  }

  async function saveAutoCharge(next: AutoCharge) {
    setAutoCharge(next);
    try {
      await api.put("/preferences", { auto_charge: next });
    } catch {
      setAutoCharge(autoCharge); // revert on failure
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

        <Text style={styles.group}>Encaissement automatique Booking.com</Text>
        <View style={styles.card} testID="auto-charge-card">
          <View style={styles.cardHead}>
            <View style={[styles.brandIcon, { backgroundColor: "#003580" }]}>
              <Ionicons name="card" size={20} color="#fff" />
            </View>
            <Text style={styles.cardTitle}>Encaissement auto</Text>
            <View style={[styles.statusBadge, autoCharge.enabled ? styles.statusOn : styles.statusOff]}>
              <Text style={[styles.statusText, autoCharge.enabled ? styles.statusTextOn : styles.statusTextOff]}>
                {autoCharge.enabled ? "Activé" : "Désactivé"}
              </Text>
            </View>
            <Switch
              testID="auto-charge-switch"
              value={autoCharge.enabled}
              onValueChange={(v) => saveAutoCharge({ ...autoCharge, enabled: v })}
              trackColor={{ false: colors.border, true: colors.brandPrimary }}
              thumbColor="#fff"
            />
          </View>
          <Text style={styles.reminderInfo}>
            Encaisse automatiquement par Stripe la carte bancaire des réservations Booking.com
            reçues via Channex, {autoCharge.days_before} jours avant l'arrivée du voyageur.
          </Text>
          {autoCharge.enabled && (
            <>
              <Text style={styles.subLabel}>Délai d'encaissement (jours avant l'arrivée)</Text>
              <View style={styles.chipRow}>
                {DELAY_PRESETS.map((d) => (
                  <ModeChip
                    key={d}
                    testID={`auto-charge-days-${d}`}
                    label={`J-${d}`}
                    active={autoCharge.days_before === d}
                    onPress={() => { setCustomDays(""); saveAutoCharge({ ...autoCharge, days_before: d }); }}
                  />
                ))}
                <TextInput
                  testID="auto-charge-days-custom"
                  value={customDays}
                  onChangeText={setCustomDays}
                  onEndEditing={() => {
                    const v = parseInt(customDays, 10);
                    if (v >= 1 && v <= 365) saveAutoCharge({ ...autoCharge, days_before: v });
                    else setCustomDays(DELAY_PRESETS.includes(autoCharge.days_before) ? "" : String(autoCharge.days_before));
                  }}
                  placeholder="Autre…"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  keyboardType="number-pad"
                  style={[styles.daysInput, !!customDays && !DELAY_PRESETS.includes(autoCharge.days_before) && styles.daysInputActive]}
                />
              </View>
              <Text style={styles.reminderHint}>
                Les réservations dont l'arrivée est déjà à moins de {autoCharge.days_before} jours sont encaissées
                au prochain passage (toutes les 6 h). En cas d'échec (carte refusée), 3 tentatives puis traitement manuel
                depuis la fiche réservation. Nécessite l'app « Stripe Tokenization » activée sur Channex (accès production).
              </Text>
            </>
          )}
        </View>

        <Text style={styles.group}>Relances de paiement automatiques</Text>
        <View style={styles.card} testID="payment-reminders-card">
          <View style={styles.cardHead}>
            <View style={[styles.brandIcon, { backgroundColor: "#FF9500" }]}>
              <Ionicons name="alarm-outline" size={20} color="#fff" />
            </View>
            <Text style={styles.cardTitle}>Rappels de solde</Text>
            <View style={[styles.statusBadge, reminders.enabled ? styles.statusOn : styles.statusOff]}>
              <Text style={[styles.statusText, reminders.enabled ? styles.statusTextOn : styles.statusTextOff]}>
                {reminders.enabled ? "Activé" : "Désactivé"}
              </Text>
            </View>
            <Switch
              testID="reminders-switch"
              value={reminders.enabled}
              onValueChange={(v) => saveReminders({ ...reminders, enabled: v })}
              trackColor={{ false: colors.border, true: colors.brandPrimary }}
              thumbColor="#fff"
            />
          </View>
          <Text style={styles.reminderInfo}>
            Email automatique au voyageur à J-7 puis J-3 avant l'arrivée si un solde reste dû.
          </Text>
          {reminders.enabled && (
            <>
              <Text style={styles.subLabel}>Réservations concernées</Text>
              <View style={styles.chipRow}>
                <ModeChip testID="reminders-mode-all" label="Toutes" active={reminders.mode === "all"}
                  onPress={() => saveReminders({ ...reminders, mode: "all" })} />
                <ModeChip testID="reminders-mode-direct" label="Directes uniquement" active={reminders.mode === "direct"}
                  onPress={() => saveReminders({ ...reminders, mode: "direct" })} />
              </View>
              {reminders.mode === "all" && (
                <>
                  <Text style={styles.subLabel}>Plateformes exclues</Text>
                  <View style={styles.chipRow}>
                    {EXCLUDABLE_PLATFORMS.map((p) => {
                      const on = reminders.excluded_platforms.includes(p);
                      return (
                        <ModeChip
                          key={p}
                          testID={`reminders-excl-${p}`}
                          label={p}
                          active={on}
                          onPress={() => saveReminders({
                            ...reminders,
                            excluded_platforms: on
                              ? reminders.excluded_platforms.filter((x) => x !== p)
                              : [...reminders.excluded_platforms, p],
                          })}
                        />
                      );
                    })}
                  </View>
                  <Text style={styles.reminderHint}>
                    Les voyageurs des plateformes sélectionnées ne recevront pas de relance
                    (ex. Airbnb encaisse directement le séjour).
                  </Text>
                </>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function ModeChip({ testID, label, active, onPress }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.modeChip, active && styles.modeChipActive]}>
      <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>{label}</Text>
    </Pressable>
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
  reminderInfo: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 20, marginTop: spacing.md },
  reminderHint: { fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, lineHeight: 16, marginTop: spacing.sm },
  subLabel: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.4, marginTop: spacing.md, marginBottom: spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  modeChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  modeChipActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "12" },
  modeChipText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  modeChipTextActive: { color: colors.brandPrimary },
  daysInput: { width: 84, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurface },
  daysInputActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "12" },
});
