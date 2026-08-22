import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Item = { id: string; name: string };

export function Picker({
  label,
  value,
  items,
  onSelect,
  title = "Choisir",
  icon = "chevron-down",
  testID = "picker",
}: {
  label?: string;
  value: string;
  items: Item[];
  onSelect: (id: string) => void;
  title?: string;
  icon?: any;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const current = items.find((o) => o.id === value);

  return (
    <View style={{ marginBottom: spacing.lg }}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <Pressable testID={testID} onPress={() => setOpen(true)} style={styles.trigger}>
        <Text style={[styles.triggerText, !current && styles.placeholder]} numberOfLines={1}>
          {current?.name || "Sélectionner…"}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.onSurfaceSecondary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{title}</Text>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {items.map((o) => {
                const active = o.id === value;
                return (
                  <Pressable
                    key={o.id}
                    testID={`${testID}-opt-${o.id}`}
                    onPress={() => { onSelect(o.id); setOpen(false); }}
                    style={[styles.opt, active && styles.optActive]}
                  >
                    <Text style={[styles.optText, active && styles.optTextActive]} numberOfLines={1}>{o.name}</Text>
                    {active && <Ionicons name="checkmark" size={18} color={colors.brandPrimary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  trigger: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: 14,
  },
  triggerText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.lg, color: colors.onSurface },
  placeholder: { color: colors.onSurfaceTertiary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  sheetTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.sm },
  opt: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  optActive: { backgroundColor: colors.surfaceSecondary },
  optText: { flex: 1, fontFamily: font.medium, fontSize: fontSize.lg, color: colors.onSurface },
  optTextActive: { fontFamily: font.semibold, color: colors.brandPrimary },
});
