import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Drawer } from "expo-router/drawer";
import { DrawerContentScrollView } from "@react-navigation/drawer";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { canSeeRevenue, canSeeInbox, canSeeSettings } from "@/src/permissions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const ITEMS = [
  { name: "index", label: "Accueil", icon: "home-outline" },
  { name: "calendar", label: "Réservations", icon: "list-outline" },
  { name: "planning", label: "Calendrier", icon: "calendar-outline" },
  { name: "properties", label: "Logements", icon: "business-outline" },
  { name: "statement", label: "Relevé propriétaires", icon: "document-text-outline", revenue: true },
  { name: "assistant", label: "Assistant IA", icon: "sparkles-outline" },
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

        {ITEMS.map((it) => {
          if ((it as any).revenue && !canSeeRevenue(user)) return null;
          const active = current === it.name;
          return (
            <React.Fragment key={it.name}>
              <Pressable
                testID={`drawer-${it.name}`}
                onPress={() => navigation.navigate(it.name)}
                style={[styles.item, active && styles.itemActive]}
              >
                <Ionicons name={it.icon as any} size={20} color={active ? colors.brandPrimary : colors.onSurfaceSecondary} />
                <Text style={[styles.itemText, active && styles.itemTextActive]}>{it.label}</Text>
              </Pressable>
              {it.name === "index" && canSeeInbox(user) && (
                <Pressable testID="drawer-inbox" onPress={() => goStack("/inbox")} style={styles.item}>
                  <Ionicons name="mail-outline" size={20} color={colors.onSurfaceSecondary} />
                  <Text style={styles.itemText}>Boîte de réception</Text>
                  {unread > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
                    </View>
                  )}
                </Pressable>
              )}
            </React.Fragment>
          );
        })}

        <View style={styles.sep} />

        <Pressable testID="drawer-cleaning" onPress={() => goStack("/cleaning")} style={styles.item}>
          <Ionicons name="sparkles-outline" size={20} color={colors.onSurfaceSecondary} />
          <Text style={styles.itemText}>À faire aujourd'hui</Text>
        </Pressable>

        {canSeeRevenue(user) && (
          <Pressable testID="drawer-analytics" onPress={() => goStack("/analytics")} style={styles.item}>
            <Ionicons name="stats-chart-outline" size={20} color={colors.onSurfaceSecondary} />
            <Text style={styles.itemText}>Statistiques</Text>
          </Pressable>
        )}
        {canSeeSettings(user) && (
          <Pressable testID="drawer-settings" onPress={() => goStack("/settings")} style={styles.item}>
            <Ionicons name="settings-outline" size={20} color={colors.onSurfaceSecondary} />
            <Text style={styles.itemText}>Paramètres</Text>
          </Pressable>
        )}
      </DrawerContentScrollView>

      <Pressable
        testID="drawer-signout"
        onPress={signOut}
        style={[styles.item, { marginBottom: insets.bottom + spacing.md, marginHorizontal: spacing.md }]}
      >
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={[styles.itemText, { color: colors.error }]}>Déconnexion</Text>
      </Pressable>
    </View>
  );
}

export default function DrawerLayout() {
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
  item: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 13, paddingHorizontal: spacing.lg, borderRadius: radius.md, marginHorizontal: spacing.sm },
  itemActive: { backgroundColor: colors.surfaceSecondary },
  itemText: { fontFamily: font.medium, fontSize: fontSize.lg, color: colors.onSurfaceSecondary },
  itemTextActive: { color: colors.brandPrimary, fontFamily: font.semibold },
  badge: { marginLeft: "auto", backgroundColor: colors.error, borderRadius: radius.pill, minWidth: 20, height: 20, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: font.bold, fontSize: fontSize.sm, color: "#fff" },
});
