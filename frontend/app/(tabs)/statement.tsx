import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  Modal, TextInput, Share, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";

import { api } from "@/src/api";
import { MenuButton } from "@/src/components/MenuButton";
import { PropertyPicker } from "@/src/components/PropertyPicker";
import { useAuth } from "@/src/context/AuthContext";
import { canModify } from "@/src/permissions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

dayjs.locale("fr");

const money = (n: number) => `${(n || 0).toFixed(2)} €`;

export default function Statement() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const editable = canModify(user);
  const [anchor, setAnchor] = useState(dayjs().startOf("month"));
  const [selectedProp, setSelectedProp] = useState("all");
  const [props, setProps] = useState<any[]>([]);
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expModal, setExpModal] = useState<any>(null);
  const [expLabel, setExpLabel] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expCharge, setExpCharge] = useState<"owner" | "concierge">("owner");
  const [feeModal, setFeeModal] = useState<any>(null);
  const [feeInput, setFeeInput] = useState("");
  const [savingFee, setSavingFee] = useState(false);
  const [commModal, setCommModal] = useState<any>(null);
  const [commInput, setCommInput] = useState("");
  const [savingComm, setSavingComm] = useState(false);

  const month = anchor.format("YYYY-MM");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const pr = await api.get("/properties");
      setProps(pr);
      const q = selectedProp !== "all" ? `&property_id=${selectedProp}` : "";
      const res = await api.get(`/owner-statement?month=${month}${q}`);
      setData(res.statements || []);
    } catch {}
    setLoading(false);
  }, [month, selectedProp]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function addExpense() {
    if (!expModal || !expLabel.trim()) return;
    try {
      await api.post("/statement-expenses", {
        property_id: expModal.property_id,
        month,
        label: expLabel.trim(),
        amount: parseFloat((expAmount || "0").replace(",", ".")) || 0,
        charge_to: expCharge,
      });
      setExpModal(null); setExpLabel(""); setExpAmount(""); setExpCharge("owner");
      load();
    } catch {}
  }

  async function delExpense(id: string) {
    try { await api.del(`/statement-expenses/${id}`); load(); } catch {}
  }

  async function saveFee() {
    if (!feeModal || savingFee) return;
    const prop = props.find((p) => p.id === feeModal.property_id);
    if (!prop) return;
    setSavingFee(true);
    const pct = parseFloat((feeInput || "0").replace(",", ".")) || 0;
    try {
      await api.put(`/properties/${prop.id}`, { ...prop, management_fee_pct: pct });
      setFeeModal(null);
      load();
    } catch {}
    setSavingFee(false);
  }

  async function saveComm(reset = false) {
    if (!commModal || savingComm) return;
    setSavingComm(true);
    try {
      await api.put("/statement-commission", {
        property_id: commModal.property_id,
        month,
        commission: reset ? null : (parseFloat((commInput || "0").replace(",", ".")) || 0),
      });
      setCommModal(null);
      load();
    } catch {}
    setSavingComm(false);
  }

  function shareStatement(s: any) {
    const t = s.totals;
    const lines = [
      `Relevé ${dayjs(month).format("MMMM YYYY")} — ${s.property_name}`,
      s.owner ? `Propriétaire : ${s.owner}` : "",
      ``,
      `Réservations : ${s.reservations_count}`,
      `Nuitées : ${money(t.nights)}`,
      `Frais de ménage : ${money(t.cleaning)}`,
      `Taxe de séjour (à reverser) : ${money(t.tax)}`,
      `Commissions plateforme : ${money(t.commission)}`,
      `Frais de gestion (${s.management_fee_pct}%) : ${money(t.management_fee)}`,
      t.owner_expenses ? `Dépenses propriétaire : ${money(t.owner_expenses)}` : "",
      t.concierge_expenses ? `Dépenses conciergerie : ${money(t.concierge_expenses)}` : "",
      ``,
      `➡ Revenu propriétaire : ${money(t.owner_revenue)}`,
      `➡ Revenu conciergerie : ${money(t.concierge_revenue)}`,
    ].filter(Boolean).join("\n");
    if (Platform.OS === "web") {
      try { (navigator as any).clipboard.writeText(lines); } catch {}
    } else {
      Share.share({ message: lines });
    }
  }

  const grand = data.reduce(
    (a, s) => ({
      owner: a.owner + (s.totals.owner_revenue || 0),
      concierge: a.concierge + (s.totals.concierge_revenue || 0),
      tax: a.tax + (s.totals.tax || 0),
    }),
    { owner: 0, concierge: 0, tax: 0 },
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.titleRow}>
          <MenuButton />
          <Text style={styles.title}>Relevé propriétaires</Text>
        </View>
        <View style={styles.monthNav}>
          <Pressable testID="stmt-prev" onPress={() => setAnchor((a) => a.subtract(1, "month"))} style={styles.navBtn}>
            <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.monthLabel}>{anchor.format("MMMM YYYY")}</Text>
          <Pressable testID="stmt-next" onPress={() => setAnchor((a) => a.add(1, "month"))} style={styles.navBtn}>
            <Ionicons name="chevron-forward" size={20} color={colors.onSurface} />
          </Pressable>
        </View>
        <PropertyPicker value={selectedProp} items={props} onSelect={setSelectedProp} testID="stmt-prop-picker" />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
          {selectedProp === "all" && data.length > 1 && (
            <View style={styles.grandCard}>
              <Text style={styles.grandTitle}>Total du mois — {data.length} logements</Text>
              <SummaryLine label="Revenu propriétaires" value={money(grand.owner)} accent />
              <SummaryLine label="Revenu conciergerie" value={money(grand.concierge)} accent />
              <SummaryLine label="Taxe de séjour à reverser" value={money(grand.tax)} />
            </View>
          )}

          {data.length === 0 && <Text style={styles.empty}>Aucun logement.</Text>}

          {data.map((s) => {
            const t = s.totals;
            const open = expanded[s.property_id];
            return (
              <View key={s.property_id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.propName}>{s.property_name}</Text>
                    <View style={styles.subRow}>
                      <Text style={styles.propSub}>{s.reservations_count} réservation{s.reservations_count > 1 ? "s" : ""}</Text>
                      {editable ? (
                        <Pressable testID={`stmt-fee-${s.property_id}`} onPress={() => { setFeeModal(s); setFeeInput(String(s.management_fee_pct || "")); }} style={styles.feePill}>
                          <Ionicons name="pencil" size={11} color={colors.brandPrimary} />
                          <Text style={styles.feePillText}>gestion {s.management_fee_pct}%</Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.propSub}> · gestion {s.management_fee_pct}%</Text>
                      )}
                    </View>
                  </View>
                  <Pressable testID={`stmt-share-${s.property_id}`} onPress={() => shareStatement(s)} style={styles.shareBtn}>
                    <Ionicons name={Platform.OS === "web" ? "copy-outline" : "share-outline"} size={18} color={colors.brandPrimary} />
                  </Pressable>
                </View>

                {/* Ventilation */}
                <Pressable testID={`stmt-toggle-${s.property_id}`} onPress={() => setExpanded((e) => ({ ...e, [s.property_id]: !open }))} style={styles.detailToggle}>
                  <Text style={styles.detailToggleText}>{open ? "Masquer" : "Voir"} le détail des réservations</Text>
                  <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.brandPrimary} />
                </Pressable>
                {open && (
                  <View style={styles.linesBox}>
                    {s.lines.length === 0 && <Text style={styles.propSub}>Aucune réservation ce mois-ci.</Text>}
                    {s.lines.map((l: any) => (
                      <View key={l.id} style={styles.lineRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.lineGuest} numberOfLines={1}>{l.guest_name || "—"}</Text>
                          <Text style={styles.lineDates}>{dayjs(l.check_in).format("DD/MM")}→{dayjs(l.check_out).format("DD/MM")} · {l.platform}</Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={styles.lineNights}>{money(l.nights)}</Text>
                          {(l.cleaning > 0 || l.tax > 0) && (
                            <Text style={styles.lineExtra}>+{money(l.cleaning)} mén. · {money(l.tax)} taxe</Text>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Récap tarifs */}
                <View style={styles.breakdown}>
                  <Row label="Nuitées (base voyageurs)" value={money(t.nights)} />
                  <Row label="Frais de ménage (conciergerie)" value={money(t.cleaning)} />
                  <Row label="Taxe de séjour (à reverser)" value={money(t.tax)} muted />
                  <View style={styles.brRow}>
                    <View style={styles.commLabelWrap}>
                      <Text style={styles.brLabel}>Commissions OTA</Text>
                      {editable ? (
                        <Pressable
                          testID={`stmt-comm-${s.property_id}`}
                          onPress={() => { setCommModal(s); setCommInput(String(t.commission || "")); }}
                          style={styles.commEditPill}
                        >
                          <Ionicons name="pencil" size={10} color={colors.brandPrimary} />
                          <Text style={styles.commEditText}>{t.commission_override != null ? "modifié" : "modifier"}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <Text style={styles.brValue}>-{money(t.commission)}</Text>
                  </View>
                  <Row label={`Frais de gestion (${s.management_fee_pct}%)`} value={money(t.management_fee)} />
                </View>

                {/* Dépenses */}
                <View style={styles.expBox}>
                  <View style={styles.expHead}>
                    <Text style={styles.expTitle}>Dépenses & frais</Text>
                    {editable && (
                      <Pressable testID={`stmt-add-exp-${s.property_id}`} onPress={() => setExpModal(s)} style={styles.addExpBtn}>
                        <Ionicons name="add" size={16} color={colors.onBrandPrimary} />
                        <Text style={styles.addExpText}>Ajouter</Text>
                      </Pressable>
                    )}
                  </View>
                  {(s.expenses || []).length === 0 && <Text style={styles.propSub}>Aucune dépense enregistrée.</Text>}
                  {(s.expenses || []).map((e: any) => (
                    <View key={e.id} style={styles.expRow}>
                      <View style={[styles.expTag, e.charge_to === "owner" ? styles.expTagOwner : styles.expTagConc]}>
                        <Text style={styles.expTagText}>{e.charge_to === "owner" ? "Propr." : "Concierg."}</Text>
                      </View>
                      <Text style={styles.expLabel} numberOfLines={1}>{e.label}</Text>
                      <Text style={styles.expAmount}>{money(e.amount)}</Text>
                      {editable && (
                        <Pressable testID={`stmt-del-exp-${e.id}`} onPress={() => delExpense(e.id)} hitSlop={6}>
                          <Ionicons name="close-circle" size={18} color={colors.onSurfaceTertiary} />
                        </Pressable>
                      )}
                    </View>
                  ))}
                </View>

                {/* Revenus */}
                <View style={styles.revenueBox}>
                  <SummaryLine label="Revenu propriétaire" value={money(t.owner_revenue)} accent />
                  <SummaryLine label="Revenu conciergerie" value={money(t.concierge_revenue)} accent />
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Add expense modal */}
      <Modal visible={!!expModal} transparent animationType="fade" onRequestClose={() => setExpModal(null)}>
        <Pressable style={styles.backdrop} onPress={() => setExpModal(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Nouvelle dépense</Text>
            <Text style={styles.sheetSub}>{expModal?.property_name} · {anchor.format("MMMM YYYY")}</Text>
            <Text style={styles.fieldLabel}>Libellé</Text>
            <TextInput testID="exp-label" value={expLabel} onChangeText={setExpLabel} placeholder="Ex : Réparation chauffe-eau" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <Text style={styles.fieldLabel}>Montant (€)</Text>
            <TextInput testID="exp-amount" value={expAmount} onChangeText={setExpAmount} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <Text style={styles.fieldLabel}>À la charge de</Text>
            <View style={styles.chargeRow}>
              {(["owner", "concierge"] as const).map((c) => (
                <Pressable key={c} testID={`exp-charge-${c}`} onPress={() => setExpCharge(c)} style={[styles.chargeChip, expCharge === c && styles.chargeChipOn]}>
                  <Text style={[styles.chargeText, expCharge === c && styles.chargeTextOn]}>{c === "owner" ? "Propriétaire" : "Conciergerie"}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable testID="exp-save" onPress={addExpense} disabled={!expLabel.trim()} style={[styles.saveBtn, !expLabel.trim() && { opacity: 0.5 }]}>
              <Text style={styles.saveText}>Enregistrer</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edit management fee modal */}
      <Modal visible={!!feeModal} transparent animationType="fade" onRequestClose={() => setFeeModal(null)}>
        <Pressable style={styles.backdrop} onPress={() => setFeeModal(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Frais de gestion</Text>
            <Text style={styles.sheetSub}>{feeModal?.property_name}</Text>
            <Text style={styles.fieldLabel}>Pourcentage (%)</Text>
            <TextInput testID="fee-input" value={feeInput} onChangeText={setFeeInput} keyboardType="decimal-pad" placeholder="20" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} autoFocus />
            <Text style={styles.feeHint}>Appliqué sur le montant des nuitées pour calculer le revenu conciergerie.</Text>
            <Pressable testID="fee-save" onPress={saveFee} disabled={savingFee} style={[styles.saveBtn, savingFee && { opacity: 0.6 }]}>
              {savingFee ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Enregistrer</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edit OTA commission modal */}
      <Modal visible={!!commModal} transparent animationType="fade" onRequestClose={() => setCommModal(null)}>
        <Pressable style={styles.backdrop} onPress={() => setCommModal(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Commissions OTA</Text>
            <Text style={styles.sheetSub}>{commModal?.property_name} · {anchor.format("MMMM YYYY")}</Text>
            <Text style={styles.fieldLabel}>Montant des commissions (€)</Text>
            <TextInput testID="comm-input" value={commInput} onChangeText={setCommInput} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} autoFocus />
            <Text style={styles.feeHint}>
              Déduit du revenu propriétaire. Valeur automatique (plateformes) : {money(commModal?.totals?.commission_auto || 0)}.
            </Text>
            <Pressable testID="comm-save" onPress={() => saveComm(false)} disabled={savingComm} style={[styles.saveBtn, savingComm && { opacity: 0.6 }]}>
              {savingComm ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Enregistrer</Text>}
            </Pressable>
            {commModal?.totals?.commission_override != null && (
              <Pressable testID="comm-reset" onPress={() => saveComm(true)} disabled={savingComm} style={styles.resetBtn}>
                <Text style={styles.resetText}>Revenir au calcul automatique</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Row({ label, value, muted }: any) {
  return (
    <View style={styles.brRow}>
      <Text style={[styles.brLabel, muted && { color: colors.onSurfaceTertiary }]}>{label}</Text>
      <Text style={[styles.brValue, muted && { color: colors.onSurfaceTertiary }]}>{value}</Text>
    </View>
  );
}

function SummaryLine({ label, value, accent }: any) {
  return (
    <View style={styles.sumRow}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={[styles.sumValue, accent && { color: colors.brandPrimary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.md },
  title: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  navBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  monthLabel: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, textTransform: "capitalize" },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: 40 },
  grandCard: { backgroundColor: colors.brandPrimary + "0F", borderWidth: 1, borderColor: colors.brandPrimary + "33", borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  grandTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  propName: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  propSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  subRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4, flexWrap: "wrap" },
  feePill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.brandPrimary + "14", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  feePillText: { fontFamily: font.semibold, fontSize: 11, color: colors.brandPrimary },
  feeHint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: spacing.sm, lineHeight: 17 },
  shareBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  detailToggle: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.md },
  detailToggleText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary },
  linesBox: { marginTop: spacing.sm, gap: 6 },
  lineRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  lineGuest: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  lineDates: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 1 },
  lineNights: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  lineExtra: { fontFamily: font.regular, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 1 },
  breakdown: { marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md },
  brRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  brLabel: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, flex: 1 },
  commLabelWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  commEditPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.brandPrimary + "14", paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  commEditText: { fontFamily: font.semibold, fontSize: 10, color: colors.brandPrimary },
  brValue: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  expBox: { marginTop: spacing.md },
  expHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  expTitle: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurface },
  addExpBtn: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: spacing.md },
  addExpText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onBrandPrimary },
  expRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  expTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  expTagOwner: { backgroundColor: "#FF950022" },
  expTagConc: { backgroundColor: colors.brandPrimary + "22" },
  expTagText: { fontFamily: font.semibold, fontSize: 10, color: colors.onSurfaceSecondary },
  expLabel: { flex: 1, fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
  expAmount: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  revenueBox: { marginTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.md },
  sumRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  sumLabel: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  sumValue: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  sheetTitle: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  sheetSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2, marginBottom: spacing.sm, textTransform: "capitalize" },
  fieldLabel: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: spacing.sm, marginBottom: 6 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface },
  chargeRow: { flexDirection: "row", gap: spacing.sm },
  chargeChip: { flex: 1, paddingVertical: 11, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, alignItems: "center" },
  chargeChipOn: { backgroundColor: colors.brandPrimary },
  chargeText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  chargeTextOn: { color: colors.onBrandPrimary },
  saveBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingVertical: 14, alignItems: "center" },
  saveText: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onBrandPrimary },
  resetBtn: { marginTop: spacing.md, paddingVertical: 10, alignItems: "center" },
  resetText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
});
