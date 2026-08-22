import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const OPTIONS = [
  { path: "/settings/members", icon: "people-circle-outline", title: "Utilisateurs", sub: "Équipe, rôles & autorisations" },
  { path: "/settings/staff", icon: "people-outline", title: "Intervenants", sub: "Équipe ménage & technique" },
  { path: "/settings/owners", icon: "person-outline", title: "Propriétaires", sub: "Fiches, logements & revenus" },
  { path: "/settings/messages", icon: "chatbubbles-outline", title: "Messages automatiques", sub: "Modèles, marqueurs & couleurs" },
  { path: "/settings/commissions", icon: "cash-outline", title: "Commissions plateformes", sub: "Taux par plateforme & revenu net" },
  { path: "/settings/payments", icon: "card-outline", title: "Paiement", sub: "Passerelles & méthodes de paiement" },
  { path: "/settings/api-key", icon: "key-outline", title: "Clé API Lodgify", sub: "Connexion channel manager" },
  { path: "/settings/ical", icon: "calendar-outline", title: "Import / Export iCal", sub: "Synchro calendriers .ics (Airbnb, Booking…)" },
  { path: "/settings/status-colors", icon: "color-palette-outline", title: "Couleurs des statuts", sub: "Personnalisez le code couleur" },
];

export default function SettingsHub() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="settings-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Paramètres</Text>
        <View style={{ width: 34 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
        {OPTIONS.map((o) => (
          <Pressable key={o.path} testID={`settings-${o.path}`} onPress={() => router.push(o.path)} style={styles.row}>
            <View style={styles.iconWrap}><Ionicons name={o.icon as any} size={20} color={colors.onSurface} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{o.title}</Text>
              <Text style={styles.rowSub}>{o.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  iconWrap: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  rowSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
});
