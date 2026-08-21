import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { STATUS, StatusKey, font, radius, spacing } from "@/src/theme";

export default function StatusBadge({
  status,
  testID,
}: {
  status: StatusKey;
  testID?: string;
}) {
  const s = STATUS[status] || STATUS.demande;
  return (
    <View
      testID={testID || `status-badge-${status}`}
      style={[styles.badge, { backgroundColor: s.bg }]}
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
