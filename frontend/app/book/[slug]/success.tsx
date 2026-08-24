import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function BookingSuccess() {
  const router = useRouter();
  const { slug, session_id } = useLocalSearchParams<{ slug: string; session_id: string }>();
  const [status, setStatus] = useState<"loading" | "paid" | "pending" | "error">("loading");
  const [amount, setAmount] = useState<number>(0);

  useEffect(() => {
    let tries = 0;
    let active = true;
    async function poll() {
      if (!session_id) { setStatus("error"); return; }
      try {
        const r = await api.get(`/public/booking/status/${session_id}`);
        if (!active) return;
        setAmount(r.amount || 0);
        if (r.payment_status === "paid" || r.reservation_status === "confirmee") { setStatus("paid"); return; }
        if (r.status === "expired") { setStatus("error"); return; }
      } catch { if (!active) return; }
      tries += 1;
      if (tries < 8) setTimeout(poll, 1500);
      else if (active) setStatus("pending");
    }
    poll();
    return () => { active = false; };
  }, [session_id]);

  return (
    <View style={styles.center}>
      {status === "loading" && (
        <>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
          <Text style={styles.title}>Confirmation du paiement…</Text>
          <Text style={styles.sub}>Merci de patienter quelques secondes.</Text>
        </>
      )}
      {status === "paid" && (
        <>
          <View style={[styles.icon, { backgroundColor: "#E7F8EC" }]}><Ionicons name="checkmark-circle" size={54} color="#2FB350" /></View>
          <Text style={styles.title}>Réservation confirmée !</Text>
          <Text style={styles.sub}>Votre paiement de {amount}€ a bien été reçu. Un email de confirmation vous sera envoyé.</Text>
        </>
      )}
      {status === "pending" && (
        <>
          <View style={[styles.icon, { backgroundColor: "#FFF4E5" }]}><Ionicons name="time-outline" size={54} color="#E5844B" /></View>
          <Text style={styles.title}>Paiement en cours de traitement</Text>
          <Text style={styles.sub}>Nous confirmons votre réservation. Vous recevrez un email dès validation.</Text>
        </>
      )}
      {status === "error" && (
        <>
          <View style={[styles.icon, { backgroundColor: "#FDECEC" }]}><Ionicons name="alert-circle" size={54} color="#E5484D" /></View>
          <Text style={styles.title}>Un problème est survenu</Text>
          <Text style={styles.sub}>Le paiement n'a pas pu être confirmé. Réessayez ou contactez-nous.</Text>
        </>
      )}
      <Pressable testID="success-home" onPress={() => router.replace(`/book/${slug}`)} style={styles.btn}>
        <Text style={styles.btnText}>Retour aux hébergements</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, padding: spacing.xl, gap: spacing.md },
  icon: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface, textAlign: "center" },
  sub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", lineHeight: 22, maxWidth: 360 },
  btn: { backgroundColor: colors.brandPrimary, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: spacing.xl, marginTop: spacing.md },
  btnText: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onBrandPrimary },
});
