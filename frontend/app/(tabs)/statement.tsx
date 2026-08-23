import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator,
  Modal, TextInput, Share, Platform, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
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
  const [pdfBusy, setPdfBusy] = useState("");
  const [emailBusy, setEmailBusy] = useState("");
  const [emailAllBusy, setEmailAllBusy] = useState(false);
  const [company, setCompany] = useState<any>({});
  const [previewStmt, setPreviewStmt] = useState<any>(null);
  const [periodMode, setPeriodMode] = useState<"month" | "quarter" | "range">("month");
  const [qAnchor, setQAnchor] = useState(dayjs().startOf("month"));
  const [rangeStart, setRangeStart] = useState(dayjs().startOf("month").subtract(2, "month"));
  const [rangeEnd, setRangeEnd] = useState(dayjs().startOf("month"));
  const [periodLabel, setPeriodLabel] = useState("");
  const [periodKey, setPeriodKey] = useState("");

  const month = anchor.format("YYYY-MM");
  const LOGO_URL = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/assets/casaneo-logo.png`;
  const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

  function periodParams(): any {
    if (periodMode === "month") return { month };
    if (periodMode === "quarter") {
      const q = Math.floor(qAnchor.month() / 3);
      const s = dayjs().year(qAnchor.year()).month(q * 3).startOf("month");
      const e = s.add(2, "month").endOf("month");
      return { start: s.format("YYYY-MM-DD"), end: e.format("YYYY-MM-DD") };
    }
    return { start: rangeStart.startOf("month").format("YYYY-MM-DD"), end: rangeEnd.endOf("month").format("YYYY-MM-DD") };
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const pr = await api.get("/properties");
      setProps(pr);
      try { const prefs = await api.get("/preferences"); setCompany(prefs.company || {}); } catch {}
      const p = periodParams();
      const base = p.month ? `month=${p.month}` : `start=${p.start}&end=${p.end}`;
      const q = selectedProp !== "all" ? `&property_id=${selectedProp}` : "";
      const res = await api.get(`/owner-statement?${base}${q}`);
      setData(res.statements || []);
      setPeriodLabel(res.period_label || "");
      setPeriodKey(res.period_key || res.month || "");
    } catch {}
    setLoading(false);
  }, [month, selectedProp, periodMode, qAnchor, rangeStart, rangeEnd]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function addExpense() {
    if (!expModal || !expLabel.trim()) return;
    try {
      await api.post("/statement-expenses", {
        property_id: expModal.property_id,
        month: periodKey || month,
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

  function shareStatement(s: any) {
    const lines = statementLines(s);
    if (Platform.OS === "web") {
      try { (navigator as any).clipboard.writeText(lines); } catch {}
    } else {
      Share.share({ message: lines });
    }
  }

  async function saveComm(reset = false) {
    if (!commModal || savingComm) return;
    setSavingComm(true);
    try {
      await api.put("/statement-commission", {
        property_id: commModal.property_id,
        month: periodKey || month,
        commission: reset ? null : (parseFloat((commInput || "0").replace(",", ".")) || 0),
      });
      setCommModal(null);
      load();
    } catch {}
    setSavingComm(false);
  }

  function companyHeaderHtml(): string {
    const c = company || {};
    const logoSrc = c.logo_path ? `${BASE_URL}/api/company-logo/${c.logo_path}` : LOGO_URL;
    const logo = `<img src="${logoSrc}" alt="${c.name || "Casanéo"}" style="height:56px;display:block" />`;
    const addr = [c.address, [c.postal_code, c.city].filter(Boolean).join(" ")].filter((x: string) => (x || "").trim()).join(" · ");
    const contact = [c.phone ? "Tél. " + c.phone : "", c.email, c.website].filter(Boolean).join(" · ");
    const legal = [c.siret ? "SIRET " + c.siret : "", c.vat ? "TVA " + c.vat : ""].filter(Boolean).join(" · ");
    const right = (c.name || addr || contact || legal)
      ? `<div style="text-align:right;font-size:12px;color:#555;line-height:1.5">
          ${c.name ? `<div style="font-weight:700;color:#111;font-size:14px">${c.name}</div>` : ""}
          ${addr ? `<div>${addr}</div>` : ""}
          ${contact ? `<div>${contact}</div>` : ""}
          ${legal ? `<div style="color:#999">${legal}</div>` : ""}
        </div>` : "";
    return `<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <tr><td style="vertical-align:top">${logo}</td><td style="vertical-align:top">${right}</td></tr>
      </table>
      <div style="height:3px;background:#2A6F9E;border-radius:2px;margin-bottom:16px"></div>`;
  }

  function statementHtml(s: any): string {
    const t = s.totals;
    const rows = (s.lines || []).map((l: any) =>
      `<tr><td style="padding:6px 0;color:#555">${(l.guest_name || "—")} · ${dayjs(l.check_in).format("DD/MM")}→${dayjs(l.check_out).format("DD/MM")} (${l.platform || ""})</td><td style="padding:6px 0;text-align:right;font-weight:600">${money(l.nights)}</td></tr>`
    ).join("");
    const row = (lbl: string, val: string, bold = false, color = "#111") =>
      `<tr><td style="padding:5px 0;color:#555">${lbl}</td><td style="padding:5px 0;text-align:right;font-weight:${bold ? 700 : 400};color:${color}">${val}</td></tr>`;
    const reg = (t.tax_regional || 0) > 0 ? row("Taxe add. régionale (à reverser)", money(t.tax_regional)) : "";
    return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:16px">
      ${companyHeaderHtml()}
      <h2 style="color:#111;margin:0 0 4px">Relevé de gestion — ${periodLabel || dayjs(month).format("MMMM YYYY")}</h2>
      <h3 style="color:#2A6F9E;margin:12px 0 4px">${s.property_name}</h3>
      <p style="color:#777;margin:0 0 6px">${s.reservations_count} réservation(s) · Frais de gestion ${s.management_fee_pct}%${s.owner ? " · Propriétaire : " + s.owner : ""}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${rows ? `<tr><td colspan=2 style="padding-top:8px;font-weight:700;color:#2A6F9E">Réservations</td></tr>${rows}` : ""}
        <tr><td colspan=2 style="border-top:1px solid #eee;padding-top:8px"></td></tr>
        ${row("Nuitées (base voyageurs)", money(t.nights))}
        ${row("Frais de ménage (conciergerie)", money(t.cleaning))}
        ${row("Taxe de séjour (à reverser)", money(t.tax_sejour != null ? t.tax_sejour : t.tax))}
        ${reg}
        ${row("Commissions OTA", "-" + money(t.commission))}
        ${row(`Frais de gestion (${s.management_fee_pct}%)`, money(t.management_fee))}
        <tr><td colspan=2 style="border-top:2px solid #2A6F9E;padding-top:8px"></td></tr>
        ${row("Revenu propriétaire", money(t.owner_revenue), true, "#2A6F9E")}
        ${row("Revenu conciergerie", money(t.concierge_revenue))}
      </table>
      <p style="color:#aaa;font-size:12px;margin-top:24px">Édité via Casanéo</p>
    </div>`;
  }

  async function generatePdf(s: any) {
    if (pdfBusy) return;
    setPdfBusy(s.property_id);
    try {
      const { uri } = await Print.printToFileAsync({ html: statementHtml(s) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Relevé propriétaire" });
      }
    } catch {}
    setPdfBusy("");
  }

  async function emailOwner(s: any) {
    if (emailBusy) return;
    setEmailBusy(s.property_id);
    try {
      const res = await api.post("/owner-statement/email", { ...periodParams(), property_id: s.property_id, base_url: BASE_URL });
      if (res.sent) {
        Alert.alert("Relevé envoyé", `Le relevé a été envoyé à ${res.owner_name || "le propriétaire"} (${res.to}).`);
      } else if (res.reason === "no_owner_email") {
        Alert.alert("Email manquant", "Ajoutez l'email du propriétaire dans sa fiche pour lui envoyer le relevé.");
      } else {
        Alert.alert("Envoi impossible", "Aucune donnée à envoyer pour ce mois.");
      }
    } catch {
      Alert.alert("Erreur", "Envoi impossible.");
    }
    setEmailBusy("");
  }

  function emailAll() {
    if (emailAllBusy) return;
    Alert.alert(
      "Envoyer à tous les propriétaires",
      `Chaque propriétaire recevra un seul email regroupant tous ses logements pour ${periodLabel || dayjs(month).format("MMMM YYYY")}.`,
      [
        { text: "Annuler", style: "cancel" },
        { text: "Envoyer", onPress: doEmailAll },
      ],
    );
  }

  async function doEmailAll() {
    setEmailAllBusy(true);
    try {
      const res = await api.post("/owner-statement/email-all", { ...periodParams(), base_url: BASE_URL });
      const results = res.results || [];
      const ok = results.filter((r: any) => r.sent);
      const skipped = results.filter((r: any) => !r.sent);
      let msg = ok.length ? `${ok.length} relevé(s) envoyé(s) :\n` + ok.map((r: any) => `• ${r.owner_name} (${r.to})`).join("\n") : "Aucun relevé envoyé.";
      if (skipped.length) {
        msg += `\n\nNon envoyés (email propriétaire manquant) :\n` + skipped.map((r: any) => `• ${r.owner_name} — ${r.properties}`).join("\n");
      }
      Alert.alert("Envoi groupé", msg);
    } catch {
      Alert.alert("Erreur", "Envoi impossible.");
    }
    setEmailAllBusy(false);
  }

  function statementLines(s: any) {
    const t = s.totals;
    return [
      `Relevé ${periodLabel || dayjs(month).format("MMMM YYYY")} — ${s.property_name}`,
      s.owner ? `Propriétaire : ${s.owner}` : "",
      ``,
      `Réservations : ${s.reservations_count}`,
      `Nuitées : ${money(t.nights)}`,
      `Frais de ménage : ${money(t.cleaning)}`,
      `Taxe de séjour (à reverser) : ${money(t.tax_sejour != null ? t.tax_sejour : t.tax)}`,
      t.tax_regional > 0 ? `Taxe add. régionale (à reverser) : ${money(t.tax_regional)}` : "",
      `Commissions OTA : ${money(t.commission)}`,
      `Frais de gestion (${s.management_fee_pct}%) : ${money(t.management_fee)}`,
      t.owner_expenses ? `Dépenses propriétaire : ${money(t.owner_expenses)}` : "",
      t.concierge_expenses ? `Dépenses conciergerie : ${money(t.concierge_expenses)}` : "",
      ``,
      `➡ Revenu propriétaire : ${money(t.owner_revenue)}`,
      `➡ Revenu conciergerie : ${money(t.concierge_revenue)}`,
    ].filter(Boolean).join("\n");
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
          {editable && data.length > 0 && (
            <Pressable testID="stmt-email-all" onPress={emailAll} disabled={emailAllBusy} style={styles.emailAllBtn}>
              {emailAllBusy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : (
                <>
                  <Ionicons name="mail-outline" size={15} color={colors.onBrandPrimary} />
                  <Text style={styles.emailAllText}>Tout envoyer</Text>
                </>
              )}
            </Pressable>
          )}
        </View>
        <View style={styles.modeRow}>
          {([["month", "Mois"], ["quarter", "Trimestre"], ["range", "Plage"]] as const).map(([k, lbl]) => (
            <Pressable key={k} testID={`stmt-mode-${k}`} onPress={() => setPeriodMode(k)} style={[styles.modeChip, periodMode === k && styles.modeChipOn]}>
              <Text style={[styles.modeChipText, periodMode === k && styles.modeChipTextOn]}>{lbl}</Text>
            </Pressable>
          ))}
        </View>
        {periodMode === "month" && (
          <View style={styles.monthNav}>
            <Pressable testID="stmt-prev" onPress={() => setAnchor((a) => a.subtract(1, "month"))} style={styles.navBtn}>
              <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
            </Pressable>
            <Text style={styles.monthLabel}>{anchor.format("MMMM YYYY")}</Text>
            <Pressable testID="stmt-next" onPress={() => setAnchor((a) => a.add(1, "month"))} style={styles.navBtn}>
              <Ionicons name="chevron-forward" size={20} color={colors.onSurface} />
            </Pressable>
          </View>
        )}
        {periodMode === "quarter" && (
          <View style={styles.monthNav}>
            <Pressable testID="stmt-q-prev" onPress={() => setQAnchor((a) => a.subtract(3, "month"))} style={styles.navBtn}>
              <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
            </Pressable>
            <Text style={styles.monthLabel}>T{Math.floor(qAnchor.month() / 3) + 1} {qAnchor.year()}</Text>
            <Pressable testID="stmt-q-next" onPress={() => setQAnchor((a) => a.add(3, "month"))} style={styles.navBtn}>
              <Ionicons name="chevron-forward" size={20} color={colors.onSurface} />
            </Pressable>
          </View>
        )}
        {periodMode === "range" && (
          <View style={styles.rangeRow}>
            <View style={styles.rangeField}>
              <Text style={styles.rangeLabel}>Du</Text>
              <View style={styles.rangeStepper}>
                <Pressable testID="stmt-rs-prev" onPress={() => setRangeStart((d) => d.subtract(1, "month"))} hitSlop={8}><Ionicons name="chevron-back" size={16} color={colors.onSurface} /></Pressable>
                <Text style={styles.rangeVal}>{rangeStart.format("MMM YYYY")}</Text>
                <Pressable testID="stmt-rs-next" onPress={() => setRangeStart((d) => d.add(1, "month"))} hitSlop={8}><Ionicons name="chevron-forward" size={16} color={colors.onSurface} /></Pressable>
              </View>
            </View>
            <View style={styles.rangeField}>
              <Text style={styles.rangeLabel}>Au</Text>
              <View style={styles.rangeStepper}>
                <Pressable testID="stmt-re-prev" onPress={() => setRangeEnd((d) => d.subtract(1, "month"))} hitSlop={8}><Ionicons name="chevron-back" size={16} color={colors.onSurface} /></Pressable>
                <Text style={styles.rangeVal}>{rangeEnd.format("MMM YYYY")}</Text>
                <Pressable testID="stmt-re-next" onPress={() => setRangeEnd((d) => d.add(1, "month"))} hitSlop={8}><Ionicons name="chevron-forward" size={16} color={colors.onSurface} /></Pressable>
              </View>
            </View>
          </View>
        )}
        <PropertyPicker value={selectedProp} items={props} onSelect={setSelectedProp} testID="stmt-prop-picker" />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
          {selectedProp === "all" && data.length > 1 && (
            <View style={styles.grandCard}>
              <Text style={styles.grandTitle}>Total — {data.length} logements</Text>
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
                    {s.last_sent_at && (
                      <View style={styles.sentRow}>
                        <Ionicons name="checkmark-circle" size={12} color="#17B0A6" />
                        <Text style={styles.sentText}>Envoyé le {dayjs(s.last_sent_at).format("DD/MM/YYYY à HH:mm")}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.cardActions}>
                    <Pressable testID={`stmt-preview-${s.property_id}`} onPress={() => setPreviewStmt(s)} style={styles.shareBtn}>
                      <Ionicons name="eye-outline" size={18} color={colors.brandPrimary} />
                    </Pressable>
                    {editable && (
                      <Pressable testID={`stmt-email-${s.property_id}`} onPress={() => emailOwner(s)} disabled={emailBusy === s.property_id} style={styles.shareBtn}>
                        {emailBusy === s.property_id ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Ionicons name="mail-outline" size={18} color={colors.brandPrimary} />}
                      </Pressable>
                    )}
                    <Pressable testID={`stmt-pdf-${s.property_id}`} onPress={() => generatePdf(s)} disabled={pdfBusy === s.property_id} style={styles.shareBtn}>
                      {pdfBusy === s.property_id ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Ionicons name="document-text-outline" size={18} color={colors.brandPrimary} />}
                    </Pressable>
                    <Pressable testID={`stmt-share-${s.property_id}`} onPress={() => shareStatement(s)} style={styles.shareBtn}>
                      <Ionicons name={Platform.OS === "web" ? "copy-outline" : "share-outline"} size={18} color={colors.brandPrimary} />
                    </Pressable>
                  </View>
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
                  <Row label="Taxe de séjour (à reverser)" value={money(t.tax_sejour != null ? t.tax_sejour : t.tax)} muted />
                  {t.tax_regional > 0 && <Row label="Taxe add. régionale (à reverser)" value={money(t.tax_regional)} muted />}
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

      {/* Aperçu du relevé avant envoi */}
      <Modal visible={!!previewStmt} transparent animationType="slide" onRequestClose={() => setPreviewStmt(null)}>
        <View style={styles.previewWrap}>
          <View style={[styles.previewHeader, { paddingTop: insets.top + 8 }]}>
            <Text style={styles.previewHeaderTitle}>Aperçu du relevé</Text>
            <Pressable testID="preview-close" onPress={() => setPreviewStmt(null)} style={styles.previewClose}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}>
            {previewStmt && (() => {
              const s = previewStmt; const t = s.totals;
              const logoSrc = company?.logo_path ? `${BASE_URL}/api/company-logo/${company.logo_path}` : LOGO_URL;
              return (
                <View style={styles.previewDoc}>
                  <View style={styles.previewTop}>
                    <Image source={{ uri: logoSrc }} style={styles.previewLogo} contentFit="contain" />
                    <View style={{ flex: 1 }}>
                      {!!company?.name && <Text style={styles.previewCoName}>{company.name}</Text>}
                      {!!(company?.address || company?.city) && <Text style={styles.previewCoLine}>{[company?.address, [company?.postal_code, company?.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</Text>}
                      {!!(company?.phone || company?.email) && <Text style={styles.previewCoLine}>{[company?.phone ? "Tél. " + company.phone : "", company?.email].filter(Boolean).join(" · ")}</Text>}
                      {!!company?.siret && <Text style={styles.previewCoLegal}>SIRET {company.siret}</Text>}
                    </View>
                  </View>
                  <View style={styles.previewRule} />
                  <Text style={styles.previewH2}>Relevé de gestion — {periodLabel || dayjs(month).format("MMMM YYYY")}</Text>
                  <Text style={styles.previewH3}>{s.property_name}</Text>
                  <Text style={styles.previewMeta}>{s.reservations_count} réservation(s) · Frais de gestion {s.management_fee_pct}%{s.owner ? " · Propriétaire : " + s.owner : ""}</Text>
                  {(s.lines || []).length > 0 && <Text style={styles.previewSection}>Réservations</Text>}
                  {(s.lines || []).map((l: any) => (
                    <View key={l.id} style={styles.previewLine}>
                      <Text style={styles.previewLineL} numberOfLines={1}>{l.guest_name || "—"} · {dayjs(l.check_in).format("DD/MM")}→{dayjs(l.check_out).format("DD/MM")} ({l.platform})</Text>
                      <Text style={styles.previewLineV}>{money(l.nights)}</Text>
                    </View>
                  ))}
                  <View style={styles.previewRuleThin} />
                  <PreviewRow label="Nuitées (base voyageurs)" value={money(t.nights)} />
                  <PreviewRow label="Frais de ménage (conciergerie)" value={money(t.cleaning)} />
                  <PreviewRow label="Taxe de séjour (à reverser)" value={money(t.tax_sejour != null ? t.tax_sejour : t.tax)} />
                  {(t.tax_regional || 0) > 0 && <PreviewRow label="Taxe add. régionale (à reverser)" value={money(t.tax_regional)} />}
                  <PreviewRow label="Commissions OTA" value={"-" + money(t.commission)} />
                  <PreviewRow label={`Frais de gestion (${s.management_fee_pct}%)`} value={money(t.management_fee)} />
                  <View style={styles.previewRule} />
                  <PreviewRow label="Revenu propriétaire" value={money(t.owner_revenue)} bold />
                  <PreviewRow label="Revenu conciergerie" value={money(t.concierge_revenue)} />
                  {s.last_sent_at && (
                    <Text style={styles.previewSent}>Déjà envoyé le {dayjs(s.last_sent_at).format("DD/MM/YYYY à HH:mm")}{s.last_sent_to ? " à " + s.last_sent_to : ""}</Text>
                  )}
                </View>
              );
            })()}
          </ScrollView>
          {editable && previewStmt && (
            <View style={[styles.previewFooter, { paddingBottom: insets.bottom + 12 }]}>
              <Pressable testID="preview-send" onPress={() => { const s = previewStmt; setPreviewStmt(null); emailOwner(s); }} disabled={!!emailBusy} style={styles.previewSendBtn}>
                <Ionicons name="mail" size={18} color="#fff" />
                <Text style={styles.previewSendText}>Envoyer au propriétaire</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>

      {/* Add expense modal */}
      <Modal visible={!!expModal} transparent animationType="fade" onRequestClose={() => setExpModal(null)}>
        <Pressable style={styles.backdrop} onPress={() => setExpModal(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Nouvelle dépense</Text>
            <Text style={styles.sheetSub}>{expModal?.property_name} · {periodLabel || anchor.format("MMMM YYYY")}</Text>
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
            <Text style={styles.sheetSub}>{commModal?.property_name} · {periodLabel || anchor.format("MMMM YYYY")}</Text>
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

function PreviewRow({ label, value, bold }: any) {
  return (
    <View style={styles.previewRow}>
      <Text style={[styles.previewRowL, bold && { fontFamily: font.bold, color: "#2A6F9E" }]}>{label}</Text>
      <Text style={[styles.previewRowV, bold && { fontFamily: font.bold, color: "#2A6F9E" }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.md },
  title: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  emailAllBtn: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, minHeight: 36 },
  emailAllText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onBrandPrimary },
  modeRow: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.sm },
  modeChip: { flex: 1, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  modeChipOn: { backgroundColor: "#EAF3FA", borderColor: colors.brandPrimary },
  modeChipText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  modeChipTextOn: { color: colors.brandPrimary, fontFamily: font.semibold },
  rangeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  rangeField: { flex: 1 },
  rangeLabel: { fontFamily: font.medium, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, marginBottom: 4 },
  rangeStepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8 },
  rangeVal: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurface },
  sentRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  sentText: { fontFamily: font.medium, fontSize: fontSize.xs, color: "#17B0A6" },
  previewWrap: { flex: 1, backgroundColor: colors.surface },
  previewHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#2A6F9E", paddingHorizontal: spacing.lg, paddingBottom: 14, borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  previewHeaderTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: "#fff" },
  previewClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  previewDoc: { backgroundColor: "#fff", borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  previewTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  previewLogo: { width: 96, height: 56 },
  previewCoName: { fontFamily: font.bold, fontSize: fontSize.base, color: "#111", textAlign: "right" },
  previewCoLine: { fontFamily: font.regular, fontSize: fontSize.xs, color: "#555", textAlign: "right", marginTop: 1 },
  previewCoLegal: { fontFamily: font.regular, fontSize: fontSize.xs, color: "#999", textAlign: "right", marginTop: 1 },
  previewRule: { height: 3, backgroundColor: "#2A6F9E", borderRadius: 2, marginVertical: 14 },
  previewRuleThin: { height: 1, backgroundColor: "#eee", marginVertical: 10 },
  previewH2: { fontFamily: font.bold, fontSize: fontSize.xl, color: "#111" },
  previewH3: { fontFamily: font.semibold, fontSize: fontSize.lg, color: "#2A6F9E", marginTop: 10 },
  previewMeta: { fontFamily: font.regular, fontSize: fontSize.sm, color: "#777", marginTop: 2, marginBottom: 6 },
  previewSection: { fontFamily: font.bold, fontSize: fontSize.sm, color: "#2A6F9E", marginTop: 6, marginBottom: 2 },
  previewLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: 8 },
  previewLineL: { fontFamily: font.regular, fontSize: fontSize.sm, color: "#555", flex: 1 },
  previewLineV: { fontFamily: font.semibold, fontSize: fontSize.sm, color: "#111" },
  previewRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, gap: 8 },
  previewRowL: { fontFamily: font.regular, fontSize: fontSize.base, color: "#555", flex: 1 },
  previewRowV: { fontFamily: font.semibold, fontSize: fontSize.base, color: "#111" },
  previewSent: { fontFamily: font.medium, fontSize: fontSize.xs, color: "#17B0A6", marginTop: 14 },
  previewFooter: { paddingHorizontal: spacing.lg, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
  previewSendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#17B0A6", borderRadius: radius.md, paddingVertical: 14 },
  previewSendText: { fontFamily: font.semibold, fontSize: fontSize.base, color: "#fff" },
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
  cardActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
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
