import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";

import { api } from "@/src/api";
import { colors, font, fontSize, spacing } from "@/src/theme";

// Landing pour un domaine dédié (ex. mhpimmo.fr/book) → redirige vers le site actif.
export default function BookLanding() {
  const router = useRouter();
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get("/public/default-site");
        if (r.slug) router.replace(`/book/${r.slug}`);
        else setError(true);
      } catch { setError(true); }
    })();
  }, []);

  return (
    <View style={styles.center}>
      {error ? (
        <>
          <Ionicons name="globe-outline" size={40} color={colors.onSurfaceTertiary} />
          <Text style={styles.text}>Aucun site de réservation actif.</Text>
        </>
      ) : (
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, gap: spacing.sm },
  text: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
});
