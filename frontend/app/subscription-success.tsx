import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter, useLocalSearchParams } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function SubscriptionSuccessScreen() {
  const router = useRouter();
  const { session_id } = useLocalSearchParams<{ session_id?: string }>();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [plan, setPlan] = useState<string>("");

  useEffect(() => {
    let tries = 0;
    async function confirm() {
      if (!session_id) { setState("error"); return; }
      try {
        const r = await api.post("/billing/confirm", { session_id });
        setPlan(r.plan_label || "");
        setState("ok");
      } catch {
        tries += 1;
        if (tries < 5) setTimeout(confirm, 2000);
        else setState("error");
      }
    }
    confirm();
  }, [session_id]);

  return (
    <View style={styles.container}>
      {state === "loading" && (<>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
        <Text style={styles.sub}>Confirmation de votre abonnement…</Text>
      </>)}
      {state === "ok" && (<>
        <Ionicons name="checkmark-circle" size={72} color={colors.success} />
        <Text style={styles.title}>Abonnement activé !</Text>
        <Text style={styles.sub}>Bienvenue dans la formule {plan || "choisie"}. Bonne gestion 🎉</Text>
      </>)}
      {state === "error" && (<>
        <Ionicons name="alert-circle" size={72} color={colors.warning} />
        <Text style={styles.title}>Confirmation en attente</Text>
        <Text style={styles.sub}>Si vous avez bien payé, votre abonnement sera actif d’ici quelques minutes.</Text>
      </>)}
      <Pressable testID="sub-success-home" onPress={() => router.replace("/")} style={styles.cta}>
        <Text style={styles.ctaText}>Aller au tableau de bord</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  title: { fontFamily: font.bold, fontSize: 24, color: colors.onSurface, marginTop: spacing.md, textAlign: "center" },
  sub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginTop: spacing.sm, textAlign: "center", lineHeight: 20 },
  cta: { backgroundColor: colors.brandPrimary, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: spacing.xl, marginTop: spacing.xl },
  ctaText: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onBrandPrimary },
});
