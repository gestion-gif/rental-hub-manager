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
import { Field, PrimaryButton } from "@/src/components/ui";
import {
  colors,
  font,
  fontSize,
  radius,
  spacing,
  STATUS_ORDER,
  STATUS,
} from "@/src/theme";

const PLATFORMS = ["Direct", "Airbnb", "Booking.com", "Vrbo"];

export default function ReservationForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;

  const [props, setProps] = useState<any[]>([]);
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
          <Text style={styles.label}>Logement</Text>
          <ChipRow
            items={props.map((p) => ({ key: p.id, label: p.name }))}
            value={form.property_id}
            onSelect={(v) => set("property_id", v)}
            prefix="res-prop"
          />

          <View style={{ height: spacing.lg }} />
          <Text style={styles.label}>Statut</Text>
          <ChipRow
            items={STATUS_ORDER.map((s) => ({ key: s, label: STATUS[s].label, color: STATUS[s].color }))}
            value={form.status}
            onSelect={(v) => set("status", v)}
            prefix="res-status"
          />

          <View style={{ height: spacing.lg }} />
          <Field label="Nom du voyageur" testID="guest-name" value={form.guest_name} onChangeText={(v) => set("guest_name", v)} placeholder="Jean Dupont" />
          <Field label="Email (optionnel)" testID="guest-email" value={form.guest_email} onChangeText={(v) => set("guest_email", v)} placeholder="jean@email.com" keyboardType="email-address" autoCapitalize="none" />

          <Text style={styles.label}>Plateforme</Text>
          <ChipRow
            items={PLATFORMS.map((p) => ({ key: p, label: p }))}
            value={form.platform}
            onSelect={(v) => set("platform", v)}
            prefix="res-platform"
          />
          <View style={{ height: spacing.lg }} />

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Field label="Arrivée" testID="check-in" value={form.check_in} onChangeText={(v) => set("check_in", v)} placeholder="AAAA-MM-JJ" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Départ" testID="check-out" value={form.check_out} onChangeText={(v) => set("check_out", v)} placeholder="AAAA-MM-JJ" />
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
});
