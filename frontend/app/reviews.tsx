import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal, TextInput, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import dayjs from "dayjs";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { canModify } from "@/src/permissions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

function Stars({ n, size = 15 }: { n: number; size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name={i <= Math.round(n) ? "star" : "star-outline"} size={size} color="#F5A623" />
      ))}
    </View>
  );
}

export default function ReviewsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [summary, setSummary] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [props, setProps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r, p] = await Promise.all([
        api.get("/reviews/summary"), api.get("/reviews"), api.get("/properties"),
      ]);
      setSummary(s); setReviews(r); setProps(p);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function remove(id: string) {
    Alert.alert("Supprimer", "Supprimer cet avis ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => { await api.del(`/reviews/${id}`); load(); } },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="reviews-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Avis voyageurs</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Note moyenne globale</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 }}>
              <Text style={styles.heroValue}>{summary?.avg_all || 0}</Text>
              <Stars n={summary?.avg_all || 0} size={18} />
            </View>
            <Text style={styles.heroSub}>{summary?.total_reviews || 0} avis</Text>
          </View>

          <Text style={styles.section}>Par logement</Text>
          <View style={styles.card}>
            {(summary?.per_property || []).map((p: any, i: number) => (
              <View key={p.property_id} style={[styles.propRow, i > 0 && styles.rowBorder]}>
                <Text style={styles.propName} numberOfLines={1}>{p.property_name}</Text>
                <Stars n={p.avg} />
                <Text style={styles.propAvg}>{p.avg || "—"}</Text>
                <Text style={styles.propCount}>({p.count})</Text>
              </View>
            ))}
          </View>

          <Text style={styles.section}>Derniers avis</Text>
          {reviews.length === 0 ? (
            <View style={styles.card}><Text style={styles.empty}>Aucun avis enregistré.</Text></View>
          ) : reviews.map((r) => (
            <View key={r.id} style={styles.reviewCard}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Stars n={r.rating} />
                <View style={{ flex: 1 }} />
                <Text style={styles.reviewDate}>{r.date ? dayjs(r.date).format("DD/MM/YYYY") : ""}</Text>
                {canModify(user) && (
                  <Pressable testID={`review-del-${r.id}`} onPress={() => remove(r.id)} hitSlop={8} style={{ marginLeft: 8 }}>
                    <Ionicons name="trash-outline" size={16} color="#E5484D" />
                  </Pressable>
                )}
              </View>
              <Text style={styles.reviewProp}>{r.property_name}{r.guest_name ? ` · ${r.guest_name}` : ""}</Text>
              {!!r.comment && <Text style={styles.reviewComment}>{r.comment}</Text>}
            </View>
          ))}
        </ScrollView>
      )}

      {canModify(user) && (
        <Pressable testID="review-add" onPress={() => setAddOpen(true)} style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}>
          <Ionicons name="add" size={26} color={colors.onBrandPrimary} />
        </Pressable>
      )}

      <AddReviewModal open={addOpen} onClose={() => setAddOpen(false)} props={props} onSaved={() => { setAddOpen(false); load(); }} />
    </View>
  );
}

function AddReviewModal({ open, onClose, props, onSaved }: any) {
  const [pid, setPid] = useState<string>("");
  const [rating, setRating] = useState(5);
  const [guest, setGuest] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open) { setPid(props[0]?.id || ""); setRating(5); setGuest(""); setComment(""); }
  }, [open]);

  async function save() {
    if (!pid) { Alert.alert("Logement requis", "Choisissez un logement."); return; }
    setSaving(true);
    try {
      await api.post("/reviews", { property_id: pid, rating, guest_name: guest, comment });
      onSaved();
    } catch { Alert.alert("Erreur", "Enregistrement impossible."); }
    setSaving(false);
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Ajouter un avis</Text>
            <Pressable onPress={onClose}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.mLabel}>Logement</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                {props.map((p: any) => (
                  <Pressable key={p.id} testID={`review-prop-${p.id}`} onPress={() => setPid(p.id)} style={[styles.pChip, pid === p.id && styles.pChipOn]}>
                    <Text style={[styles.pChipText, pid === p.id && styles.pChipTextOn]} numberOfLines={1}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.mLabel}>Note</Text>
            <View style={{ flexDirection: "row", gap: 6, marginBottom: spacing.md }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <Pressable key={i} testID={`review-star-${i}`} onPress={() => setRating(i)}>
                  <Ionicons name={i <= rating ? "star" : "star-outline"} size={30} color="#F5A623" />
                </Pressable>
              ))}
            </View>

            <Text style={styles.mLabel}>Voyageur (facultatif)</Text>
            <TextInput testID="review-guest" value={guest} onChangeText={setGuest} placeholder="Nom du voyageur"
              placeholderTextColor={colors.onSurfaceTertiary} style={styles.mInput} />

            <Text style={styles.mLabel}>Commentaire (facultatif)</Text>
            <TextInput testID="review-comment" value={comment} onChangeText={setComment} placeholder="Retour du voyageur…"
              placeholderTextColor={colors.onSurfaceTertiary} style={[styles.mInput, { minHeight: 80, textAlignVertical: "top" }]} multiline />

            <Pressable testID="review-save" onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Enregistrer l'avis</Text>}
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  heroCard: { backgroundColor: "#2A6F9E", borderRadius: 20, padding: spacing.lg, marginBottom: spacing.md },
  heroLabel: { fontFamily: font.medium, fontSize: fontSize.base, color: "#D6E7F3" },
  heroValue: { fontFamily: font.bold, fontSize: 32, color: "#fff" },
  heroSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: "#D6E7F3", marginTop: 6 },
  section: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  propRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 10 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  propName: { flex: 1, fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
  propAvg: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurface, marginLeft: 4 },
  propCount: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  reviewCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  reviewDate: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  reviewProp: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface, marginTop: 6 },
  reviewComment: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginTop: 4, lineHeight: 20 },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", paddingVertical: spacing.sm },
  fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, maxHeight: "88%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  sheetTitle: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  mLabel: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginBottom: 6 },
  mInput: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, marginBottom: spacing.md },
  pChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, maxWidth: 160 },
  pChipOn: { backgroundColor: colors.brandPrimary },
  pChipText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  pChipTextOn: { color: colors.onBrandPrimary },
  saveBtn: { backgroundColor: "#17B0A6", borderRadius: radius.lg, paddingVertical: 15, alignItems: "center", marginTop: spacing.sm, marginBottom: spacing.lg },
  saveText: { fontFamily: font.bold, fontSize: fontSize.lg, color: "#fff" },
});
