import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

function Select({ label, value, options, onChange, testID }: any) {
  return (
    <View style={{ marginTop: spacing.md }}>
      {!!label && <Text style={styles.fieldLabel}>{label}</Text>}
      <View style={styles.selectWrap}>
        {options.map((o: any) => {
          const on = value === o.value;
          return (
            <Pressable key={o.value} testID={testID ? `${testID}-${o.value}` : undefined} onPress={() => onChange(o.value)} style={[styles.optRow, on && styles.optRowOn]}>
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={18} color={on ? colors.brandPrimary : colors.onSurfaceTertiary} />
              <Text style={[styles.optText, on && { color: colors.onSurface, fontFamily: font.semibold }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function BookingPolicyForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [count, setCount] = useState(1);
  const [p1, setP1] = useState("50");
  const [p2, setP2] = useState("25");
  const [cancellation, setCancellation] = useState("non_refundable");
  const [depositRequired, setDepositRequired] = useState(false);
  const [depositMethod, setDepositMethod] = useState("card_auth");
  const [amountType, setAmountType] = useState("percentage");
  const [amount, setAmount] = useState("");
  const [quoteHours, setQuoteHours] = useState("48");

  const load = useCallback(async () => {
    if (!editing) return;
    try {
      const r = await api.get("/booking-policies");
      const p = (r.policies || []).find((x: any) => x.id === id);
      if (p) {
        setName(p.name || "");
        setCount(p.payment_count || 1);
        setP1(String(p.payments?.[0]?.percent ?? 50));
        setP2(String(p.payments?.[1]?.percent ?? 25));
        setCancellation(p.cancellation || "non_refundable");
        setDepositRequired(!!p.deposit_required);
        setDepositMethod(p.deposit_method || "card_auth");
        setAmountType(p.deposit_amount_type || "percentage");
        setAmount(String(p.deposit_amount || ""));
        setQuoteHours(String(p.quote_expiration_hours || 48));
      }
    } catch {}
    setLoading(false);
  }, [id, editing]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const n1 = parseFloat(p1.replace(",", ".")) || 0;
  const n2 = parseFloat(p2.replace(",", ".")) || 0;
  const remainder = useMemo(() => {
    if (count === 1) return 100;
    if (count === 2) return Math.round((100 - n1) * 100) / 100;
    return Math.round((100 - n1 - n2) * 100) / 100;
  }, [count, n1, n2]);

  const paymentsValid = count === 1 || remainder >= 0;

  function buildPayments() {
    if (count === 1) return [{ percent: 100 }];
    if (count === 2) return [{ percent: n1 }, { percent: remainder }];
    return [{ percent: n1 }, { percent: n2 }, { percent: remainder }];
  }

  async function save() {
    if (!name.trim()) { Alert.alert("Nom requis", "Saisissez un nom interne."); return; }
    if (!paymentsValid) { Alert.alert("Répartition invalide", "La somme des paiements dépasse 100%."); return; }
    setSaving(true);
    const body = {
      name: name.trim(),
      payment_count: count,
      payments: buildPayments(),
      cancellation,
      deposit_required: depositRequired,
      deposit_method: depositMethod,
      deposit_amount_type: amountType,
      deposit_amount: parseFloat((amount || "0").replace(",", ".")) || 0,
      quote_expiration_hours: parseInt(quoteHours) || 48,
    };
    try {
      if (editing) await api.put(`/booking-policies/${id}`, body);
      else await api.post("/booking-policies", body);
      router.back();
    } catch {
      Alert.alert("Erreur", "Enregistrement impossible.");
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="bpf-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{editing ? "Modifier la politique" : "Nouvelle politique"}</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.fieldLabel}>Nom interne</Text>
          <TextInput testID="bpf-name" value={name} onChangeText={setName} placeholder="Ex : Standard non-remboursable" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />

          {/* Payment schedule */}
          <Text style={styles.section}>Planification du paiement</Text>
          <View style={styles.seg}>
            {[1, 2, 3].map((c) => (
              <Pressable key={c} testID={`bpf-count-${c}`} onPress={() => setCount(c)} style={[styles.segItem, count === c && styles.segItemOn]}>
                <Text style={[styles.segText, count === c && styles.segTextOn]}>{c} paiement{c > 1 ? "s" : ""}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.payRow}>
            <Text style={styles.payLabel}>Paiement 1</Text>
            {count === 1 ? (
              <Text style={styles.payFixed}>100 %</Text>
            ) : (
              <View style={styles.pctBox}><TextInput testID="bpf-p1" value={p1} onChangeText={setP1} keyboardType="decimal-pad" style={styles.pctInput} /><Text style={styles.pctSign}>%</Text></View>
            )}
          </View>
          {count >= 2 && (
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>Paiement 2</Text>
              {count === 2 ? (
                <Text style={styles.payFixed}>{remainder} %</Text>
              ) : (
                <View style={styles.pctBox}><TextInput testID="bpf-p2" value={p2} onChangeText={setP2} keyboardType="decimal-pad" style={styles.pctInput} /><Text style={styles.pctSign}>%</Text></View>
              )}
            </View>
          )}
          {count === 3 && (
            <View style={styles.payRow}>
              <Text style={styles.payLabel}>Paiement 3</Text>
              <Text style={styles.payFixed}>{remainder} %</Text>
            </View>
          )}
          {!paymentsValid && <Text style={styles.err}>La somme dépasse 100%.</Text>}

          {/* Cancellation */}
          <Text style={styles.section}>Annulation de l'invité</Text>
          <Select
            testID="bpf-cancel"
            value={cancellation}
            onChange={setCancellation}
            options={[
              { value: "non_refundable", label: "Non-remboursable" },
              { value: "fully_refundable", label: "Entièrement remboursable" },
              { value: "partially_refundable", label: "Partiellement remboursable" },
            ]}
          />
          <Text style={styles.note}>Tout montant déjà payé n'est pas remboursable. Les soldes restants impayés ne seront pas facturés.</Text>

          {/* Deposit */}
          <Text style={styles.section}>Caution</Text>
          <Select
            testID="bpf-deposit"
            value={depositRequired ? "yes" : "no"}
            onChange={(v: string) => setDepositRequired(v === "yes")}
            options={[
              { value: "no", label: "Une caution n'est pas requise" },
              { value: "yes", label: "Une caution est requise" },
            ]}
          />

          {depositRequired && (
            <>
              <Select
                label="1. Méthode de caution"
                testID="bpf-method"
                value={depositMethod}
                onChange={setDepositMethod}
                options={[
                  { value: "card_auth", label: "Autoriser le prélèvement sur la carte (recommandé)" },
                  { value: "manual", label: "Charger manuellement et rembourser la caution" },
                ]}
              />
              <Text style={styles.note}>La caution est remboursable et doit être collectée et remboursée en dehors de la plateforme.</Text>

              <Select
                label="2. Type de montant"
                testID="bpf-amount-type"
                value={amountType}
                onChange={setAmountType}
                options={[
                  { value: "percentage", label: "% du montant de la réservation" },
                  { value: "flat", label: "Montant forfaitaire" },
                ]}
              />
              <View style={{ marginTop: spacing.sm }}>
                <View style={styles.pctBox}>
                  <TextInput testID="bpf-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} style={styles.pctInput} />
                  <Text style={styles.pctSign}>{amountType === "percentage" ? "%" : "€"}</Text>
                </View>
              </View>
            </>
          )}

          {/* Quote expiration */}
          <Text style={styles.section}>Expiration du devis</Text>
          <View style={styles.payRow}>
            <Text style={styles.payLabel}>Valable</Text>
            <View style={styles.pctBox}>
              <TextInput testID="bpf-quote" value={quoteHours} onChangeText={setQuoteHours} keyboardType="number-pad" style={styles.pctInput} />
              <Text style={styles.pctSign}>h</Text>
            </View>
          </View>
          <Text style={styles.note}>Le devis est valable pour {quoteHours || "48"} heures maximum lorsqu'un devis a le statut « En attente de l'invité » ou « En attente de paiement ».</Text>

          <Pressable testID="bpf-save" onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Enregistrer</Text>}
          </Pressable>
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  section: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurface, marginTop: spacing.xl, marginBottom: 4 },
  fieldLabel: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginBottom: 6 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface },
  seg: { flexDirection: "row", gap: spacing.xs, marginTop: 8 },
  segItem: { flex: 1, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  segItemOn: { backgroundColor: "#EAF3FA", borderColor: colors.brandPrimary },
  segText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  segTextOn: { color: colors.brandPrimary, fontFamily: font.semibold },
  payRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  payLabel: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
  payFixed: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  pctBox: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: 14, minWidth: 110 },
  pctInput: { flex: 1, paddingVertical: 10, fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface, textAlign: "right" },
  pctSign: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginLeft: 6 },
  selectWrap: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden" },
  optRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.md, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  optRowOn: { backgroundColor: "#F5FAFE" },
  optText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  note: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 8, lineHeight: 18 },
  err: { fontFamily: font.medium, fontSize: fontSize.sm, color: "#E5484D", marginTop: 6 },
  saveBtn: { marginTop: spacing.xl, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  saveText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
});
