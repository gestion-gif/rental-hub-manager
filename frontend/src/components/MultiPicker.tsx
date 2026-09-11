import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal, ScrollView } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Item = { id: string; name: string };

export function MultiPicker({
  label,
  values,
  items,
  onChange,
  title = "Sélectionner",
  emptyLabel = "Aucun sélectionné",
  testID = "multi-picker",
}: {
  label?: string;
  values: string[];
  items: Item[];
  onChange: (ids: string[]) => void;
  title?: string;
  emptyLabel?: string;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const selected = items.filter((i) => values.includes(i.id));
  const summary =
    selected.length === 0
      ? emptyLabel
      : selected.length === items.length
        ? "Tous les logements"
        : selected.map((s) => s.name).join(", ");

  function toggle(id: string) {
    onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
  }
  const allOn = items.length > 0 && values.length === items.length;

  return (
    <View style={{ marginBottom: spacing.lg }}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <Pressable testID={testID} onPress={() => setOpen(true)} style={styles.trigger}>
        <Ionicons name="business-outline" size={16} color={colors.onSurfaceSecondary} />
        <Text style={[styles.triggerText, selected.length === 0 && styles.placeholder]} numberOfLines={1}>
          {summary}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.onSurfaceSecondary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={() => {}}>
            <View style={styles.handle} />
            <View style={styles.headRow}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <Pressable testID={`${testID}-all`} onPress={() => onChange(allOn ? [] : items.map((i) => i.id))}>
                <Text style={styles.allBtn}>{allOn ? "Tout désélectionner" : "Tout sélectionner"}</Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {items.length === 0 && <Text style={styles.empty}>Aucun logement disponible.</Text>}
              {items.map((o) => {
                const on = values.includes(o.id);
                return (
                  <Pressable key={o.id} testID={`${testID}-opt-${o.id}`} onPress={() => toggle(o.id)} style={styles.opt}>
                    <View style={[styles.checkbox, on && styles.checkboxOn]}>
                      {on && <Ionicons name="checkmark" size={15} color={colors.onBrandPrimary} />}
                    </View>
                    <Text style={styles.optText} numberOfLines={1}>{o.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable testID={`${testID}-done`} onPress={() => setOpen(false)} style={styles.done}>
              <Text style={styles.doneText}>Valider</Text>
            </Pressable>
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
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  sheetTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  allBtn: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.brandPrimary },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, paddingVertical: spacing.lg },
  opt: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 12, paddingHorizontal: spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  optText: { flex: 1, fontFamily: font.medium, fontSize: fontSize.lg, color: colors.onSurface },
  done: { marginTop: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  doneText: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
});
