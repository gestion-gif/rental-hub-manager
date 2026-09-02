import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { ensurePhotoAccess } from "@/src/utils/photoAccess";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api, uploadFile, fileUrl, getToken } from "@/src/api";
import { Field, PrimaryButton } from "@/src/components/ui";
import { Picker } from "@/src/components/Picker";
import DateField from "@/src/components/DateField";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

async function scanReceipt(uri: string, name: string, type: string) {
  const token = await getToken();
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, name);
  } else {
    form.append("file", { uri, name, type } as any);
  }
  const res = await fetch(`${BASE}/accounting/scan-receipt`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.detail || "scan échoué");
  return data;
}

export default function AccountingForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, month, type: typeParam } = useLocalSearchParams<{ id?: string; month?: string; type?: string }>();
  const editing = !!id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [meta, setMeta] = useState<any>({ categories: { recette: [], depense: [] }, vat_rates: [0, 5.5, 10, 20] });
  const [properties, setProperties] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);

  const defaultDate = month ? `${month}-${String(new Date().getDate()).padStart(2, "0")}` : new Date().toISOString().slice(0, 10);
  const [type, setType] = useState<"recette" | "depense">((typeParam as any) || "depense");
  const [date, setDate] = useState(defaultDate);
  const [amount, setAmount] = useState("");
  const [vatRate, setVatRate] = useState("0");
  const [category, setCategory] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [channel, setChannel] = useState("");
  const [supplier, setSupplier] = useState("");
  const [description, setDescription] = useState("");
  const [receiptPath, setReceiptPath] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [m, p, o] = await Promise.all([
          api.get("/accounting/meta"),
          api.get("/properties"),
          api.get("/owners").catch(() => []),
        ]);
        setMeta(m);
        setProperties((p || []).map((x: any) => ({ id: x.id, name: x.name })));
        setOwners((o || []).map((x: any) => ({ id: x.id, name: x.name })));
        if (editing) {
          const all = await api.get("/accounting/transactions");
          const tx = (all || []).find((x: any) => x.id === id);
          if (tx) {
            setType(tx.type);
            setDate(tx.date);
            setAmount(String(tx.amount_ttc));
            setVatRate(String(tx.vat_rate));
            setCategory(tx.category || "");
            setPropertyId(tx.property_id || "");
            setOwnerId(tx.owner_id || "");
            setChannel(tx.channel || "");
            setSupplier(tx.supplier || "");
            setDescription(tx.description || "");
            setReceiptPath(tx.receipt_path || "");
          }
        }
      } catch {}
      setLoading(false);
    })();
  }, [id]);

  async function pickReceipt() {
    if (!(await ensurePhotoAccess("Autorisez l'accès aux photos pour ajouter un justificatif."))) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6 });
    if (result.canceled) return;
    const asset = result.assets[0];
    const name = asset.fileName || `justif_${Date.now()}.jpg`;
    const mime = asset.mimeType || "image/jpeg";
    // Upload + scan en parallèle
    setUploading(true);
    setScanning(true);
    try {
      const [path, scan] = await Promise.all([
        uploadFile(asset.uri, name, mime),
        scanReceipt(asset.uri, name, mime).catch(() => null),
      ]);
      setReceiptPath(path);
      if (scan) applyScan(scan);
    } catch {
      Alert.alert("Erreur", "Ajout du justificatif impossible.");
    }
    setUploading(false);
    setScanning(false);
  }

  function applyScan(scan: any) {
    if (scan.amount_ttc) setAmount(String(scan.amount_ttc));
    if (scan.date && /^\d{4}-\d{2}-\d{2}$/.test(scan.date)) setDate(scan.date);
    if (scan.supplier) setSupplier(scan.supplier);
    if (scan.vat_rate != null) setVatRate(String(scan.vat_rate));
    if (scan.category_guess && !category) setCategory(scan.category_guess);
    setType("depense");
  }

  async function save() {
    const amt = parseFloat(amount.replace(",", "."));
    if (!date || !amt || amt <= 0) {
      Alert.alert("Champs requis", "Renseignez au moins une date et un montant.");
      return;
    }
    setSaving(true);
    const payload = {
      type, date, amount_ttc: amt, vat_rate: parseFloat(vatRate) || 0,
      category, property_id: propertyId || null, owner_id: ownerId || null,
      channel: type === "recette" ? channel : null,
      supplier: type === "depense" ? supplier : null,
      description, receipt_path: receiptPath || null,
    };
    try {
      if (editing) await api.put(`/accounting/transactions/${id}`, payload);
      else await api.post("/accounting/transactions", payload);
      router.back();
    } catch {
      Alert.alert("Erreur", "Enregistrement impossible.");
      setSaving(false);
    }
  }

  async function remove() {
    Alert.alert("Supprimer", "Supprimer cette écriture ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => {
        try { await api.del(`/accounting/transactions/${id}`); router.back(); } catch { Alert.alert("Erreur", "Suppression impossible."); }
      } },
    ]);
  }

  const catItems = (meta.categories[type] || []).map((c: string) => ({ id: c, name: c }));
  const vatItems = (meta.vat_rates || []).map((r: number) => ({ id: String(r), name: `${r} %` }));
  const propItems = [{ id: "", name: "— Aucun —" }, ...properties];
  const ownerItems = [{ id: "", name: "— Aucun —" }, ...owners];

  if (loading) {
    return <View style={styles.container}><ActivityIndicator style={{ marginTop: 80 }} color={colors.brandPrimary} /></View>;
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="close-form" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{editing ? "Modifier l'écriture" : "Nouvelle écriture"}</Text>
        {editing ? (
          <Pressable testID="delete-tx" onPress={remove} style={styles.iconBtn}>
            <Ionicons name="trash-outline" size={20} color={colors.error} />
          </Pressable>
        ) : <View style={styles.iconBtn} />}
      </View>

      <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {/* Type */}
        <View style={styles.typeToggle}>
          {(["depense", "recette"] as const).map((k) => (
            <Pressable key={k} testID={`type-${k}`} onPress={() => setType(k)} style={[styles.typeBtn, type === k && (k === "recette" ? styles.typeRecette : styles.typeDepense)]}>
              <Ionicons name={k === "recette" ? "arrow-down" : "arrow-up"} size={16} color={type === k ? "#fff" : colors.onSurfaceSecondary} />
              <Text style={[styles.typeText, type === k && { color: "#fff" }]}>{k === "recette" ? "Recette" : "Dépense"}</Text>
            </Pressable>
          ))}
        </View>

        {/* Justificatif (dépense) */}
        {type === "depense" && (
          <View style={styles.receiptWrap}>
            {receiptPath ? (
              <View style={styles.receiptShown}>
                <Image source={{ uri: fileUrl(receiptPath) }} style={styles.receiptImg} contentFit="cover" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.receiptOk}>Justificatif ajouté</Text>
                  {scanning && <Text style={styles.receiptScan}>Analyse IA en cours…</Text>}
                </View>
                <Pressable testID="remove-receipt" onPress={() => setReceiptPath("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={22} color={colors.onSurfaceTertiary} />
                </Pressable>
              </View>
            ) : (
              <Pressable testID="add-receipt" onPress={pickReceipt} disabled={uploading} style={styles.receiptBtn}>
                {uploading ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Ionicons name="scan-outline" size={20} color={colors.brandPrimary} />}
                <View>
                  <Text style={styles.receiptBtnText}>Scanner un justificatif</Text>
                  <Text style={styles.receiptBtnSub}>L'IA remplit montant, date, TVA…</Text>
                </View>
              </Pressable>
            )}
          </View>
        )}

        <DateField label="Date" value={date} onChange={setDate} testID="tx-date" />
        <Field label="Montant TTC (€)" testID="tx-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
        <Picker label="TVA" value={vatRate} items={vatItems} onSelect={setVatRate} title="Taux de TVA" testID="tx-vat" />
        <Picker label="Catégorie" value={category} items={catItems} onSelect={setCategory} title="Catégorie" testID="tx-category" />
        <Picker label="Logement (optionnel)" value={propertyId} items={propItems} onSelect={setPropertyId} title="Logement" testID="tx-property" />
        <Picker label="Propriétaire (optionnel)" value={ownerId} items={ownerItems} onSelect={setOwnerId} title="Propriétaire" testID="tx-owner" />

        {type === "recette" ? (
          <Field label="Canal (optionnel)" testID="tx-channel" value={channel} onChangeText={setChannel} placeholder="Airbnb, Booking, Direct…" />
        ) : (
          <Field label="Fournisseur (optionnel)" testID="tx-supplier" value={supplier} onChangeText={setSupplier} placeholder="Nom du fournisseur" />
        )}
        <Field label="Description (optionnel)" testID="tx-description" value={description} onChangeText={setDescription} placeholder="Note" />

        <PrimaryButton testID="save-tx" label={editing ? "Enregistrer" : "Ajouter"} onPress={save} loading={saving} style={{ marginTop: spacing.md }} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  typeToggle: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  typeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  typeRecette: { backgroundColor: colors.success },
  typeDepense: { backgroundColor: colors.error },
  typeText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  receiptWrap: { marginBottom: spacing.lg },
  receiptBtn: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.brandPrimary + "12", borderWidth: 1, borderColor: colors.brandPrimary + "40", borderStyle: "dashed", borderRadius: radius.md, padding: spacing.lg },
  receiptBtnText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.brandPrimary },
  receiptBtnSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 1 },
  receiptShown: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md },
  receiptImg: { width: 46, height: 46, borderRadius: radius.sm },
  receiptOk: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  receiptScan: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.brandPrimary, marginTop: 1 },
});
