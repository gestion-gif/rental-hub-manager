import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Linking, Alert } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function PayBalance() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { slug, rid } = useLocalSearchParams<{ slug: string; rid: string }>();
  const [r, setR] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try { setR(await api.get(`/public/site/${slug}/reservation/${rid}`)); } catch {}
    setLoading(false);
  }, [slug, rid]);
  useEffect(() => { load(); }, [load]);

  async function payBalance() {
    setPaying(true);
    const origin = Platform.OS === "web" ? window.location.origin : "";
    try {
      const res = await api.post(`/public/site/${slug}/balance-checkout/${rid}`, { origin_url: origin });
      if (res.url) {
        if (Platform.OS === "web") window.location.assign(res.url);
        else await Linking.openURL(res.url);
      }
    } catch (e: any) { Alert.alert("Erreur", e?.detail || "Paiement indisponible."); }
    setPaying(false);
  }

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={colors.brandPrimary} /></View>;
  if (!r) return <View style={styles.center}><Text style={styles.err}>Réservation introuvable.</Text></View>;

  const due = r.due || 0;

  return (
    <View style={[styles.center, { paddingTop: insets.top }]}>
      <View style={styles.card}>
        <Text style={styles.title}>Solde de votre séjour</Text>
        <Text style={styles.prop}>{r.property_name}</Text>
        <Text style={styles.dates}>{r.check_in} → {r.check_out}</Text>
        <View style={styles.rows}>
          <Row label="Total séjour" value={`${r.total}€`} />
          <Row label="Déjà payé" value={`${r.paid}€`} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Reste à payer</Text>
            <Text style={styles.totalValue}>{due}€</Text>
          </View>
        </View>
        {due > 0 ? (
          <Pressable testID="pay-balance" onPress={payBalance} disabled={paying} style={[styles.btn, paying && { opacity: 0.6 }]}>
            {paying ? <ActivityIndicator color="#fff" /> : <><Ionicons name="card-outline" size={18} color="#fff" /><Text style={styles.btnText}>Payer le solde {due}€</Text></>}
          </Pressable>
        ) : (
          <View style={styles.paidBox}><Ionicons name="checkmark-circle" size={20} color="#2FB350" /><Text style={styles.paidText}>Séjour intégralement réglé. Merci !</Text></View>
        )}
        <Text style={styles.secure}><Ionicons name="lock-closed" size={11} color={colors.onSurfaceTertiary} /> Paiement sécurisé par Stripe</Text>
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.rLabel}>{label}</Text><Text style={styles.rValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, padding: spacing.lg },
  err: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  card: { width: "100%", maxWidth: 440, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.xl },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface, textAlign: "center" },
  prop: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, textAlign: "center", marginTop: spacing.sm },
  dates: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: 2 },
  rows: { marginTop: spacing.lg },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  rLabel: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  rValue: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  totalLabel: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  totalValue: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.brandPrimary },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#17B0A6", borderRadius: radius.lg, paddingVertical: 15, marginTop: spacing.lg },
  btnText: { fontFamily: font.bold, fontSize: fontSize.lg, color: "#fff" },
  paidBox: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.lg },
  paidText: { fontFamily: font.semibold, fontSize: fontSize.base, color: "#2FB350" },
  secure: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: spacing.md },
});
