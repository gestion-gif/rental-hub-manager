import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { usePreferences } from "@/src/context/PreferencesContext";
import { Field, PrimaryButton } from "@/src/components/ui";
import DateField from "@/src/components/DateField";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const PLATFORMS = ["Direct", "Airbnb", "Booking.com", "Vrbo"];

export default function ReservationForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;
  const { statuses } = usePreferences();

  const [props, setProps] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    property_id: "",
    guest_name: "",
    guest_email: "",
    platform: "Direct",
    check_in: "",
    check_out: "",
    guests: "2",
    total_price: "",
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
            setForm({
              property_id: r.property_id,
              guest_name: r.guest_name,
              guest_email: r.guest_email || "",
              platform: r.platform || "Direct",
              check_in: r.check_in,
              check_out: r.check_out,
              guests: String(r.guests),
              total_price: String(r.total_price),
              status: r.status,
              notes: r.notes || "",
            });
          }
        } else if (pr.length) {
          setForm((f) => ({ ...f, property_id: pr[0].id }));
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const valid =
    form.property_id && form.guest_name.trim() && form.check_in && form.check_out;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    const payload = {
      ...form,
      guests: parseInt(form.guests) || 1,
      total_price: parseFloat(form.total_price) || 0,
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>{editing ? "Modifier" : "Nouvelle réservation"}</Text>
        <Pressable testID="close-form" onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
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
          {detail?.finance && <FinanceCard detail={detail} />}
          <Text style={styles.label}>Logement</Text>
          <ChipRow
            items={props.map((p) => ({ key: p.id, label: p.name }))}
            value={form.property_id}
            onSelect={(v: string) => set("property_id", v)}
            prefix="res-prop"
          />

          <View style={{ height: spacing.lg }} />
          <Text style={styles.label}>Statut</Text>
          <ChipRow
            items={statuses.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
            value={form.status}
            onSelect={(v: string) => set("status", v)}
            prefix="res-status"
          />

          <View style={{ height: spacing.lg }} />
          <Field label="Nom du voyageur" testID="guest-name" value={form.guest_name} onChangeText={(v) => set("guest_name", v)} placeholder="Jean Dupont" />
          <Field label="Email (optionnel)" testID="guest-email" value={form.guest_email} onChangeText={(v) => set("guest_email", v)} placeholder="jean@email.com" keyboardType="email-address" autoCapitalize="none" />

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
              <DateField label="Arrivée" testID="check-in" value={form.check_in} onChange={(v) => set("check_in", v)} />
            </View>
            <View style={{ flex: 1 }}>
              <DateField label="Départ" testID="check-out" value={form.check_out} onChange={(v) => set("check_out", v)} minDate={form.check_in || undefined} />
            </View>
          </View>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field label="Voyageurs" testID="guests" value={form.guests} onChangeText={(v) => set("guests", v)} keyboardType="number-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Prix total (€)" testID="total-price" value={form.total_price} onChangeText={(v) => set("total_price", v)} keyboardType="decimal-pad" placeholder="0" />
            </View>
          </View>
          <Field label="Notes" testID="notes" value={form.notes} onChangeText={(v) => set("notes", v)} placeholder="Informations complémentaires" multiline />

          <PrimaryButton
            testID="save-reservation"
            label={editing ? "Enregistrer" : "Créer la réservation"}
            onPress={save}
            loading={saving}
            disabled={!valid}
          />
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

function FinanceCard({ detail }: any) {
  const f = detail.finance || {};
  const cur = f.currency || "EUR";
  const money = (n: number) => `${(n || 0).toFixed(2)} ${cur === "EUR" ? "€" : cur}`;
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
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  finCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  finHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  finTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.sm },
  quoteTag: { backgroundColor: "#34C75920", paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  quoteTagText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: "#248A3D" },
  qLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  qLabel: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, flex: 1 },
  qValue: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
  qBold: { fontFamily: font.bold, color: colors.onSurface },
  qSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  infoLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 5 },
  infoText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface, flex: 1 },
});
