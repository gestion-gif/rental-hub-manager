import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Calendar, LocaleConfig } from "react-native-calendars";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

LocaleConfig.locales["fr"] = {
  monthNames: [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ],
  monthNamesShort: ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"],
  dayNames: ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"],
  dayNamesShort: ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"],
  today: "Aujourd'hui",
};
LocaleConfig.defaultLocale = "fr";

// value stored as ISO YYYY-MM-DD, displayed as DD-MM-YYYY
export function isoToDisplay(iso?: string) {
  if (!iso || iso.length < 10) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

export default function DateField({
  label,
  value,
  onChange,
  testID,
  placeholder = "JJ-MM-AAAA",
  minDate,
}: {
  label: string;
  value: string; // ISO
  onChange: (iso: string) => void;
  testID?: string;
  placeholder?: string;
  minDate?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable testID={testID} onPress={() => setOpen(true)} style={styles.input}>
        <Text style={[styles.value, !value && styles.placeholder]}>
          {value ? isoToDisplay(value) : placeholder}
        </Text>
        <Ionicons name="calendar-outline" size={18} color={colors.onSurfaceTertiary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <Pressable testID={`${testID}-close`} onPress={() => setOpen(false)}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <Calendar
              current={value || undefined}
              minDate={minDate}
              onDayPress={(day: any) => {
                onChange(day.dateString);
                setOpen(false);
              }}
              markedDates={value ? { [value]: { selected: true, selectedColor: colors.brandPrimary } } : {}}
              firstDay={1}
              theme={{
                todayTextColor: colors.brandPrimary,
                arrowColor: colors.onSurface,
                textDayFontFamily: font.regular,
                textMonthFontFamily: font.semibold,
                textDayHeaderFontFamily: font.medium,
                selectedDayBackgroundColor: colors.brandPrimary,
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  input: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  value: { fontFamily: font.regular, fontSize: fontSize.lg, color: colors.onSurface },
  placeholder: { color: colors.onSurfaceTertiary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, overflow: "hidden" },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.sm, marginBottom: spacing.xs },
  sheetTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
});
