import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Switch,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { Field, PrimaryButton } from "@/src/components/ui";
import { Picker } from "@/src/components/Picker";
import DateField from "@/src/components/DateField";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const FREQ = [
  { id: "monthly", name: "Mensuel" },
  { id: "quarterly", name: "Trimestriel" },
  { id: "yearly", name: "Annuel" },
];

export default function RecurringForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState<any>({ categories: { depense: [] }, vat_rates: [0, 5.5, 10, 20] });
  const [properties, setProperties] = useState<any[]>([]);

  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [vatRate, setVatRate] = useState("0");
  const [category, setCategory] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [active, setActive] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [m, p] = await Promise.all([api.get("/accounting/meta"), api.get("/properties")]);
        setMeta(m);
        setProperties((p || []).map((x: any) => ({ id: x.id, name: x.name })));
        if (editing) {
          const all = await api.get("/accounting/recurring");
          const r = (all || []).find((x: any) => x.id === id);
          if (r) {
            setLabel(r.label || "");
            setAmount(String(r.amount_ttc));
            setVatRate(String(r.vat_rate));
            setCategory(r.category || "");
            setPropertyId(r.property_id || "");
            setSupplier(r.supplier || "");
            setFrequency(r.frequency || "monthly");
            setDayOfMonth(String(r.day_of_month || 1));
            setStartDate(r.start_date || startDate);
            setEndDate(r.end_date || "");
            setActive(r.active !== false);
          }
        }
      } catch {}
      setLoading(false);
    })();
  }, [id]);

  async function save() {
    const amt = parseFloat(amount.replace(",", "."));
    if (!label.trim() || !amt || amt <= 0 || !startDate) {
      Alert.alert("Champs requis", "Renseignez un libellé, un montant et une date de début.");
      return;
    }
    setSaving(true);
    const payload = {
      label: label.trim(), category, amount_ttc: amt, vat_rate: parseFloat(vatRate) || 0,
      property_id: propertyId || null, supplier: supplier || null,
      frequency, day_of_month: parseInt(dayOfMonth) || 1,
      start_date: startDate, end_date: endDate || null, active,
    };
    try {
      if (editing) await api.put(`/accounting/recurring/${id}`, payload);
      else await api.post("/accounting/recurring", payload);
      router.back();
    } catch {
      Alert.alert("Erreur", "Enregistrement impossible.");
      setSaving(false);
    }
  }

  async function remove() {
    Alert.alert("Supprimer", "Supprimer cette récurrence ? (les dépenses déjà générées sont conservées)", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => {
        try { await api.del(`/accounting/recurring/${id}`); router.back(); } catch { Alert.alert("Erreur", "Suppression impossible."); }
      } },
    ]);
  }

  const catItems = (meta.categories.depense || []).map((c: string) => ({ id: c, name: c }));
  const vatItems = (meta.vat_rates || []).map((r: number) => ({ id: String(r), name: `${r} %` }));
  const propItems = [{ id: "", name: "— Aucun —" }, ...properties];

  if (loading) {
    return <View style={styles.container}><ActivityIndicator style={{ marginTop: 80 }} color={colors.brandPrimary} /></View>;
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="close-recurring" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{editing ? "Modifier la récurrence" : "Dépense récurrente"}</Text>
        {editing ? (
          <Pressable testID="delete-recurring" onPress={remove} style={styles.iconBtn}>
            <Ionicons name="trash-outline" size={20} color={colors.error} />
          </Pressable>
        ) : <View style={styles.iconBtn} />}
      </View>

      <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <Field label="Libellé" testID="rec-label" value={label} onChangeText={setLabel} placeholder="Ex. Assurance PNO, Abonnement…" />
        <Field label="Montant TTC (€)" testID="rec-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
        <Picker label="TVA" value={vatRate} items={vatItems} onSelect={setVatRate} title="Taux de TVA" testID="rec-vat" />
        <Picker label="Catégorie" value={category} items={catItems} onSelect={setCategory} title="Catégorie" testID="rec-category" />
        <Picker label="Fréquence" value={frequency} items={FREQ} onSelect={setFrequency} title="Fréquence" testID="rec-frequency" />
        <Field label="Jour du mois (1-28)" testID="rec-day" value={dayOfMonth} onChangeText={setDayOfMonth} keyboardType="number-pad" placeholder="1" />
        <DateField label="Date de début" value={startDate} onChange={setStartDate} testID="rec-start" />
        <DateField label="Date de fin (optionnel)" value={endDate} onChange={setEndDate} testID="rec-end" />
        <Picker label="Logement (optionnel)" value={propertyId} items={propItems} onSelect={setPropertyId} title="Logement" testID="rec-property" />
        <Field label="Fournisseur (optionnel)" testID="rec-supplier" value={supplier} onChangeText={setSupplier} placeholder="Nom du fournisseur" />

        <View style={styles.activeRow}>
          <Text style={styles.activeLabel}>Active</Text>
          <Switch value={active} onValueChange={setActive} testID="rec-active" trackColor={{ true: colors.brandPrimary }} />
        </View>

        <PrimaryButton testID="save-recurring" label={editing ? "Enregistrer" : "Ajouter"} onPress={save} loading={saving} style={{ marginTop: spacing.md }} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  activeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm, marginBottom: spacing.md },
  activeLabel: { fontFamily: font.medium, fontSize: fontSize.lg, color: colors.onSurface },
});
