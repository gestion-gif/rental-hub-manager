import React from "react";
import { Pressable, Text, StyleSheet, Platform } from "react-native";

import { getLang, setLangPref } from "@/src/i18n";

/** Bascule FR/EN pour les visiteurs du site public de réservation. */
export default function LangToggle({ top = 12 }: { top?: number }) {
  const other = getLang() === "en" ? "fr" : "en";
  return (
    <Pressable
      testID="lang-toggle"
      onPress={async () => {
        await setLangPref(other);
        if (Platform.OS === "web" && typeof window !== "undefined") window.location.reload();
      }}
      style={[styles.pill, { top }]}
    >
      <Text style={styles.txt}>{other === "en" ? "English" : "Français"}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Pastille sur photo/entête : couleurs fixes, identiques dans les deux thèmes
  pill: { position: "absolute", right: 14, zIndex: 50, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  txt: { color: "#fff", fontSize: 13, fontWeight: "600" },
});
