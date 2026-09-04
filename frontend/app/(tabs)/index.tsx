import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import dayjs from "dayjs";
import "dayjs/locale/fr";


import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api";
import { MenuButton } from "@/src/components/MenuButton";
import CelebrationBanner from "@/src/components/CelebrationBanner";
import { HelpButton } from "@/src/components/HelpButton";
import StatusBadge from "@/src/components/StatusBadge";
import { getInterventionType } from "@/src/interventionTypes";
import { InterventionIcon } from "@/src/components/InterventionIcon";
import { canSeeRevenue, canSeeOccupancy, canSeeCurrentStays, canSeeInbox, canModify, guestLabel } from "@/src/permissions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Dash = {
  occupancy_rate: number;
  revenue_month: number;
  total_properties: number;
  upcoming_count: number;
  current_stays: any[];
  arrivals_today: any[];
  departures_today: any[];
  interventions: any[];
};

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();

  function openAccountMenu() {
    Alert.alert(
      user?.name || "Compte",
      user?.email || "",
      [
        { text: "Changer de compte", onPress: () => { signOut(); } },
        { text: "Déconnexion", style: "destructive", onPress: () => { signOut(); } },
        { text: "Annuler", style: "cancel" },
      ],
    );
  }

  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ivOpen, setIvOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [drafts, setDrafts] = useState(0);
  const [arrOpen, setArrOpen] = useState(false);
  const [stayOpen, setStayOpen] = useState(false);
  const [depOpen, setDepOpen] = useState(false);
  const [stmtOpen, setStmtOpen] = useState(true);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [depBusy, setDepBusy] = useState<string>("");
  const [cautionOpen, setCautionOpen] = useState(true);
  const [payments, setPayments] = useState<any[]>([]);
  const [payOpen, setPayOpen] = useState(true);
  const [pendingStmts, setPendingStmts] = useState<any>({ count: 0, pending: [], period_label: "" });
  const [celebration, setCelebration] = useState<{ count: number; latest: any } | null>(null);

  const checkCelebration = useCallback(async () => {
    try {
      const key = `casaneo:lastSeenReservations:${user?.user_id || user?.email || "me"}`;
      const since = await AsyncStorage.getItem(key);
      const nowIso = new Date().toISOString();
      if (since) {
        const res = await api.get(`/reservations/recent-confirmed?since=${encodeURIComponent(since)}`);
        if (res?.count > 0) {
          setCelebration({ count: res.count, latest: res.latest });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
      }
      await AsyncStorage.setItem(key, nowIso);
    } catch {}
  }, [user]);

  function dismissCelebration() {
    setCelebration(null);
  }

  function openCelebration() {
    const c = celebration;
    setCelebration(null);
    if (c?.count === 1 && c?.latest?.reservation_id) {
      router.push(`/reservation-form?id=${c.latest.reservation_id}`);
    } else {
      router.push("/(tabs)/planning");
    }
  }


  const load = useCallback(async () => {
    try {
      const [d, u] = await Promise.all([
        api.get("/dashboard"),
        api.get("/inbox-unread-count").catch(() => ({ count: 0 })),
      ]);
      setData(d);
      setUnread(u?.count || 0);
      api.get("/notifications/count").then((n) => setDrafts(n?.count || 0)).catch(() => {});
      if (canModify(user)) {
        api.get("/deposits/pending").then((list) => setDeposits(list || [])).catch(() => setDeposits([]));
        api.get("/payments/pending").then((list) => setPayments(list || [])).catch(() => setPayments([]));
        api.get("/owner-statement/pending-send").then((r) => setPendingStmts(r || { count: 0, pending: [] })).catch(() => setPendingStmts({ count: 0, pending: [] }));
      }
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  async function sendDeposit(rid: string) {
    if (depBusy) return;
    setDepBusy(rid);
    try {
      const res = await api.post(`/reservations/${rid}/send-deposit-link`, {});
      if (res.sent) {
        setDeposits((list) => list.filter((d) => d.reservation_id !== rid));
      } else {
        const reason = res.reason || "";
        Alert.alert("Envoi impossible",
          reason === "no_deposit_link" ? "Ajoutez le lien de caution sur la fiche logement."
          : reason === "no_messaging" || reason === "no_channel" ? "Réservation hors Lodgify (pas de messagerie voyageur)."
          : "Envoi impossible.");
      }
    } catch {
      Alert.alert("Erreur", "Envoi impossible.");
    }
    setDepBusy("");
  }

  useFocusEffect(
    useCallback(() => {
      load();
      checkCelebration();
    }, [load, checkCelebration]),
  );

  const firstName = (user?.name || "").split(" ")[0] || "hôte";

  return (
    <View style={styles.container}>
      <ScrollView
        testID="dashboard-scroll"
        contentContainerStyle={{
          paddingTop: insets.top + spacing.md,
          paddingBottom: 110,
          paddingHorizontal: spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
      >
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <MenuButton />
            <View>
              <Text style={styles.hello}>Bonjour,</Text>
              <Text style={styles.name}>{firstName} 👋</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <HelpButton screen="index" />
            {canSeeInbox(user) && (
              <Pressable testID="dash-inbox" onPress={() => router.push("/inbox")} style={styles.iconBtn}>
                <Ionicons name="mail-outline" size={20} color={colors.onSurfaceSecondary} />
                {unread > 0 && (
                  <View style={styles.iconBadge}>
                    <Text style={styles.iconBadgeText}>{unread > 9 ? "9+" : unread}</Text>
                  </View>
                )}
              </Pressable>
            )}
            <Pressable testID="signout-button" onPress={openAccountMenu} style={styles.avatar}>
              {user?.picture ? (
                <Image source={{ uri: user.picture }} style={styles.avatarImg} />
              ) : (
                <Ionicons name="person" size={20} color={colors.onSurfaceSecondary} />
              )}
            </Pressable>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
        ) : (
          <>
            <View style={styles.statsGrid}>
              {canSeeOccupancy(user) && (
                <StatCard
                  label="Taux d'occupation"
                  value={`${data?.occupancy_rate ?? 0}%`}
                  icon="pie-chart"
                  tint={colors.info}
                />
              )}
              {canSeeRevenue(user) && (
                <StatCard
                  label="Revenus du mois"
                  value={`${data?.revenue_month ?? 0} €`}
                  icon="cash"
                  tint={colors.success}
                />
              )}
              <StatCard
                label="Logements"
                value={`${data?.total_properties ?? 0}`}
                icon="business"
                tint={colors.warning}
                onPress={() => router.push("/(tabs)/properties")}
              />
              <StatCard
                label="À venir"
                value={`${data?.upcoming_count ?? 0}`}
                icon="time"
                tint={colors.brandPrimary}
                onPress={() => router.push("/(tabs)/planning")}
              />
            </View>

            {!loading && (
              <CelebrationBanner
                key={celebration && celebration.count > 0 ? `celebrate-${celebration.count}` : "greeting"}
                count={celebration?.count || 0}
                latest={celebration?.latest || null}
                onPress={openCelebration}
                onDismiss={dismissCelebration}
              />
            )}

            {canSeeInbox(user) && drafts > 0 && (
              <Pressable testID="dash-drafts-banner" onPress={() => router.push("/inbox")} style={styles.draftBanner}>
                <View style={styles.draftBannerIcon}>
                  <Ionicons name="sparkles" size={20} color={colors.onBrandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.draftBannerTitle}>{drafts} réponse{drafts > 1 ? "s" : ""} IA à valider</Text>
                  <Text style={styles.draftBannerSub}>Des brouillons sont prêts dans la boîte de réception</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.brandPrimary} />
              </Pressable>
            )}

            {canModify(user) && deposits.length > 0 && (
              <View style={[styles.cautionCard, deposits.some((d) => d.urgent) && styles.cautionCardUrgent]}>
                <Pressable testID="caution-toggle" onPress={() => setCautionOpen((o) => !o)} style={styles.cautionHeader}>
                  <View style={styles.cautionHeadLeft}>
                    <View style={[styles.cautionIcon, deposits.some((d) => d.urgent) && { backgroundColor: colors.error }]}>
                      <Ionicons name="shield-checkmark" size={18} color={colors.onBrandPrimary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cautionTitle}>Cautions à suivre</Text>
                      <Text style={styles.cautionSub}>{deposits.length} arrivée{deposits.length > 1 ? "s" : ""} sans caution validée</Text>
                    </View>
                  </View>
                  <Ionicons name={cautionOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.onSurfaceSecondary} />
                </Pressable>
                {cautionOpen && deposits.map((d) => (
                  <View key={d.reservation_id} style={styles.depRow} testID={`deposit-row-${d.reservation_id}`}>
                    <Pressable style={{ flex: 1 }} onPress={() => router.push(`/reservation-form?id=${d.reservation_id}`)}>
                      <View style={styles.depGuestRow}>
                        <Text style={styles.depGuest}>{guestLabel(user, d.guest_name)}</Text>
                        {d.urgent && (
                          <View style={styles.urgentBadge}>
                            <Text style={styles.urgentBadgeText}>{d.days_until <= 0 ? "Aujourd'hui" : "J-1"}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.depMeta, d.urgent && { color: colors.error, fontFamily: font.semibold }]}>
                        {d.property_name} · {dayjs(d.check_in).format("DD MMM")} · {d.reminder ? "Relancé" : d.sent ? "Lien envoyé" : "Non envoyé"}
                      </Text>
                    </Pressable>
                    <Pressable testID={`send-deposit-${d.reservation_id}`} onPress={() => sendDeposit(d.reservation_id)} disabled={depBusy === d.reservation_id} style={[styles.depSendBtn, depBusy === d.reservation_id && { opacity: 0.6 }]}>
                      {depBusy === d.reservation_id ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : (
                        <>
                          <Ionicons name="paper-plane" size={13} color={colors.onBrandPrimary} />
                          <Text style={styles.depSendText}>{d.sent ? "Renvoyer" : "Envoyer"}</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {canModify(user) && payments.length > 0 && (
              <View style={[styles.cautionCard, payments.some((d) => d.urgent) && styles.cautionCardUrgent]}>
                <Pressable testID="payment-toggle" onPress={() => setPayOpen((o) => !o)} style={styles.cautionHeader}>
                  <View style={styles.cautionHeadLeft}>
                    <View style={[styles.cautionIcon, { backgroundColor: colors.brandPrimary }, payments.some((d) => d.urgent) && { backgroundColor: colors.error }]}>
                      <Ionicons name="card" size={18} color={colors.onBrandPrimary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cautionTitle}>Paiements à suivre</Text>
                      <Text style={styles.cautionSub}>{payments.length} réservation{payments.length > 1 ? "s" : ""} avec solde impayé</Text>
                    </View>
                  </View>
                  <Ionicons name={payOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.onSurfaceSecondary} />
                </Pressable>
                {payOpen && payments.slice(0, 12).map((d) => (
                  <Pressable key={d.reservation_id} style={styles.depRow} testID={`payment-row-${d.reservation_id}`} onPress={() => router.push(`/reservation-form?id=${d.reservation_id}`)}>
                    <View style={{ flex: 1 }}>
                      <View style={styles.depGuestRow}>
                        <Text style={styles.depGuest}>{guestLabel(user, d.guest_name)}</Text>
                        {d.urgent && (
                          <View style={styles.urgentBadge}>
                            <Text style={styles.urgentBadgeText}>{d.days_until <= 0 ? "Aujourd'hui" : `J-${d.days_until}`}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.depMeta, d.urgent && { color: colors.error, fontFamily: font.semibold }]}>
                        {d.property_name || "—"} · {dayjs(d.check_in).format("DD MMM")}
                      </Text>
                    </View>
                    <View style={styles.dueWrap}>
                      <Text style={styles.dueLabel}>Solde</Text>
                      <Text style={[styles.dueValue, d.urgent && { color: colors.error }]}>{d.due.toFixed(0)} €</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {canModify(user) && (pendingStmts.count || 0) > 0 && (
              <View style={[styles.cautionCard, styles.cautionCardUrgent]}>
                <View style={styles.cautionHeader}>
                  <Pressable testID="stmt-pending-card" onPress={() => router.push("/statement")} style={styles.cautionHeadLeft}>
                    <View style={[styles.cautionIcon, { backgroundColor: colors.error }]}>
                      <Ionicons name="document-text" size={18} color={colors.onBrandPrimary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cautionTitle}>Relevés à envoyer</Text>
                      <Text style={styles.cautionSub}>{pendingStmts.count} relevé{pendingStmts.count > 1 ? "s" : ""} non envoyé{pendingStmts.count > 1 ? "s" : ""} · {pendingStmts.period_label}</Text>
                    </View>
                  </Pressable>
                  <Pressable testID="stmt-pending-toggle" onPress={() => setStmtOpen((o) => !o)} hitSlop={8} style={styles.stmtToggle}>
                    <Ionicons name={stmtOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.onSurfaceSecondary} />
                  </Pressable>
                </View>
                {stmtOpen && pendingStmts.pending.slice(0, 8).map((p: any) => (
                  <Pressable key={p.property_id} testID={`stmt-row-${p.property_id}`} onPress={() => router.push("/statement")} style={styles.depRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.depGuest}>{p.property_name}</Text>
                      <Text style={styles.depMeta}>{p.owner_name || "Propriétaire ?"}{!p.has_owner_email ? " · email manquant" : ""}</Text>
                    </View>
                    <View style={styles.dueWrap}>
                      <Text style={styles.dueLabel}>Propr.</Text>
                      <Text style={styles.dueValue}>{Number(p.owner_revenue || 0).toFixed(0)} €</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            <Pressable testID="dash-today-shortcut" onPress={() => router.push("/cleaning")} style={styles.todayCard}>
              <View style={styles.todayIcon}>
                <Ionicons name="today-outline" size={22} color={colors.onBrandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.todayTitle}>À faire aujourd'hui</Text>
                <Text style={styles.todaySub}>Départs, ménages, interventions, remises de clés & cautions</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>

            <CollapsibleSection
              title="Arrivées du jour"
              count={data?.arrivals_today?.length || 0}
              open={arrOpen}
              onToggle={() => setArrOpen((o) => !o)}
            >
              {data?.arrivals_today?.length ? (
                data.arrivals_today.map((r) => (
                  <StayCard key={r.id} r={{ ...r, guest_name: guestLabel(user, r.guest_name) }} onPress={() => router.push(`/reservation-form?id=${r.id}`)} />
                ))
              ) : (
                <EmptyRow text="Aucune arrivée aujourd'hui" />
              )}
            </CollapsibleSection>

            <CollapsibleSection
              title="Interventions"
              count={data?.interventions?.length || 0}
              open={ivOpen}
              onToggle={() => setIvOpen((o) => !o)}
            >
              {data?.interventions?.length ? (
                data.interventions.map((iv) => (
                  <InterventionCard key={iv.id} iv={iv} onPress={() => router.push(`/intervention-form?id=${iv.id}`)} />
                ))
              ) : (
                <EmptyRow text="Aucune intervention prévue" />
              )}
            </CollapsibleSection>

            {canSeeCurrentStays(user) && (
              <CollapsibleSection
                title="Séjours en cours"
                count={data?.current_stays?.length || 0}
                open={stayOpen}
                onToggle={() => setStayOpen((o) => !o)}
              >
                {data?.current_stays?.length ? (
                  data.current_stays.map((r) => (
                    <StayCard key={r.id} r={{ ...r, guest_name: guestLabel(user, r.guest_name) }} onPress={() => router.push(`/reservation-form?id=${r.id}`)} />
                  ))
                ) : (
                  <EmptyRow text="Aucun séjour en cours" />
                )}
              </CollapsibleSection>
            )}

            <CollapsibleSection
              title="Départs du jour"
              count={data?.departures_today?.length || 0}
              open={depOpen}
              onToggle={() => setDepOpen((o) => !o)}
            >
              {data?.departures_today?.length ? (
                data.departures_today.map((r) => (
                  <StayCard key={r.id} r={{ ...r, guest_name: guestLabel(user, r.guest_name) }} onPress={() => router.push(`/reservation-form?id=${r.id}`)} />
                ))
              ) : (
                <EmptyRow text="Aucun départ aujourd'hui" />
              )}
            </CollapsibleSection>

            <Pressable
              testID="ai-banner"
              onPress={() => router.push("/(tabs)/assistant")}
              style={styles.aiBanner}
            >
              <View style={styles.aiIcon}>
                <Ionicons name="sparkles" size={20} color={colors.onBrandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.aiTitle}>Assistant IA</Text>
                <Text style={styles.aiSub}>
                  Optimisez vos tarifs et répondez aux voyageurs en un clic
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value, icon, tint, onPress }: any) {
  const Wrapper: any = onPress ? Pressable : View;
  return (
    <Wrapper style={styles.statCard} testID={`stat-${label}`} onPress={onPress}>
      <View style={[styles.statIcon, { backgroundColor: tint + "1A" }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <View style={styles.statLabelRow}>
        <Text style={styles.statLabel}>{label}</Text>
        {onPress && <Ionicons name="chevron-forward" size={14} color={colors.onSurfaceTertiary} />}
      </View>
    </Wrapper>
  );
}

function CollapsibleSection({ title, count, open, onToggle, children }: any) {
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Pressable testID="interventions-toggle" onPress={onToggle} style={styles.collapseHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.collapseRight}>
          {count > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{count}</Text>
            </View>
          )}
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.onSurfaceSecondary} />
        </View>
      </Pressable>
      {open && children}
    </View>
  );
}

function StayCard({ r, onPress }: any) {
  return (
    <Pressable onPress={onPress} style={styles.stayCard} testID={`stay-card-${r.id}`}>
      <View style={styles.stayTop}>
        <View style={styles.stayPropRow}>
          <Ionicons name="business-outline" size={15} color={colors.onSurfaceSecondary} />
          <Text style={styles.stayProp} numberOfLines={1}>{r.property_name}</Text>
        </View>
        <StatusBadge status={r.status} />
      </View>
      <Text style={styles.stayGuest}>{r.guest_name}</Text>
      <View style={styles.stayMetaRow}>
        <View style={styles.stayMeta}>
          <Ionicons name="calendar-outline" size={14} color={colors.onSurfaceTertiary} />
          <Text style={styles.stayMetaText}>
            {dayjs(r.check_in).format("DD MMM")} → {dayjs(r.check_out).format("DD MMM")}
          </Text>
        </View>
        <View style={styles.stayMeta}>
          <Ionicons name="people-outline" size={14} color={colors.onSurfaceTertiary} />
          <Text style={styles.stayMetaText}>{r.guests} voy.</Text>
        </View>
        <View style={styles.otaTag}>
          <Text style={styles.otaText}>{r.platform || "Direct"}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} style={styles.stayChevron} />
    </Pressable>
  );
}

function InterventionCard({ iv, onPress }: any) {
  const t = getInterventionType(iv.kind);
  return (
    <Pressable onPress={onPress} style={[styles.stayCard, { borderLeftWidth: 4, borderLeftColor: t.color }]} testID={`intervention-card-${iv.id}`}>
      <View style={styles.stayTop}>
        <View style={styles.stayPropRow}>
          <Ionicons name="business-outline" size={15} color={colors.onSurfaceSecondary} />
          <Text style={styles.stayProp} numberOfLines={1}>{iv.property_name}</Text>
        </View>
        <View style={[styles.ivBadge, { backgroundColor: t.color + "22" }]}>
          <InterventionIcon kind={iv.kind} size={13} color={t.color} />
          <Text style={[styles.ivBadgeText, { color: t.color }]}>{t.label}</Text>
        </View>
      </View>
      {!!iv.description && <Text style={styles.stayGuest}>{iv.description}</Text>}
      <View style={styles.stayMetaRow}>
        <View style={styles.stayMeta}>
          <Ionicons name="calendar-outline" size={14} color={colors.onSurfaceTertiary} />
          <Text style={styles.stayMetaText}>{dayjs(iv.date).format("ddd DD MMM")}</Text>
        </View>
        {!!iv.intervenant && (
          <View style={styles.stayMeta}>
            <Ionicons name="person-outline" size={14} color={colors.onSurfaceTertiary} />
            <Text style={styles.stayMetaText}>{iv.intervenant}</Text>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} style={styles.stayChevron} />
    </Pressable>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <View style={styles.emptyRow}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  hello: { fontFamily: font.regular, fontSize: fontSize.lg, color: colors.onSurfaceTertiary },
  name: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: 42, height: 42 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBadge: { position: "absolute", top: -2, right: -2, backgroundColor: colors.error, borderRadius: radius.pill, minWidth: 18, height: 18, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.surface },
  iconBadgeText: { fontFamily: font.bold, fontSize: 10, color: "#fff" },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  todayCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  draftBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.brandPrimary + "12",
    borderWidth: 1,
    borderColor: colors.brandPrimary + "40",
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  draftBannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  draftBannerTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  draftBannerSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  cautionCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.warning + "55", borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.lg },
  cautionCardUrgent: { borderColor: colors.error, backgroundColor: colors.error + "0A" },
  depGuestRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  urgentBadge: { backgroundColor: colors.error, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  urgentBadgeText: { fontFamily: font.bold, fontSize: 10, color: "#fff" },
  dueWrap: { alignItems: "flex-end" },
  dueLabel: { fontFamily: font.regular, fontSize: 10, color: colors.onSurfaceTertiary },
  dueValue: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurface },
  cautionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cautionHeadLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 },
  stmtToggle: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  cautionIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.warning, alignItems: "center", justifyContent: "center" },
  cautionTitle: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurface },
  cautionSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 1 },
  depRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingTop: spacing.md, marginTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  depGuest: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  depMeta: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 1 },
  depSendBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  depSendText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onBrandPrimary },
  todayIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  todayTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  todaySub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  statCard: {
    width: "47.5%",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  statValue: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  statLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statLabel: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  sectionTitle: {
    fontFamily: font.semibold,
    fontSize: fontSize.lg,
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  collapseHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  collapseRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  countBadge: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, minWidth: 22, height: 22, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  countBadgeText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onBrandPrimary },
  stayCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  stayTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  stayPropRow: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1, marginRight: spacing.sm },
  stayProp: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, flex: 1 },
  stayGuest: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.sm },
  stayMetaRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexWrap: "wrap" },
  stayMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  stayMetaText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  otaTag: {
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  otaText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  ivBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill },
  ivDot: { width: 7, height: 7, borderRadius: 999 },
  ivBadgeText: { fontFamily: font.semibold, fontSize: 12 },
  stayChevron: { position: "absolute", right: spacing.md, top: spacing.lg },
  emptyRow: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: "center",
  },
  emptyText: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  aiBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceInverse,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  aiIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  aiTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurfaceInverse },
  aiSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: "rgba(255,255,255,0.7)", marginTop: 2 },
});
