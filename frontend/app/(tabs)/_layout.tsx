import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Drawer } from "expo-router/drawer";
import { DrawerContentScrollView } from "@react-navigation/drawer";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter, Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { canSeeRevenue, canSeeInbox, canSeeSettings, canModify } from "@/src/permissions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type NavItem = { key: string; label: string; icon: string; kind: "tab" | "stack"; path?: string; gate?: "revenue" | "admin" | "modify" | "inbox" | "settings" };
const SECTIONS: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [
    { key: "index", label: "Accueil", icon: "home-outline", kind: "tab" },
    { key: "inbox", label: "Boîte de réception", icon: "mail-outline", kind: "stack", path: "/inbox", gate: "inbox" },
  ] },
  { title: "Gestion", items: [
    { key: "calendar", label: "Réservations", icon: "list-outline", kind: "tab" },
    { key: "planning", label: "Calendrier", icon: "calendar-outline", kind: "tab" },
    { key: "properties", label: "Logements", icon: "business-outline", kind: "tab" },
    { key: "cleaning", label: "À faire aujourd'hui", icon: "checkbox-outline", kind: "stack", path: "/cleaning" },
  ] },
  { title: "Revenus", items: [
    { key: "statement", label: "Relevé propriétaires", icon: "document-text-outline", kind: "tab", gate: "revenue" },
    { key: "kpi", label: "Tableau de bord", icon: "speedometer-outline", kind: "stack", path: "/kpi", gate: "revenue" },
    { key: "analytics", label: "Statistiques", icon: "stats-chart-outline", kind: "stack", path: "/analytics", gate: "revenue" },
    { key: "reviews", label: "Avis voyageurs", icon: "star-outline", kind: "stack", path: "/reviews", gate: "revenue" },
  ] },
  { title: "Outils", items: [
    { key: "assistant", label: "Assistant IA", icon: "sparkles-outline", kind: "tab" },
    { key: "website", label: "Site Web", icon: "globe-outline", kind: "stack", path: "/settings/booking-site", gate: "modify" },
    { key: "integrations", label: "Intégrations", icon: "link-outline", kind: "tab", gate: "admin" },
  ] },
  { title: "Compte", items: [
    { key: "settings", label: "Paramètres", icon: "settings-outline", kind: "stack", path: "/settings", gate: "settings" },
    { key: "help", label: "Aide", icon: "help-buoy-outline", kind: "stack", path: "/help" },
  ] },
];

function CustomDrawer(props: any) {
  const { state, navigation } = props;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const current = state.routeNames[state.index];
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    api.get("/inbox-unread-count").then((r: any) => setUnread(r?.count || 0)).catch(() => {});
  }, [state.index]);

  const goStack = (path: string) => {
    navigation.closeDrawer();
    router.push(path);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <DrawerContentScrollView {...props} contentContainerStyle={{ paddingTop: insets.top + spacing.lg }}>
        <View style={styles.brand}>
          <View style={styles.logo}><Ionicons name="home" size={20} color={colors.onBrandPrimary} /></View>
          <Text style={styles.brandText}>Casanéo</Text>
        </View>

        <View style={styles.userRow}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatar} />
          ) : (
            <View style={styles.avatar}><Ionicons name="person" size={18} color={colors.onSurfaceSecondary} /></View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.userName} numberOfLines={1}>{user?.name || "Hôte"}</Text>
            <Text style={styles.userEmail} numberOfLines={1}>{user?.email || ""}</Text>
          </View>
        </View>

        <View style={styles.sep} />

        {SECTIONS.map((section, si) => {
          const visible = section.items.filter((it) => {
            if (it.gate === "revenue") return canSeeRevenue(user);
            if (it.gate === "admin" || it.gate === "modify") return canModify(user);
            if (it.gate === "inbox") return canSeeInbox(user);
            if (it.gate === "settings") return canSeeSettings(user);
            return true;
          });
          if (!visible.length) return null;
          return (
            <View key={si}>
              {si > 0 && <View style={styles.sep} />}
              {section.title && <Text style={styles.sectionTitle}>{section.title}</Text>}
              {visible.map((it) => {
                const active = it.kind === "tab" && current === it.key;
                return (
                  <Pressable
                    key={it.key}
                    testID={`drawer-${it.key}`}
                    onPress={() => { if (it.kind === "tab") navigation.navigate(it.key); else goStack(it.path!); }}
                    style={[styles.item, active && styles.itemActive]}
                  >
                    <Ionicons name={it.icon as any} size={20} color={active ? colors.brandPrimary : colors.onSurfaceSecondary} />
                    <Text style={[styles.itemText, active && styles.itemTextActive]}>{it.label}</Text>
                    {it.key === "inbox" && unread > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </DrawerContentScrollView>

      <Pressable
        testID="drawer-signout"
        onPress={async () => { navigation.closeDrawer(); await signOut(); }}
        style={[styles.item, { marginBottom: insets.bottom + spacing.md, marginHorizontal: spacing.md }]}
      >
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={[styles.itemText, { color: colors.error }]}>Déconnexion</Text>
      </Pressable>
    </View>
  );
}

export default function DrawerLayout() {
  const { user, loading } = useAuth();
  if (!loading && !user) return <Redirect href="/login" />;
  return (
    <Drawer
      drawerContent={(p) => <CustomDrawer {...p} />}
      screenOptions={{ headerShown: false, drawerType: "front", swipeEdgeWidth: 60 }}
    >
      <Drawer.Screen name="index" />
      <Drawer.Screen name="calendar" />
      <Drawer.Screen name="planning" />
      <Drawer.Screen name="properties" />
      <Drawer.Screen name="statement" />
      <Drawer.Screen name="assistant" />
      <Drawer.Screen name="integrations" />
    </Drawer>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  logo: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  brandText: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  userRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  userName: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  userEmail: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md, marginHorizontal: spacing.lg },
  sectionTitle: { fontFamily: font.bold, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.6, marginTop: spacing.sm, marginBottom: 4, paddingHorizontal: spacing.lg },
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 13, paddingHorizontal: spacing.lg, borderRadius: radius.md, marginHorizontal: spacing.sm },
  itemActive: { backgroundColor: colors.surfaceSecondary },
  itemText: { fontFamily: font.medium, fontSize: fontSize.lg, color: colors.onSurfaceSecondary },
  itemTextActive: { color: colors.brandPrimary, fontFamily: font.semibold },
  badge: { marginLeft: "auto", backgroundColor: colors.error, borderRadius: radius.pill, minWidth: 20, height: 20, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: font.bold, fontSize: fontSize.sm, color: "#fff" },
});
