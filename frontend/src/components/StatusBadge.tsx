import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { STATUS, StatusKey, font, radius, spacing } from "@/src/theme";
import { usePreferences } from "@/src/context/PreferencesContext";

export function tint(hex: string, alpha = "22") {
  // hex like #RRGGBB -> #RRGGBBAA (light tinted background)
  if (hex && hex.length === 7) return hex + alpha;
  return hex;
}

export default function StatusBadge({
  status,
  testID,
}: {
  status: StatusKey;
  testID?: string;
}) {
  const { statusColors } = usePreferences();
  const color = statusColors[status] || STATUS[status].color;
  const label = STATUS[status].label;
  return (
    <View
      testID={testID || `status-badge-${status}`}
      style={[styles.badge, { backgroundColor: tint(color) }]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]}>{label}</Text>
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
