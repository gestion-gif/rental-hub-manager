import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Alert, ScrollView, Modal, Switch } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { canModify } from "@/src/permissions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function Rooms() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { property } = useLocalSearchParams<{ property: string }>();
  const { user } = useAuth();
  const editable = canModify(user);
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [roomModal, setRoomModal] = useState<any>(null);
  const [planModal, setPlanModal] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([
        api.get(`/properties/${property}/rooms`),
        api.get(`/properties/${property}/rate-plans`),
      ]);
      setRooms(r.rooms || []);
      setPlans(p.rate_plans || []);
    } catch {}
    setLoading(false);
  }, [property]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function saveRoom(form: any) {
    const body = { name: form.name.trim(), max_guests: parseInt(form.max_guests) || 2, count_of_rooms: parseInt(form.count_of_rooms) || 1 };
    if (!body.name) { Alert.alert("Nom requis"); return; }
    try {
      if (form.id) await api.put(`/rooms/${form.id}`, body);
      else await api.post(`/properties/${property}/rooms`, body);
      setRoomModal(null); load();
    } catch { Alert.alert("Erreur", "Enregistrement impossible."); }
  }

  async function savePlan(form: any) {
    const body = { name: form.name.trim(), room_id: form.room_id || null, base_price: parseFloat((form.base_price || "0").replace(",", ".")) || 0, min_stay: parseInt(form.min_stay) || 1, closed: !!form.closed };
    if (!body.name) { Alert.alert("Nom requis"); return; }
    try {
      if (form.id) await api.put(`/rate-plans/${form.id}`, body);
      else await api.post(`/properties/${property}/rate-plans`, body);
      setPlanModal(null); load();
    } catch { Alert.alert("Erreur", "Enregistrement impossible."); }
  }

  function delRoom(id: string) {
    Alert.alert("Supprimer la chambre", "Les tarifs liés seront aussi supprimés.", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => { try { await api.del(`/rooms/${id}`); load(); } catch {} } },
    ]);
  }
  async function delPlan(id: string) { try { await api.del(`/rate-plans/${id}`); load(); } catch {} }

  const roomName = (rid: string) => rooms.find((r) => r.id === rid)?.name || "—";

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="rooms-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Chambres & tarifs</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60 }}>
          <View style={styles.secHead}>
            <Text style={styles.secTitle}>Chambres ({rooms.length})</Text>
            {editable && (
              <Pressable testID="add-room" onPress={() => setRoomModal({ name: "", max_guests: "2", count_of_rooms: "1" })} style={styles.addBtn}>
                <Ionicons name="add" size={16} color={colors.onBrandPrimary} /><Text style={styles.addText}>Ajouter</Text>
              </Pressable>
            )}
          </View>
          {rooms.length === 0 && <Text style={styles.empty}>Aucune chambre. Ajoutez une unité vendable.</Text>}
          {rooms.map((r) => (
            <Pressable key={r.id} testID={`room-${r.id}`} onPress={() => editable && setRoomModal({ ...r, max_guests: String(r.max_guests), count_of_rooms: String(r.count_of_rooms) })} style={styles.card}>
              <View style={styles.cardIcon}><Ionicons name="bed-outline" size={18} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{r.name}</Text>
                <Text style={styles.cardMeta}>{r.max_guests} voyageurs · {r.count_of_rooms} unité(s){r.channex_room_type_id ? " · Channex" : ""}</Text>
              </View>
              <Pressable testID={`avail-room-${r.id}`} onPress={() => router.push(`/room-availability?room=${r.id}&name=${encodeURIComponent(r.name)}`)} hitSlop={8} style={{ marginRight: 8 }}>
                <Ionicons name="calendar-outline" size={18} color={colors.brandPrimary} />
              </Pressable>
              {editable && <Pressable testID={`del-room-${r.id}`} onPress={() => delRoom(r.id)} hitSlop={8}><Ionicons name="trash-outline" size={18} color="#E5484D" /></Pressable>}
            </Pressable>
          ))}

          <View style={[styles.secHead, { marginTop: spacing.xl }]}>
            <Text style={styles.secTitle}>Plans tarifaires ({plans.length})</Text>
            {editable && (
              <Pressable testID="add-plan" onPress={() => setPlanModal({ name: "", base_price: "", min_stay: "1", room_id: "", closed: false })} style={styles.addBtn}>
                <Ionicons name="add" size={16} color={colors.onBrandPrimary} /><Text style={styles.addText}>Ajouter</Text>
              </Pressable>
            )}
          </View>
          {plans.length === 0 && <Text style={styles.empty}>Aucun plan tarifaire.</Text>}
          {plans.map((p) => (
            <Pressable key={p.id} testID={`plan-${p.id}`} onPress={() => editable && setPlanModal({ ...p, base_price: String(p.base_price || ""), min_stay: String(p.min_stay || 1) })} style={styles.card}>
              <View style={styles.cardIcon}><Ionicons name="pricetag-outline" size={18} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{p.name}{p.closed ? " · fermé" : ""}</Text>
                <Text style={styles.cardMeta}>{Number(p.base_price || 0).toFixed(0)} € · min. {p.min_stay} nuit(s){p.room_id ? " · " + roomName(p.room_id) : ""}{p.channex_rate_plan_id ? " · Channex" : ""}</Text>
              </View>
              {editable && <Pressable testID={`del-plan-${p.id}`} onPress={() => delPlan(p.id)} hitSlop={8}><Ionicons name="trash-outline" size={18} color="#E5484D" /></Pressable>}
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Room modal */}
      <Modal visible={!!roomModal} transparent animationType="fade" onRequestClose={() => setRoomModal(null)}>
        <Pressable style={styles.backdrop} onPress={() => setRoomModal(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{roomModal?.id ? "Modifier la chambre" : "Nouvelle chambre"}</Text>
            <Text style={styles.fieldLabel}>Nom</Text>
            <TextInput testID="room-name" value={roomModal?.name} onChangeText={(v) => setRoomModal((m: any) => ({ ...m, name: v }))} placeholder="Ex : Chambre double" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Voyageurs max</Text>
                <TextInput testID="room-guests" value={roomModal?.max_guests} onChangeText={(v) => setRoomModal((m: any) => ({ ...m, max_guests: v }))} keyboardType="number-pad" style={styles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Nb d'unités</Text>
                <TextInput testID="room-count" value={roomModal?.count_of_rooms} onChangeText={(v) => setRoomModal((m: any) => ({ ...m, count_of_rooms: v }))} keyboardType="number-pad" style={styles.input} />
              </View>
            </View>
            <Pressable testID="room-save" onPress={() => saveRoom(roomModal)} style={styles.saveBtn}><Text style={styles.saveText}>Enregistrer</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Plan modal */}
      <Modal visible={!!planModal} transparent animationType="fade" onRequestClose={() => setPlanModal(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPlanModal(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>{planModal?.id ? "Modifier le tarif" : "Nouveau plan tarifaire"}</Text>
            <Text style={styles.fieldLabel}>Nom</Text>
            <TextInput testID="plan-name" value={planModal?.name} onChangeText={(v) => setPlanModal((m: any) => ({ ...m, name: v }))} placeholder="Ex : Tarif flexible" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Prix de base (€)</Text>
                <TextInput testID="plan-price" value={planModal?.base_price} onChangeText={(v) => setPlanModal((m: any) => ({ ...m, base_price: v }))} keyboardType="decimal-pad" style={styles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Séjour min.</Text>
                <TextInput testID="plan-minstay" value={planModal?.min_stay} onChangeText={(v) => setPlanModal((m: any) => ({ ...m, min_stay: v }))} keyboardType="number-pad" style={styles.input} />
              </View>
            </View>
            {rooms.length > 0 && (
              <>
                <Text style={styles.fieldLabel}>Chambre liée (optionnel)</Text>
                <View style={styles.roomChips}>
                  <Pressable onPress={() => setPlanModal((m: any) => ({ ...m, room_id: "" }))} style={[styles.roomChip, !planModal?.room_id && styles.roomChipOn]}><Text style={[styles.roomChipText, !planModal?.room_id && styles.roomChipTextOn]}>Aucune</Text></Pressable>
                  {rooms.map((r) => (
                    <Pressable key={r.id} onPress={() => setPlanModal((m: any) => ({ ...m, room_id: r.id }))} style={[styles.roomChip, planModal?.room_id === r.id && styles.roomChipOn]}><Text style={[styles.roomChipText, planModal?.room_id === r.id && styles.roomChipTextOn]}>{r.name}</Text></Pressable>
                  ))}
                </View>
              </>
            )}
            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel}>Fermé à la vente</Text>
              <Switch value={!!planModal?.closed} onValueChange={(v) => setPlanModal((m: any) => ({ ...m, closed: v }))} />
            </View>
            <Pressable testID="plan-save" onPress={() => savePlan(planModal)} style={styles.saveBtn}><Text style={styles.saveText}>Enregistrer</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  secHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  secTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.md },
  addText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onBrandPrimary },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginBottom: spacing.md },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  cardIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  cardName: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  cardMeta: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, padding: spacing.lg },
  sheetTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.md },
  fieldLabel: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginBottom: 6, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface },
  roomChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  roomChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  roomChipOn: { backgroundColor: "#EAF3FA", borderColor: colors.brandPrimary },
  roomChipText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  roomChipTextOn: { color: colors.brandPrimary, fontFamily: font.semibold },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  saveBtn: { marginTop: spacing.lg, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  saveText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
});
