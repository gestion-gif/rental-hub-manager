import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { font, radius, spacing } from "@/src/theme";
import { usePreferences } from "@/src/context/PreferencesContext";

export function tint(hex: string, alpha = "22") {
  if (hex && hex.length === 7) return hex + alpha;
  return hex;
}

export default function StatusBadge({
  status,
  testID,
}: {
  status: string;
  testID?: string;
}) {
  const { getStatus } = usePreferences();
  const s = getStatus(status);
  return (
    <View
      testID={testID || `status-badge-${status}`}
      style={[styles.badge, { backgroundColor: tint(s.color) }]}
    >
      <View style={[styles.dot, { backgroundColor: s.color }]} />
      <Text style={[styles.text, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
    gap: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 999 },
  text: { fontFamily: font.semibold, fontSize: 12 },
});
