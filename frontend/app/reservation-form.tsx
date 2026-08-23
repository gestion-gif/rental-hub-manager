import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import * as WebBrowser from "expo-web-browser";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { usePreferences } from "@/src/context/PreferencesContext";
import { useAuth } from "@/src/context/AuthContext";
import { canSeePrices, canModify } from "@/src/permissions";
import { Field, PrimaryButton } from "@/src/components/ui";
import { Picker } from "@/src/components/Picker";
import DateField from "@/src/components/DateField";
import { PlatformLogo } from "@/src/components/PlatformLogo";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const PLATFORMS = ["Direct", "Airbnb", "Booking.com", "Vrbo"];

function priceForDay(prop: any, dayStr: string): number | null {
  if (!prop) return null;
  for (const s of (prop.seasons || [])) {
    if (s.start_date && s.end_date && dayStr >= s.start_date && dayStr <= s.end_date) return s.price;
  }
  return prop.base_price ?? null;
}

function computeNightsTotal(prop: any, ci: string, co: string): number {
  if (!prop || !ci || !co) return 0;
  let total = 0;
  let d = new Date(ci + "T00:00:00");
  const end = new Date(co + "T00:00:00");
  while (d < end) {
    const s = d.toISOString().slice(0, 10);
    total += priceForDay(prop, s) || 0;
    d.setDate(d.getDate() + 1);
  }
  return Math.round(total * 100) / 100;
}

function computeTouristTax(prop: any, nightsTotal: number): number {
  if (!prop) return 0;
  const pct = (parseFloat(prop.tourist_tax_pct) || 0) + (parseFloat(prop.regional_tax_pct) || 0);
  if (!pct) return 0;
  return Math.round(nightsTotal * pct) / 100;
}

export default function ReservationForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { stripe } = useLocalSearchParams<{ stripe?: string }>();
  const params = useLocalSearchParams<{ property?: string; check_in?: string; check_out?: string; status?: string }>();
  const editing = !!id;
  const { statuses } = usePreferences();
  const { user } = useAuth();
  const showPrices = canSeePrices(user);

  const [props, setProps] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payMsg, setPayMsg] = useState<string | null>(null);
  const [cautionValidated, setCautionValidated] = useState(false);
  const [cvBusy, setCvBusy] = useState(false);
  const [cvMsg, setCvMsg] = useState<string | null>(null);
  const [checklist, setChecklist] = useState({ caution: false, keys: false, welcome_book: false, cleaning: false });

  const [form, setForm] = useState({
    property_id: "",
    guest_first_name: "",
    guest_last_name: "",
    guest_email: "",
    guest_phone: "",
    platform: "Direct",
    check_in: "",
    check_out: "",
    guests: "2",
    nights_total: "",
    cleaning_fee: "",
    tourist_tax: "",
    status: "demande",
    notes: "",
  });

  useEffect(() => {
    (async () => {
      try {
        const pr = await api.get("/properties");
        setProps(pr);
        if (editing) {
          const list = await api.get("/reservations");
          const r = list.find((x: any) => x.id === id);
          if (r) {
            setDetail(r);
            setCautionValidated(!!r.caution_validated);
            setChecklist({ caution: false, keys: false, welcome_book: false, cleaning: false, ...(r.checklist || {}) });
            const fn = r.guest_first_name || (r.guest_name || "").split(" ")[0] || "";
            const ln = r.guest_last_name || (r.guest_name || "").split(" ").slice(1).join(" ") || "";
            const fin = r.finance || {};
            setForm({
              property_id: r.property_id,
              guest_first_name: fn,
              guest_last_name: ln,
              guest_email: r.guest_email || "",
              guest_phone: r.guest_phone || "",
              platform: r.platform || "Direct",
              check_in: r.check_in,
              check_out: r.check_out,
              guests: String(r.guests),
              nights_total: String(r.nights_total || fin.stay || r.total_price || ""),
              cleaning_fee: String(r.cleaning_fee || fin.fees || ""),
              tourist_tax: String(r.tourist_tax || fin.taxes || ""),
              status: r.status,
              notes: r.notes || "",
            });
          }
        } else if (pr.length) {
          const pid = params.property && pr.some((p: any) => p.id === params.property) ? params.property : pr[0].id;
          const ci = params.check_in || "";
          const co = params.check_out || "";
          const selProp = pr.find((p: any) => p.id === pid);
          const preNights = ci && co ? computeNightsTotal(selProp, ci, co) : 0;
          const preTax = computeTouristTax(selProp, preNights);
          setForm((f) => ({
            ...f,
            property_id: pid,
            check_in: ci || f.check_in,
            check_out: co || f.check_out,
            status: params.status || f.status,
            nights_total: preNights ? String(preNights) : f.nights_total,
            cleaning_fee: selProp?.default_cleaning_fee ? String(selProp.default_cleaning_fee) : f.cleaning_fee,
            tourist_tax: preTax ? String(preTax) : f.tourist_tax,
          }));
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Recalcule le prix des nuitées + la taxe de séjour quand le logement ou les dates changent (création)
  function recalcNights(next: any) {
    if (editing) return;
    const p = props.find((x) => x.id === next.property_id);
    if (p && next.check_in && next.check_out) {
      const v = computeNightsTotal(p, next.check_in, next.check_out);
      if (v) {
        const tax = computeTouristTax(p, v);
        setForm((f) => ({ ...f, nights_total: String(v), ...(tax ? { tourist_tax: String(tax) } : {}) }));
      }
    }
  }
  const setDate = (k: string, v: string) => {
    setForm((f) => {
      const nf = { ...f, [k]: v };
      recalcNights(nf);
      return nf;
    });
  };
  const setProperty = (v: string) => {
    setForm((f) => {
      const nf = { ...f, property_id: v };
      recalcNights(nf);
      return nf;
    });
    // Pré-remplir les frais par défaut du logement (création uniquement)
    if (!editing) {
      const p = props.find((x) => x.id === v);
      if (p) {
        setForm((f) => ({
          ...f,
          cleaning_fee: p.default_cleaning_fee ? String(p.default_cleaning_fee) : f.cleaning_fee,
        }));
      }
    }
  };

  const num = (s: string) => parseFloat((s || "0").replace(",", ".")) || 0;
  const totalPrice = num(form.nights_total) + num(form.cleaning_fee) + num(form.tourist_tax);

  const isBlocked = form.status === "bloque";
  const valid =
    form.property_id && form.check_in && form.check_out &&
    (isBlocked || form.guest_first_name.trim() || form.guest_last_name.trim());

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    const gname = `${form.guest_first_name} ${form.guest_last_name}`.trim() || (isBlocked ? "Bloqué" : "");
    const payload = {
      property_id: form.property_id,
      guest_first_name: form.guest_first_name.trim(),
      guest_last_name: form.guest_last_name.trim(),
      guest_name: gname,
      guest_email: form.guest_email.trim(),
      guest_phone: form.guest_phone.trim(),
      platform: form.platform,
      check_in: form.check_in,
      check_out: form.check_out,
      guests: parseInt(form.guests) || 1,
      nights_total: num(form.nights_total),
      cleaning_fee: num(form.cleaning_fee),
      tourist_tax: num(form.tourist_tax),
      total_price: totalPrice,
      status: form.status,
      notes: form.notes,
    };
    try {
      if (editing) await api.put(`/reservations/${id}`, payload);
      else await api.post("/reservations", payload);
      router.back();
    } catch {
      setSaving(false);
    }
  }

  async function remove() {
    await api.del(`/reservations/${id}`);
    router.back();
  }

  async function togglePaid() {
    const next = !((detail?.markers || []).includes("paid"));
    try {
      const updated = await api.patch(`/reservations/${id}/paid`, { paid: next });
      setDetail(updated);
    } catch {}
  }

  async function addPayment(amount: number) {
    try {
      const updated = await api.post(`/reservations/${id}/payments`, { amount });
      setDetail(updated);
    } catch {}
  }

  async function deletePayment(pid: string) {
    try {
      const updated = await api.del(`/reservations/${id}/payments/${pid}`);
      setDetail(updated);
    } catch {}
  }

  async function saveCommission(amount: number) {
    try {
      const updated = await api.patch(`/reservations/${id}/commission`, { amount });
      setDetail(updated);
    } catch {}
  }

  async function refreshDetail() {
    try {
      const list = await api.get("/reservations");
      const r = list.find((x: any) => x.id === id);
      if (r) setDetail(r);
    } catch {}
  }

  async function pollStatus(sessionId: string, attempts = 0): Promise<void> {
    if (attempts > 8) {
      setPayMsg("Paiement en attente de confirmation. Actualisez dans un instant.");
      return;
    }
    try {
      const s = await api.get(`/checkout/status/${sessionId}`);
      if (s.payment_status === "paid") {
        setPayMsg(s.kind === "deposit" ? "Caution encaissée ✓" : "Paiement reçu ✓");
        await refreshDetail();
        return;
      }
      if (s.status === "expired") {
        setPayMsg("Session de paiement expirée.");
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
    return pollStatus(sessionId, attempts + 1);
  }

  const PENDING_KEY = "pending_stripe_session";

  async function startCheckout(kind: "payment" | "deposit", amount?: number) {
    if (paying) return;
    setPaying(true);
    setPayMsg(null);
    try {
      const origin =
        Platform.OS === "web" ? window.location.origin : process.env.EXPO_PUBLIC_BACKEND_URL || "";
      const { url, session_id } = await api.post(`/reservations/${id}/checkout`, {
        kind,
        amount,
        origin_url: origin,
      });
      if (Platform.OS === "web") {
        await storage.setItem(PENDING_KEY, session_id);
        window.location.assign(url);
        return;
      }
      await WebBrowser.openBrowserAsync(url);
      setPayMsg("Vérification du paiement…");
      await pollStatus(session_id);
    } catch (e: any) {
      setPayMsg(e?.message || "Erreur lors du paiement");
    } finally {
      setPaying(false);
    }
  }

  async function toggleCautionValidated(next: boolean) {
    if (cvBusy) return;
    setCvBusy(true);
    setCvMsg(null);
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || "";
      const res = await api.patch(`/reservations/${id}/caution-validated`, { validated: next, base_url: base });
      setCautionValidated(res.caution_validated);
      if (res.keys_sent) {
        setCvMsg("Clés envoyées au voyageur ✓");
      } else if (next) {
        const reason = res.reason || "";
        if (reason === "already_sent") setCvMsg("Caution validée. Clés déjà envoyées précédemment.");
        else if (reason === "no_key_info") setCvMsg("Caution validée. Ajoutez le code/instructions des clés sur la fiche logement pour l'envoi auto.");
        else if (reason === "no_messaging" || reason === "no_channel") setCvMsg("Caution validée. Envoi auto indisponible (réservation hors Lodgify).");
        else if (reason.startsWith("send_error")) setCvMsg("Caution validée, mais l'envoi a échoué : " + reason.replace("send_error:", ""));
        else setCvMsg("Caution validée.");
      } else {
        setCvMsg(null);
      }
    } catch (e: any) {
      setCvMsg(e?.message || "Erreur");
    } finally {
      setCvBusy(false);
    }
  }

  async function toggleChecklistItem(key: "caution" | "keys" | "welcome_book" | "cleaning") {
    const next = { ...checklist, [key]: !checklist[key] };
    setChecklist(next);
    try {
      await api.patch(`/reservations/${id}/checklist`, { checklist: { [key]: next[key] } });
    } catch {
      setChecklist(checklist); // revert
    }
  }


  async function sendKeysNow() {
    if (cvBusy) return;
    setCvBusy(true);
    setCvMsg(null);
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || "";
      const res = await api.post(`/reservations/${id}/send-keys`, { base_url: base });
      if (res.keys_sent) {
        setCvMsg("Instructions des clés envoyées au voyageur ✓");
      } else {
        const reason = res.reason || "";
        if (reason === "no_key_info") setCvMsg("Ajoutez le code/instructions des clés sur la fiche logement.");
        else if (reason === "no_messaging" || reason === "no_channel") setCvMsg("Envoi indisponible (réservation hors Lodgify).");
        else setCvMsg("Envoi impossible.");
      }
    } catch (e: any) {
      setCvMsg(e?.message || "Erreur");
    } finally {
      setCvBusy(false);
    }
  }

  async function sendDepositLink() {
    if (cvBusy) return;
    setCvBusy(true);
    setCvMsg(null);
    try {
      const res = await api.post(`/reservations/${id}/send-deposit-link`, {});
      if (res.sent) {
        setCvMsg("Lien de caution envoyé au voyageur ✓");
        setDetail((d: any) => (d ? { ...d, deposit_link_sent_at: new Date().toISOString() } : d));
      } else {
        const reason = res.reason || "";
        if (reason === "no_deposit_link") setCvMsg("Ajoutez le lien de caution sur la fiche logement.");
        else if (reason === "no_messaging" || reason === "no_channel") setCvMsg("Envoi indisponible (réservation hors Lodgify).");
        else setCvMsg("Envoi impossible.");
      }
    } catch (e: any) {
      setCvMsg(e?.message || "Erreur");
    } finally {
      setCvBusy(false);
    }
  }




  useEffect(() => {
    if (!editing) return;
    (async () => {
      const pending = await storage.getItem(PENDING_KEY, "");
      if (stripe === "success" && pending) {
        setPaying(true);
        setPayMsg("Vérification du paiement…");
        await pollStatus(pending as string);
        await storage.removeItem(PENDING_KEY);
        setPaying(false);
      } else if (stripe === "cancel") {
        await storage.removeItem(PENDING_KEY);
        setPayMsg("Paiement annulé.");
      }
    })();
  }, [stripe, id]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.headerBanner, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerBadge}>
            {editing ? <PlatformLogo platform={form.platform} size={18} /> : <Ionicons name="add-circle" size={18} color="#fff" />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {editing ? (`${form.guest_first_name} ${form.guest_last_name}`.trim() || "Réservation") : "Nouvelle réservation"}
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {editing ? `${form.platform || "Direct"}${form.check_in ? " · " + dayjs(form.check_in).format("DD MMM") : ""}` : "Ajouter au calendrier"}
            </Text>
          </View>
          <Pressable testID="close-form" onPress={() => router.back()} style={styles.headerClose}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        </View>
      </View>

      {props.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.hintSub}>Ajoutez d'abord un logement.</Text>
        </View>
      ) : (
        <KeyboardAwareScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
          bottomOffset={20}
          showsVerticalScrollIndicator={false}
        >
          {showPrices && detail?.finance && <FinanceCard detail={detail} isPaid={(detail.markers || []).includes("paid")} onTogglePaid={togglePaid} onAddPayment={addPayment} onDeletePayment={deletePayment} onSetCommission={saveCommission} onCheckout={startCheckout} paying={paying} payMsg={payMsg} />}
          {editing && canModify(user) && (
            form.platform === "Airbnb" ? (
              <View style={styles.cvCard}>
                <View style={styles.cvHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cvTitle}>Clés · Airbnb</Text>
                    <Text style={styles.cvSub}>Airbnb — caution non requise. Les instructions des clés sont envoyées automatiquement au voyageur 1 jour avant l'arrivée.</Text>
                  </View>
                  <Ionicons name="key-outline" size={22} color={colors.brandPrimary} />
                </View>
                <Pressable
                  testID="send-keys-now"
                  onPress={sendKeysNow}
                  disabled={cvBusy}
                  style={[styles.sendKeysBtn, cvBusy && { opacity: 0.6 }]}
                >
                  {cvBusy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                    <>
                      <Ionicons name="paper-plane-outline" size={16} color={colors.onBrandPrimary} />
                      <Text style={styles.sendKeysText}>Envoyer les instructions des clés maintenant</Text>
                    </>
                  )}
                </Pressable>
                {!!cvMsg && <Text style={styles.cvMsg}>{cvMsg}</Text>}
              </View>
            ) : (
              <View style={styles.cvCard}>
                <View style={styles.cvHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cvTitle}>Caution validée</Text>
                    <Text style={styles.cvSub}>À activer une fois la caution reçue (via livretaccueil.com). Envoie automatiquement le code et les instructions des clés au voyageur.</Text>
                  </View>
                  <Pressable
                    testID="caution-validated-toggle"
                    onPress={() => toggleCautionValidated(!cautionValidated)}
                    disabled={cvBusy}
                    style={[styles.cvSwitch, cautionValidated && styles.cvSwitchOn, cvBusy && { opacity: 0.6 }]}
                  >
                    {cvBusy ? (
                      <ActivityIndicator size="small" color={cautionValidated ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
                    ) : (
                      <View style={[styles.cvKnob, cautionValidated && styles.cvKnobOn]} />
                    )}
                  </Pressable>
                </View>
                <Pressable
                  testID="send-deposit-link"
                  onPress={sendDepositLink}
                  disabled={cvBusy}
                  style={[styles.depositBtn, cvBusy && { opacity: 0.6 }]}
                >
                  <Ionicons name="paper-plane-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.depositText}>Envoyer le lien de caution au voyageur</Text>
                </Pressable>
                {(!!detail?.deposit_link_sent_at || !!detail?.deposit_reminder_sent_at) && (
                  <View style={styles.cautionHist}>
                    {!!detail?.deposit_link_sent_at && (
                      <Text style={styles.cautionHistText}>
                        <Ionicons name="checkmark-circle" size={12} color={colors.success} /> Lien envoyé le {dayjs(detail.deposit_link_sent_at).format("DD/MM/YYYY à HH:mm")}
                      </Text>
                    )}
                    {!!detail?.deposit_reminder_sent_at && (
                      <Text style={styles.cautionHistText}>
                        <Ionicons name="notifications" size={12} color={colors.warning} /> Relance envoyée le {dayjs(detail.deposit_reminder_sent_at).format("DD/MM/YYYY à HH:mm")}
                      </Text>
                    )}
                  </View>
                )}
                {!!cvMsg && <Text style={styles.cvMsg}>{cvMsg}</Text>}
              </View>
            )
          )}
          {editing && canModify(user) && (
            <View style={styles.clCard} testID="checklist-card">
              <View style={styles.clHead}>
                <Ionicons name="checkbox-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.clTitle}>Check-list d'arrivée</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.clCount}>
                  {Object.values(checklist).filter(Boolean).length}/4
                </Text>
              </View>
              {([
                { key: "caution", label: "Caution", icon: "shield-checkmark-outline" },
                { key: "keys", label: "Clés", icon: "key-outline" },
                { key: "welcome_book", label: "Livret d'accueil", icon: "book-outline" },
                { key: "cleaning", label: "Ménage", icon: "sparkles-outline" },
              ] as const).map((it) => {
                const on = (checklist as any)[it.key];
                return (
                  <Pressable key={it.key} testID={`checklist-${it.key}`} onPress={() => toggleChecklistItem(it.key)} style={styles.clRow}>
                    <View style={[styles.clBox, on && styles.clBoxOn]}>
                      {on && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                    <Ionicons name={it.icon as any} size={17} color={on ? colors.brandPrimary : colors.onSurfaceTertiary} />
                    <Text style={[styles.clLabel, on && styles.clLabelOn]}>{it.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <Text style={styles.label}>Logement</Text>
          <Picker
            testID="res-prop-picker"
            title="Choisir un logement"
            icon="business-outline"
            value={form.property_id}
            items={props.map((p) => ({ id: p.id, name: p.name }))}
            onSelect={setProperty}
          />

          <Text style={styles.label}>Statut</Text>
          <ChipRow
            items={statuses.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
            value={form.status}
            onSelect={(v: string) => set("status", v)}
            prefix="res-status"
          />

          <View style={{ height: spacing.lg }} />
          <Text style={styles.sectionTitle}>Voyageur</Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field label="Prénom" testID="guest-first-name" value={form.guest_first_name} onChangeText={(v) => set("guest_first_name", v)} placeholder="Jean" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Nom" testID="guest-last-name" value={form.guest_last_name} onChangeText={(v) => set("guest_last_name", v)} placeholder="Dupont" />
            </View>
          </View>
          <Field label="Téléphone" testID="guest-phone" value={form.guest_phone} onChangeText={(v) => set("guest_phone", v)} placeholder="+33 6 12 34 56 78" keyboardType="phone-pad" />
          <Field label="Email" testID="guest-email" value={form.guest_email} onChangeText={(v) => set("guest_email", v)} placeholder="jean@email.com" keyboardType="email-address" autoCapitalize="none" />

          <Text style={styles.label}>Plateforme</Text>
          <ChipRow
            items={PLATFORMS.map((p) => ({ key: p, label: p }))}
            value={form.platform}
            onSelect={(v: string) => set("platform", v)}
            prefix="res-platform"
          />
          <View style={{ height: spacing.lg }} />

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <DateField label="Arrivée" testID="check-in" value={form.check_in} onChange={(v) => setDate("check_in", v)} />
            </View>
            <View style={{ flex: 1 }}>
              <DateField label="Départ" testID="check-out" value={form.check_out} onChange={(v) => setDate("check_out", v)} minDate={form.check_in || undefined} />
            </View>
          </View>
          <Field label="Nombre de voyageurs" testID="guests" value={form.guests} onChangeText={(v) => set("guests", v)} keyboardType="number-pad" />

          {showPrices && (
            <>
              <Text style={styles.sectionTitle}>Tarifs</Text>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Field label="Prix des nuitées (€)" testID="nights-total" value={form.nights_total} onChangeText={(v) => set("nights_total", v)} keyboardType="decimal-pad" placeholder="0" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="Frais de ménage (€)" testID="cleaning-fee" value={form.cleaning_fee} onChangeText={(v) => set("cleaning_fee", v)} keyboardType="decimal-pad" placeholder="0" />
                </View>
              </View>
              <Field label="Taxe de séjour (€)" testID="tourist-tax" value={form.tourist_tax} onChangeText={(v) => set("tourist_tax", v)} keyboardType="decimal-pad" placeholder="0" />
              {(() => {
                const sp = props.find((p) => p.id === form.property_id);
                const tp = parseFloat(sp?.tourist_tax_pct) || 0;
                const rp = parseFloat(sp?.regional_tax_pct) || 0;
                if (!sp || (!tp && !rp)) return null;
                const parts = [tp ? `taxe de séjour ${tp}%` : "", rp ? `régionale ${rp}%` : ""].filter(Boolean).join(" + ");
                return <Text style={styles.priceHint}>Calculée automatiquement ({parts} du prix des nuitées) — modifiable.</Text>;
              })()}
              {!editing && !!form.nights_total && (
                <Text style={styles.priceHint}>Prix des nuitées pré-rempli d'après les tarifs par saison du logement — modifiable.</Text>
              )}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{totalPrice.toFixed(2)} €</Text>
              </View>
            </>
          )}

          <View style={{ height: spacing.md }} />
          <Field label="Notes" testID="notes" value={form.notes} onChangeText={(v) => set("notes", v)} placeholder="Informations complémentaires" multiline />

          {canModify(user) && (
            <PrimaryButton
              testID="save-reservation"
              label={editing ? "Enregistrer" : "Créer la réservation"}
              onPress={save}
              loading={saving}
              disabled={!valid}
            />
          )}
          {editing && (
            <PrimaryButton
              testID="delete-reservation"
              label="Supprimer"
              onPress={remove}
              variant="danger"
              style={{ marginTop: spacing.md, backgroundColor: colors.surfaceSecondary }}
            />
          )}
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

function FinanceCard({ detail, isPaid, onTogglePaid, onAddPayment, onDeletePayment, onSetCommission, onCheckout, paying, payMsg }: any) {
  const f = detail.finance || {};
  const cur = f.currency || "EUR";
  const { commissionRates } = usePreferences();
  const [acompte, setAcompte] = useState("");
  const [caution, setCaution] = useState(f.deposit_amount ? String(f.deposit_amount) : "");
  const money = (n: number) => `${(n || 0).toFixed(2)} ${cur === "EUR" ? "€" : cur}`;

  const rate = (commissionRates?.[detail.platform] ?? 0) / 100;
  const base = f.total || detail.total_price || f.stay || 0;
  const estimated = Math.round(base * rate * 100) / 100;
  const hasCommission = typeof f.commission === "number" && f.commission > 0;
  const commission = hasCommission ? f.commission : estimated;
  const net = Math.max(0, (f.total || detail.total_price || 0) - commission);
  const [comm, setComm] = useState(hasCommission ? String(f.commission) : (estimated ? String(estimated) : ""));

  const Line = ({ label, value, bold }: any) => (
    <View style={styles.qLine}>
      <Text style={[styles.qLabel, bold && styles.qBold]}>{label}</Text>
      <Text style={[styles.qValue, bold && styles.qBold]}>{value}</Text>
    </View>
  );
  return (
    <View style={styles.finWrap}>
      {/* Payé / Dû / Total */}
      <View style={styles.payRow}>
        <View style={styles.payCell}><Text style={styles.payLabel}>Payé</Text><Text style={styles.payVal}>{money(f.paid)}</Text></View>
        <View style={styles.payCell}><Text style={styles.payLabel}>Dû</Text><Text style={styles.payVal}>{money(f.due)}</Text></View>
        <View style={styles.payCell}><Text style={styles.payLabel}>Total</Text><Text style={[styles.payVal, styles.qBold]}>{money(f.total)}</Text></View>
      </View>

      {/* Encaissement manuel (Airbnb / paiement externe) */}
      <Pressable testID="toggle-paid" onPress={onTogglePaid} style={[styles.paidBtn, isPaid && styles.paidBtnOn]}>
        <Ionicons name={isPaid ? "checkmark-circle" : "cash-outline"} size={18} color={isPaid ? "#fff" : colors.onSurface} />
        <Text style={[styles.paidBtnText, isPaid && { color: "#fff" }]}>
          {isPaid ? "Encaissement validé — appuyez pour annuler" : "Marquer l'encaissement comme reçu"}
        </Text>
      </Pressable>

      {/* Paiement en ligne par carte (Stripe) */}
      {f.due > 0 && (
        <Pressable
          testID="stripe-pay"
          disabled={paying}
          onPress={() => onCheckout("payment", f.due)}
          style={[styles.stripeBtn, paying && { opacity: 0.6 }]}
        >
          {paying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="card" size={18} color="#fff" />
              <Text style={styles.stripeBtnText}>Payer {money(f.due)} par carte</Text>
            </>
          )}
        </Pressable>
      )}
      {!!payMsg && (
        <View style={styles.payMsg}>
          <Ionicons name="information-circle-outline" size={16} color={colors.onSurfaceSecondary} />
          <Text style={styles.payMsgText}>{payMsg}</Text>
        </View>
      )}

      {/* Caution par carte */}
      <View style={styles.finCard}>
        <View style={styles.finHead}>
          <Text style={styles.finTitle}>Caution</Text>
          {f.deposit_collected && (
            <View style={styles.quoteTag}><Text style={styles.quoteTagText}>Encaissée</Text></View>
          )}
        </View>
        <Text style={styles.commHint}>
          {f.deposit_collected
            ? `Caution de ${money(f.deposit_amount)} encaissée. Le remboursement se fait manuellement dans Stripe.`
            : "Encaissez une caution par carte. Elle sera remboursable manuellement depuis Stripe."}
        </Text>
        {!f.deposit_collected && (
          <View style={styles.acompteAdd}>
            <View style={styles.acompteInputWrap}>
              <TextInput
                testID="caution-input"
                value={caution}
                onChangeText={setCaution}
                placeholder="Montant de la caution"
                placeholderTextColor={colors.onSurfaceTertiary}
                keyboardType="decimal-pad"
                style={styles.acompteInput}
              />
            </View>
            <Pressable
              testID="stripe-deposit"
              disabled={paying}
              onPress={() => { const a = parseFloat((caution || "0").replace(",", ".")) || 0; if (a > 0) onCheckout("deposit", a); }}
              style={[styles.acompteBtn, { backgroundColor: "#635BFF" }]}
            >
              <Ionicons name="card" size={18} color="#fff" />
            </Pressable>
          </View>
        )}
      </View>

      {/* Acomptes / paiements partiels */}
      <View style={styles.finCard}>
        <Text style={styles.finTitle}>Acomptes</Text>
        {(detail.payments || []).length === 0 && <Text style={styles.hintSub}>Aucun acompte enregistré.</Text>}
        {(detail.payments || []).map((p: any) => (
          <View key={p.id} style={styles.acompteRow}>
            <Ionicons name="cash-outline" size={16} color={colors.success} />
            <Text style={styles.acompteVal}>{money(p.amount)}</Text>
            <Text style={styles.acompteDate}>{p.date}</Text>
            <Pressable testID={`del-payment-${p.id}`} onPress={() => onDeletePayment(p.id)} hitSlop={6}>
              <Ionicons name="close-circle" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          </View>
        ))}
        <View style={styles.acompteAdd}>
          <View style={styles.acompteInputWrap}>
            <TextInput
              testID="acompte-input"
              value={acompte}
              onChangeText={setAcompte}
              placeholder="Montant de l'acompte"
              placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="decimal-pad"
              style={styles.acompteInput}
            />
          </View>
          <Pressable
            testID="add-payment"
            onPress={() => { const a = parseFloat(acompte.replace(",", ".")); if (a > 0) { onAddPayment(a); setAcompte(""); } }}
            style={styles.acompteBtn}
          >
            <Ionicons name="add" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </View>

      {/* Devis */}
      <View style={styles.finCard}>
        <View style={styles.finHead}>
          <Text style={styles.finTitle}>Devis</Text>
          {!!f.quote_status && <View style={styles.quoteTag}><Text style={styles.quoteTagText}>{f.quote_status === "Agreed" ? "Accepté" : f.quote_status}</Text></View>}
        </View>
        {f.stay > 0 && <Line label="Hébergement" value={money(f.stay)} />}
        {f.fees > 0 && <Line label="Frais de ménage / services" value={money(f.fees)} />}
        {f.taxes > 0 && <Line label="Taxes de séjour" value={money(f.taxes)} />}
        {f.addons > 0 && <Line label="Extras" value={money(f.addons)} />}
        {f.promotions > 0 && <Line label="Promotions" value={`-${money(f.promotions)}`} />}
        <View style={styles.qSep} />
        <Line label="Total" value={money(f.total)} bold />
      </View>

      {/* Commission plateforme + revenu net */}
      <View style={styles.finCard}>
        <View style={styles.finHead}>
          <Text style={styles.finTitle}>Commission plateforme</Text>
          <View style={styles.commTag}>
            <PlatformLogo platform={detail.platform} size={16} />
            <Text style={styles.commTagText}>{detail.platform || "Direct"}</Text>
          </View>
        </View>
        {!hasCommission && rate > 0 && (
          <Text style={styles.commHint}>Estimation à {Math.round(rate * 100)}% — ajustez le montant réel ci-dessous.</Text>
        )}
        <View style={styles.acompteAdd}>
          <View style={styles.acompteInputWrap}>
            <TextInput
              testID="commission-input"
              value={comm}
              onChangeText={setComm}
              placeholder="Montant de la commission"
              placeholderTextColor={colors.onSurfaceTertiary}
              keyboardType="decimal-pad"
              style={styles.acompteInput}
            />
          </View>
          <Pressable
            testID="save-commission"
            onPress={() => { const a = parseFloat((comm || "0").replace(",", ".")) || 0; onSetCommission(a); }}
            style={styles.acompteBtn}
          >
            <Ionicons name="checkmark" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
        <View style={styles.qSep} />
        <Line label="Commission" value={`-${money(commission)}`} />
        <Line label="Revenu net" value={money(net)} bold />
      </View>

      {/* Politique + infos invité */}
      <View style={styles.finCard}>
        <Text style={styles.finTitle}>Invité</Text>
        {!!detail.guest_name && <InfoLine icon="person-outline" text={detail.guest_name} />}
        {!!detail.guest_phone && <InfoLine icon="call-outline" text={detail.guest_phone} />}
        {!!detail.guest_email && <InfoLine icon="mail-outline" text={detail.guest_email} />}
        {!!detail.language && <InfoLine icon="language-outline" text={detail.language.toUpperCase()} />}
        {!!detail.confirmation_code && <InfoLine icon="pricetag-outline" text={detail.confirmation_code} />}
        {!!f.policy_payments && <InfoLine icon="card-outline" text={`Paiement : ${f.policy_payments}`} />}
        {!!f.damage_deposit && <InfoLine icon="shield-outline" text={`Caution : ${f.damage_deposit}`} />}
      </View>
    </View>
  );
}

function InfoLine({ icon, text }: any) {
  return (
    <View style={styles.infoLine}>
      <Ionicons name={icon} size={16} color={colors.onSurfaceSecondary} />
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

function ChipRow({ items, value, onSelect, prefix }: any) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {items.map((it: any) => {
        const active = value === it.key;
        return (
          <Pressable
            key={it.key}
            testID={`${prefix}-${it.key}`}
            onPress={() => onSelect(it.key)}
            style={[
              styles.chip,
              active && { backgroundColor: it.color || colors.brandPrimary, borderColor: it.color || colors.brandPrimary },
            ]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{it.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cvCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  clCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  clHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  clTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  clCount: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary },
  clRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 10 },
  clBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  clBoxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  clLabel: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  clLabelOn: { color: colors.onSurface },
  cvHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  cvTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  cvSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 3, lineHeight: 17 },
  cvSwitch: { width: 52, height: 30, borderRadius: 15, backgroundColor: colors.surfaceSecondary, padding: 3, justifyContent: "center", alignItems: "flex-start" },
  cvSwitchOn: { backgroundColor: colors.brandPrimary, alignItems: "flex-end" },
  cvKnob: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 2, elevation: 2 },
  cvKnobOn: { backgroundColor: "#fff" },
  cvMsg: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.brandPrimary, marginTop: spacing.md },
  sendKeysBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12, marginTop: spacing.md },
  sendKeysText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
  depositBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary + "12", borderWidth: 1, borderColor: colors.brandPrimary + "33", borderRadius: radius.md, paddingVertical: 11, marginTop: spacing.md },
  depositText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.brandPrimary },
  cautionHist: { marginTop: spacing.sm, gap: 3 },
  cautionHistText: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },

  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerBanner: {
    backgroundColor: "#2A6F9E",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  headerTopRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  headerBadge: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: font.bold, fontSize: fontSize.xl, color: "#fff" },
  headerSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: "rgba(255,255,255,0.8)", marginTop: 1 },
  headerClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.md, marginTop: spacing.sm },
  priceHint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: -4, marginBottom: spacing.sm, lineHeight: 17 },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, marginTop: spacing.xs },
  totalLabel: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  totalValue: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.brandPrimary },
  chipRow: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    flexShrink: 0,
    height: 38,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.onBrandPrimary },
  row: { flexDirection: "row", gap: spacing.md },
  hintSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  finWrap: { marginBottom: spacing.lg },
  payRow: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  payCell: { flex: 1, alignItems: "center" },
  payLabel: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  payVal: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, marginTop: 3 },
  paidBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: 12, marginBottom: spacing.md },
  paidBtnOn: { backgroundColor: "#30D158" },
  paidBtnText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  stripeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: "#635BFF", borderRadius: radius.md, paddingVertical: 13, marginBottom: spacing.md },
  stripeBtnText: { fontFamily: font.semibold, fontSize: fontSize.base, color: "#fff" },
  payMsg: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  payMsgText: { flex: 1, fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  acompteRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  acompteVal: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  acompteDate: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, flex: 1 },
  acompteAdd: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  acompteInputWrap: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md },
  acompteInput: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, paddingVertical: 11 },
  acompteBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  finCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  finHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  finTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.sm },
  quoteTag: { backgroundColor: "#34C75920", paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  quoteTagText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: "#248A3D" },
  commTag: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  commTagText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurface },
  commHint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginBottom: spacing.sm },
  qLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  qLabel: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, flex: 1 },
  qValue: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
  qBold: { fontFamily: font.bold, color: colors.onSurface },
  qSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  infoLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 5 },
  infoText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface, flex: 1 },
});
