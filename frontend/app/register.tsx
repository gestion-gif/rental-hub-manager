import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Alert, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { useAuth } from "@/src/context/AuthContext";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { registerOwner } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || password.length < 8) {
      Alert.alert("Oups", "E-mail valide et mot de passe de 8 caractères minimum requis.");
      return;
    }
    setBusy(true);
    try {
      await registerOwner(name.trim(), email.trim(), password);
      router.replace("/");
    } catch (e: any) {
      const msg = e?.message || "Inscription impossible.";
      if (Platform.OS === "web") window.alert(msg); else Alert.alert("Erreur", msg);
    }
    setBusy(false);
  }

  return (
    <View style={styles.container}>
      <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.xl, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Pressable testID="register-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.title}>Créer votre compte</Text>
        <Text style={styles.subtitle}>Essai gratuit de 14 jours — sans carte bancaire.</Text>

        <Text style={styles.label}>Nom / société</Text>
        <TextInput testID="register-name" value={name} onChangeText={setName} placeholder="Ma Conciergerie" placeholderTextColor="rgba(255,255,255,0.4)" style={styles.input} />
        <Text style={styles.label}>E-mail</Text>
        <TextInput testID="register-email" value={email} onChangeText={setEmail} placeholder="vous@exemple.fr" placeholderTextColor="rgba(255,255,255,0.4)" autoCapitalize="none" keyboardType="email-address" style={styles.input} />
        <Text style={styles.label}>Mot de passe (8 caractères min.)</Text>
        <View style={styles.pwRow}>
          <TextInput testID="register-password" value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor="rgba(255,255,255,0.4)" secureTextEntry={!showPw} autoCapitalize="none" style={[styles.input, { flex: 1, marginBottom: 0 }]} />
          <Pressable onPress={() => setShowPw(!showPw)} style={styles.eyeBtn}>
            <Ionicons name={showPw ? "eye-off-outline" : "eye-outline"} size={20} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>

        <Pressable testID="register-submit" onPress={submit} disabled={busy} style={[styles.cta, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color={colors.brand} /> : <Text style={styles.ctaText}>Démarrer l’essai gratuit</Text>}
        </Pressable>
        <Text style={styles.hint}>14 jours d’accès complet. Aucune carte demandée. Vous choisirez une formule plus tard.</Text>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020830" },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  title: { fontFamily: font.bold, fontSize: 28, color: "#fff" },
  subtitle: { fontFamily: font.regular, fontSize: fontSize.base, color: "rgba(255,255,255,0.65)", marginTop: 6, marginBottom: spacing.xl },
  label: { fontFamily: font.medium, fontSize: fontSize.sm, color: "rgba(255,255,255,0.75)", marginBottom: 6 },
  input: { backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 13, fontFamily: font.regular, fontSize: fontSize.base, color: "#fff", marginBottom: spacing.md },
  pwRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.md },
  eyeBtn: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  cta: { backgroundColor: "#fff", borderRadius: radius.lg, paddingVertical: 15, alignItems: "center", marginTop: spacing.md },
  ctaText: { fontFamily: font.bold, fontSize: fontSize.lg, color: "#020830" },
  hint: { fontFamily: font.regular, fontSize: fontSize.sm, color: "rgba(255,255,255,0.5)", textAlign: "center", marginTop: spacing.md, lineHeight: 18 },
});
