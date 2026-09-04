import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextInput, Platform, Linking, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Calendar } from "react-native-calendars";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import dayjs from "dayjs";

import { api, fileUrl } from "@/src/api";
import { getLang } from "@/src/i18n";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const API_BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

function supPriceLabel(s: any): string {
  if (s.calc_model === "percent") return `${s.amount}% ${s.percent_base === "total" ? "du séjour" : "des nuitées"}`;
  const per = s.period === "per_night" ? " / nuit" : " / séjour";
  const basis = s.charge_basis === "per_guest" ? " par invité" : s.charge_basis === "per_room" ? " par chambre" : s.charge_basis === "per_quantity" ? " par unité" : "";
  return `${(Number(s.amount) || 0).toFixed(2)}€${basis}${per}`;
}

export default function PublicPropertyDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { slug, id } = useLocalSearchParams<{ slug: string; id: string }>();
  const [prop, setProp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [ci, setCi] = useState<string>("");
  const [co, setCo] = useState<string>("");
  const [guests, setGuests] = useState(2);
  const [promo, setPromo] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [quoteErr, setQuoteErr] = useState<string>("");
  const [quoting, setQuoting] = useState(false);
  const [booking, setBooking] = useState(false);
  const [gName, setGName] = useState("");
  const [gEmail, setGEmail] = useState("");
  const [gPhone, setGPhone] = useState("");
  const [sups, setSups] = useState<any[]>([]);
  const [selSups, setSelSups] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    try { setProp(await api.get(`/public/site/${slug}/property/${id}`)); } catch {}
    try { setSups(await api.get(`/public/site/${slug}/supplements?property_id=${id}`)); } catch {}
    setLoading(false);
  }, [slug, id]);
  useEffect(() => { load(); }, [load]);

  const unavailable = useMemo(() => new Set(prop?.unavailable_dates || []), [prop]);

  const marked = useMemo(() => {
    const m: any = {};
    (prop?.unavailable_dates || []).forEach((d: string) => { m[d] = { disabled: true, disableTouchEvent: true, marked: true, dotColor: "#E5484D" }; });
    if (ci && co) {
      let cur = dayjs(ci);
      const end = dayjs(co);
      while (cur.isBefore(end) || cur.isSame(end)) {
        const ds = cur.format("YYYY-MM-DD");
        m[ds] = { ...(m[ds] || {}), color: colors.brandPrimary, textColor: "#fff",
          startingDay: ds === ci, endingDay: ds === co };
        cur = cur.add(1, "day");
      }
    } else if (ci) {
      m[ci] = { ...(m[ci] || {}), startingDay: true, endingDay: true, color: colors.brandPrimary, textColor: "#fff" };
    }
    return m;
  }, [prop, ci, co]);

  function onDay(day: any) {
    const d = day.dateString;
    if (unavailable.has(d)) return;
    if (!ci || (ci && co)) { setCi(d); setCo(""); setQuote(null); setQuoteErr(""); return; }
    if (dayjs(d).isAfter(dayjs(ci))) {
      // vérifier qu'aucune date indispo n'est dans l'intervalle
      let cur = dayjs(ci).add(1, "day");
      while (cur.isBefore(dayjs(d)) || cur.isSame(dayjs(d))) {
        if (unavailable.has(cur.format("YYYY-MM-DD"))) { setQuoteErr("La période sélectionnée contient des dates indisponibles."); return; }
        cur = cur.add(1, "day");
      }
      setCo(d);
    } else { setCi(d); setCo(""); }
  }

  const supsPayload = useMemo(
    () => Object.entries(selSups).map(([sid, q]) => ({ id: sid, quantity: q })),
    [selSups]);

  const fetchQuote = useCallback(async () => {
    if (!ci || !co) { setQuote(null); return; }
    setQuoting(true); setQuoteErr("");
    try {
      const q = await api.post(`/public/site/${slug}/quote`, { property_id: id, check_in: ci, check_out: co, guests, promo_code: promo, supplements: supsPayload });
      setQuote(q);
    } catch (e: any) {
      setQuote(null);
      setQuoteErr(e?.message?.includes("indispo") ? "Dates indisponibles." : (e?.detail || e?.message || "Ces dates ne sont pas réservables."));
    }
    setQuoting(false);
  }, [ci, co, guests, promo, slug, id, supsPayload]);
  useEffect(() => { fetchQuote(); }, [ci, co, guests, selSups]);

  function toggleSup(s: any) {
    setSelSups((cur) => {
      const next = { ...cur };
      if (next[s.id]) delete next[s.id];
      else next[s.id] = 1;
      return next;
    });
  }
  function stepSup(sid: string, delta: number) {
    setSelSups((cur) => ({ ...cur, [sid]: Math.max(1, Math.min(50, (cur[sid] || 1) + delta)) }));
  }

  function validGuest() {
    if (!gName.trim()) { Alert.alert("Nom requis", "Indiquez votre nom."); return false; }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(gEmail.trim())) { Alert.alert("Email invalide", "Indiquez un email valide."); return false; }
    return true;
  }

  async function pay() {
    if (!quote || !validGuest()) return;
    setBooking(true);
    const origin = Platform.OS === "web" ? window.location.origin : "https://app";
    try {
      const res = await api.post(`/public/site/${slug}/checkout`, {
        property_id: id, check_in: ci, check_out: co, guests, promo_code: promo,
        supplements: supsPayload, lang: getLang(),
        guest_name: gName, guest_email: gEmail, guest_phone: gPhone, origin_url: origin,
      });
      if (res.url) {
        if (Platform.OS === "web") window.location.assign(res.url);
        else await Linking.openURL(res.url);
      }
    } catch (e: any) { Alert.alert("Erreur", e?.detail || "Paiement indisponible."); }
    setBooking(false);
  }

  async function requestBooking() {
    if (!quote || !validGuest()) return;
    setBooking(true);
    try {
      await api.post(`/public/site/${slug}/request`, {
        property_id: id, check_in: ci, check_out: co, guests, promo_code: promo,
        supplements: supsPayload, lang: getLang(),
        guest_name: gName, guest_email: gEmail, guest_phone: gPhone,
      });
      Alert.alert("Demande envoyée", "Votre demande de réservation a bien été transmise. Vous serez recontacté rapidement.", [
        { text: "OK", onPress: () => router.replace(`/book/${slug}`) },
      ]);
    } catch (e: any) { Alert.alert("Erreur", e?.detail || "Envoi impossible."); }
    setBooking(false);
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>;
  if (!prop) return <View style={styles.center}><Text style={styles.errText}>Logement indisponible.</Text></View>;

  const photos: string[] = prop.photos?.length ? prop.photos.map((p: string) => fileUrl(p)) : (prop.image_url ? [prop.image_url] : []);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40, maxWidth: 800, alignSelf: "center", width: "100%" }} showsVerticalScrollIndicator={false}>
        <View style={[styles.topbar, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable testID="site-back" onPress={() => router.replace(`/book/${slug}`)} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.topTitle} numberOfLines={1}>{prop.name}</Text>
          <View style={{ width: 34 }} />
        </View>

        {photos.length > 0 && (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.gallery}>
            {photos.map((u, i) => <Image key={i} source={{ uri: u }} style={styles.galleryImg} contentFit="cover" />)}
          </ScrollView>
        )}

        <View style={styles.body}>
          <Text style={styles.name}>{prop.name}</Text>
          {!!prop.city && <Text style={styles.city}><Ionicons name="location-outline" size={13} color={colors.onSurfaceTertiary} />{" "}{prop.city}</Text>}
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{prop.capacity} voyageurs</Text><Text style={styles.dot}>·</Text>
            <Text style={styles.meta}>{prop.bedrooms} chambres</Text>
            {prop.surface ? <><Text style={styles.dot}>·</Text><Text style={styles.meta}>{prop.surface} m²</Text></> : null}
          </View>
          {!!prop.description && <Text style={styles.desc}>{prop.description}</Text>}

          {prop.amenities?.length > 0 && (
            <View style={styles.amenities}>
              {prop.amenities.map((a: string) => (
                <View key={a} style={styles.amChip}><Ionicons name="checkmark-circle-outline" size={14} color={colors.brandPrimary} /><Text style={styles.amText}>{a}</Text></View>
              ))}
            </View>
          )}

          <Text style={styles.blockTitle}>Choisissez vos dates</Text>
          <Calendar
            testID="site-calendar"
            markingType="period"
            markedDates={marked}
            minDate={dayjs().format("YYYY-MM-DD")}
            onDayPress={onDay}
            theme={{ todayTextColor: colors.brandPrimary, arrowColor: colors.brandPrimary }}
          />
          <View style={styles.rangeInfo}>
            <Text style={styles.rangeText}>
              {ci ? dayjs(ci).format("DD MMM") : "Arrivée"} → {co ? dayjs(co).format("DD MMM") : "Départ"}
            </Text>
            {(ci || co) && <Pressable onPress={() => { setCi(""); setCo(""); setQuote(null); setQuoteErr(""); }}><Text style={styles.clear}>Effacer</Text></Pressable>}
          </View>

          <View style={styles.guestRow}>
            <Text style={styles.blockTitle}>Voyageurs</Text>
            <View style={styles.stepper}>
              <Pressable testID="site-guest-minus" onPress={() => setGuests((g) => Math.max(1, g - 1))} style={styles.stepBtn}><Ionicons name="remove" size={18} color={colors.onSurface} /></Pressable>
              <Text style={styles.stepVal}>{guests}</Text>
              <Pressable testID="site-guest-plus" onPress={() => setGuests((g) => Math.min(prop.capacity || 20, g + 1))} style={styles.stepBtn}><Ionicons name="add" size={18} color={colors.onSurface} /></Pressable>
            </View>
          </View>

          {sups.length > 0 && (
            <>
              <Text style={styles.blockTitle}>Suppléments</Text>
              {sups.map((s) => {
                const q = selSups[s.id] || 0;
                const on = q > 0;
                return (
                  <View key={s.id} style={[styles.supCard, on && styles.supCardOn]}>
                    {s.photo_path ? (
                      <Image source={{ uri: `${API_BASE}/public/sup-photo/${s.photo_path}` }} style={styles.supImg} contentFit="cover" />
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.supName}>{s.name}</Text>
                      {!!s.description && <Text style={styles.supDesc} numberOfLines={2}>{s.description}</Text>}
                      <Text style={styles.supPrice}>{supPriceLabel(s)}</Text>
                      {on && s.charge_basis === "per_quantity" && (
                        <View style={styles.supStepper}>
                          <Pressable testID={`sup-minus-${s.id}`} onPress={() => stepSup(s.id, -1)} style={styles.supStepBtn}><Ionicons name="remove" size={14} color={colors.onSurface} /></Pressable>
                          <Text style={styles.supStepVal}>{q}</Text>
                          <Pressable testID={`sup-plus-${s.id}`} onPress={() => stepSup(s.id, 1)} style={styles.supStepBtn}><Ionicons name="add" size={14} color={colors.onSurface} /></Pressable>
                        </View>
                      )}
                    </View>
                    <Pressable testID={`sup-toggle-${s.id}`} onPress={() => toggleSup(s)} style={[styles.supToggle, on && styles.supToggleOn]}>
                      <Ionicons name={on ? "checkmark" : "add"} size={18} color={on ? "#fff" : colors.brandPrimary} />
                    </Pressable>
                  </View>
                );
              })}
            </>
          )}

          <View style={styles.promoRow}>
            <TextInput testID="site-promo" value={promo} onChangeText={(t) => setPromo(t.toUpperCase())} placeholder="Code promo" placeholderTextColor={colors.onSurfaceTertiary} autoCapitalize="characters" style={styles.promoInput} />
            <Pressable testID="site-promo-apply" onPress={fetchQuote} style={styles.promoBtn}><Text style={styles.promoBtnText}>Appliquer</Text></Pressable>
          </View>

          {quoteErr ? <Text style={styles.quoteErr}>{quoteErr}</Text> : null}
          {quoting && <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.brandPrimary} />}
          {quote && (
            <View style={styles.quoteCard}>
              <Row label={`${Math.round(quote.nights_total / quote.nights)}€ × ${quote.nights} nuits`} value={`${quote.nights_total}€`} />
              {quote.cleaning_fee > 0 && <Row label="Frais de ménage" value={`${quote.cleaning_fee}€`} />}
              {quote.tourist_tax > 0 && <Row label="Taxe de séjour" value={`${quote.tourist_tax}€`} />}
              {quote.discount > 0 && <Row label={`Remise ${quote.promo_label}`} value={`-${quote.discount}€`} highlight />}
              {(quote.supplements || []).map((s: any) => (
                <Row key={s.id} label={`${s.name}${s.quantity > 1 ? ` × ${s.quantity}` : ""}`} value={`${s.amount_ttc}€`} />
              ))}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{quote.total}€</Text>
              </View>
              {quote.deposit_label ? (
                <View style={styles.depositBox}>
                  <View style={styles.qRow}>
                    <Text style={[styles.qLabel, { color: colors.onSurface, fontFamily: font.semibold }]}>{quote.deposit_label} — à payer maintenant</Text>
                    <Text style={[styles.qValue, { color: colors.brandPrimary, fontFamily: font.bold }]}>{quote.deposit_amount}€</Text>
                  </View>
                  <View style={styles.qRow}>
                    <Text style={styles.qLabel}>Solde à régler plus tard</Text>
                    <Text style={styles.qValue}>{quote.balance_due}€</Text>
                  </View>
                </View>
              ) : null}
            </View>
          )}

          {quote && (
            <>
              <Text style={styles.blockTitle}>Vos coordonnées</Text>
              <TextInput testID="site-name" value={gName} onChangeText={setGName} placeholder="Nom complet" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
              <TextInput testID="site-email" value={gEmail} onChangeText={setGEmail} placeholder="Email" keyboardType="email-address" autoCapitalize="none" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />
              <TextInput testID="site-phone" value={gPhone} onChangeText={setGPhone} placeholder="Téléphone (facultatif)" keyboardType="phone-pad" placeholderTextColor={colors.onSurfaceTertiary} style={styles.input} />

              <Pressable testID="site-pay" onPress={pay} disabled={booking} style={[styles.payBtn, booking && { opacity: 0.6 }]}>
                {booking ? <ActivityIndicator color="#fff" /> : <><Ionicons name="card-outline" size={18} color="#fff" /><Text style={styles.payText}>{quote.deposit_label ? `Payer l'acompte ${quote.deposit_amount}€` : `Réserver et payer ${quote.total}€`}</Text></>}
              </Pressable>
              <Pressable testID="site-request" onPress={requestBooking} disabled={booking} style={styles.reqBtn}>
                <Text style={styles.reqText}>Envoyer une demande (sans paiement)</Text>
              </Pressable>
              <Text style={styles.secure}><Ionicons name="lock-closed" size={11} color={colors.onSurfaceTertiary} /> Paiement sécurisé par Stripe</Text>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.qRow}>
      <Text style={styles.qLabel}>{label}</Text>
      <Text style={[styles.qValue, highlight && { color: "#2FB350" }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  errText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  topTitle: { flex: 1, textAlign: "center", fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  gallery: { height: 240 },
  galleryImg: { width: 800, maxWidth: 800, height: 240 },
  body: { padding: spacing.lg },
  name: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  city: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  meta: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  dot: { color: colors.onSurfaceTertiary },
  desc: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 22, marginTop: spacing.md },
  amenities: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  amChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  amText: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  blockTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.sm },
  rangeInfo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  rangeText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  clear: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.brandPrimary },
  guestRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.xl },
  stepBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  stepVal: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, minWidth: 24, textAlign: "center" },
  promoRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  promoInput: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface, letterSpacing: 1 },
  promoBtn: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, justifyContent: "center" },
  promoBtnText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.brandPrimary },
  quoteErr: { fontFamily: font.medium, fontSize: fontSize.sm, color: "#E5484D", marginTop: spacing.md },
  quoteCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md },
  qRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  qLabel: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  qValue: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  totalLabel: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  totalValue: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.brandPrimary },
  depositBox: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, marginBottom: spacing.sm },
  payBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#17B0A6", borderRadius: radius.lg, paddingVertical: 16, marginTop: spacing.sm },
  payText: { fontFamily: font.bold, fontSize: fontSize.lg, color: "#fff" },
  reqBtn: { alignItems: "center", paddingVertical: 14, marginTop: spacing.sm },
  reqText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.brandPrimary },
  secure: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: 4 },
  supCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  supCardOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "08" },
  supImg: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  supName: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  supDesc: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2, lineHeight: 18 },
  supPrice: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary, marginTop: 4 },
  supStepper: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  supStepBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  supStepVal: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurface, minWidth: 18, textAlign: "center" },
  supToggle: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  supToggleOn: { backgroundColor: colors.brandPrimary },
});
