import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { roleName } from "@/src/permissions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function MembersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setItems(await api.get("/members")); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function fullName(m: any) {
    return [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.email || "Sans nom";
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="members-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Utilisateurs</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}
          ListEmptyComponent={<Text style={styles.empty}>Aucun utilisateur. Ajoutez les membres de votre équipe et définissez leurs rôles et autorisations.</Text>}
          renderItem={({ item }) => {
            const nbPerms = (item.permissions || []).length;
            return (
              <Pressable
                testID={`member-${item.id}`}
                onPress={() => router.push({ pathname: "/settings/member-form", params: { id: item.id } })}
                style={styles.row}
              >
                <View style={styles.avatar}><Ionicons name="person" size={18} color={colors.onSurfaceSecondary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{fullName(item)}</Text>
                  <Text style={styles.rowSub}>{[roleName(item.role), `${nbPerms} autorisation${nbPerms > 1 ? "s" : ""}`].join(" · ")}</Text>
                </View>
                {item.active === false && <View style={styles.inactive}><Text style={styles.inactiveTxt}>Inactif</Text></View>}
                <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
              </Pressable>
            );
          }}
        />
      )}

      <Pressable
        testID="add-member-fab"
        onPress={() => router.push("/settings/member-form")}
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
      >
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: 60, paddingHorizontal: spacing.xl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  rowSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  inactive: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  inactiveTxt: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 6, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});
