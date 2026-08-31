import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { HelpButton } from "@/src/components/HelpButton";

const SECTIONS = [
  { title: "Entreprise", items: [
    { path: "/settings/company", icon: "business-outline", title: "Ma société", sub: "Coordonnées sur les relevés (PDF & email)" },
    { path: "/settings/members", icon: "people-circle-outline", title: "Utilisateurs", sub: "Équipe, rôles & autorisations" },
    { path: "/settings/staff", icon: "people-outline", title: "Intervenants", sub: "Équipe ménage & technique" },
    { path: "/settings/owners", icon: "person-outline", title: "Propriétaires", sub: "Fiches, logements & revenus" },
  ] },
  { title: "Réservations & tarifs", items: [
    { path: "/settings/booking-policies", icon: "document-lock-outline", title: "Politique de réservation", sub: "Paiement, annulation, caution, devis" },
    { path: "/settings/online-checkin", icon: "clipboard-outline", title: "Enregistrement en ligne", sub: "Formulaire d'arrivée & rappels automatiques" },
    { path: "/settings/promotions", icon: "pricetags-outline", title: "Promotions", sub: "Codes promo & réductions par hébergement" },
    { path: "/settings/supplements", icon: "pricetag-outline", title: "Suppléments", sub: "Extras : photo, calcul, TVA & hébergements" },
    { path: "/settings/commissions", icon: "cash-outline", title: "Commissions plateformes", sub: "Taux par plateforme & revenu net" },
    { path: "/settings/tourist-tax", icon: "receipt-outline", title: "Taxe de séjour", sub: "Taux taxe de séjour & additionnelle par logement" },
    { path: "/settings/payments", icon: "card-outline", title: "Paiement", sub: "Passerelles & méthodes de paiement" },
  ] },
  { title: "Communication", items: [
    { path: "/settings/messages", icon: "chatbubbles-outline", title: "Messages automatiques", sub: "Modèles, marqueurs & couleurs" },
    { path: "/settings/quick-replies", icon: "flash-outline", title: "Réponses types", sub: "Modèles réutilisables en un tap" },
    { path: "/settings/assistant", icon: "sparkles-outline", title: "Assistant IA", sub: "Brouillons automatiques des réponses" },
    { path: "/settings/reports", icon: "bar-chart-outline", title: "Rapports & avis", sub: "Rapport mensuel auto & demandes d'avis" },
  ] },
  { title: "Opérations", items: [
    { path: "/settings/cleaning", icon: "sparkles-outline", title: "Ménage automatique", sub: "Quand planifier le ménage après le départ (J, J+1…)" },
  ] },
  { title: "Synchronisation & site", items: [
    { path: "/settings/channex", icon: "swap-horizontal-outline", title: "Channex", sub: "Channel manager (connexion & lecture)" },
    { path: "/settings/ical", icon: "calendar-outline", title: "Import / Export iCal", sub: "Synchro calendriers .ics (Airbnb, Booking…)" },
    { path: "/settings/booking-site", icon: "globe-outline", title: "Site de réservation", sub: "Site public de réservation directe (paiement en ligne)" },
    { path: "/settings/access-tokens", icon: "key-outline", title: "Clés API", sub: "Accès externe (version web PC…)" },
  ] },
  { title: "Affichage", items: [
    { path: "/settings/appearance", icon: "moon-outline", title: "Apparence", sub: "Mode clair, sombre ou automatique" },
    { path: "/settings/status-colors", icon: "color-palette-outline", title: "Couleurs des statuts", sub: "Personnalisez le code couleur" },
  ] },
];

export default function SettingsHub() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(SECTIONS[0].title);
  const toggle = (t: string) => setOpen((cur) => (cur === t ? null : t));
  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="settings-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Paramètres</Text>
        <HelpButton screen="settings" />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
        {SECTIONS.map((section) => {
          const expanded = open === section.title;
          return (
            <View key={section.title} style={styles.group}>
              <Pressable testID={`settings-section-${section.title}`} onPress={() => toggle(section.title)} style={styles.groupHead}>
                <Text style={styles.groupHeadText}>{section.title}</Text>
                <View style={styles.groupHeadRight}>
                  <Text style={styles.groupCount}>{section.items.length}</Text>
                  <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.onSurfaceTertiary} />
                </View>
              </Pressable>
              {expanded && section.items.map((o) => (
                <Pressable key={o.path} testID={`settings-${o.path}`} onPress={() => router.push(o.path)} style={styles.row}>
                  <View style={styles.iconWrap}><Ionicons name={o.icon as any} size={20} color={colors.onSurface} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{o.title}</Text>
                    <Text style={styles.rowSub}>{o.sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
                </Pressable>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  sectionTitle: { fontFamily: font.bold, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: spacing.sm },
  group: { marginBottom: spacing.sm },
  groupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  groupHeadText: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurface, textTransform: "uppercase", letterSpacing: 0.4 },
  groupHeadRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  groupCount: { fontFamily: font.semibold, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, backgroundColor: colors.surface, borderRadius: radius.pill, minWidth: 20, textAlign: "center", paddingHorizontal: 6, paddingVertical: 2, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  iconWrap: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  rowSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
});
