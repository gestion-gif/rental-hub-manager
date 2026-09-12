import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Ionicons from "@react-native-vector-icons/ionicons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { PrimaryButton, Field } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const notify = (title: string, msg: string) => {
  if (Platform.OS === "web") window.alert(`${title}\n${msg}`);
  else Alert.alert(title, msg);
};

export default function ForgotPassword() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendCode() {
    if (!email.trim().includes("@")) {
      notify("Email invalide", "Saisissez l'adresse email de votre compte.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setStep(2);
    } catch (e: any) {
      notify("Erreur", String(e?.message || "Réessayez dans un instant."));
    }
    setLoading(false);
  }

  async function resetPassword() {
    if (code.trim().length !== 6) {
      notify("Code invalide", "Saisissez le code à 6 chiffres reçu par email.");
      return;
    }
    if (password.length < 8) {
      notify("Mot de passe trop court", "8 caractères minimum.");
      return;
    }
    if (password !== confirm) {
      notify("Erreur", "Les deux mots de passe ne correspondent pas.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { email: email.trim(), code: code.trim(), password });
      notify("Mot de passe changé", "Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.");
      router.replace("/login");
    } catch (e: any) {
      notify("Échec", String(e?.message || "Code invalide ou expiré"));
    }
    setLoading(false);
  }

  return (
    <View style={styles.container}>
      <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.xl, paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + 40 }} bottomOffset={24}>
        <Pressable testID="forgot-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>

        <Text style={styles.title}>Mot de passe oublié</Text>

        {step === 1 ? (
          <>
            <Text style={styles.sub}>
              Saisissez l'email de votre compte. Si un compte existe, vous recevrez un code à 6 chiffres (valable 15 minutes).
            </Text>
            <Field
              label="Email"
              testID="forgot-email"
              value={email}
              onChangeText={setEmail}
              placeholder="vous@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <PrimaryButton testID="forgot-send" label="Recevoir le code" onPress={sendCode} loading={loading} />
          </>
        ) : (
          <>
            <Text style={styles.sub}>
              {`Un code a été envoyé à ${email.trim()}.`} Vérifiez aussi vos spams.
            </Text>
            <Field
              label="Code à 6 chiffres"
              testID="forgot-code"
              value={code}
              onChangeText={(v: string) => setCode(v.replace(/[^0-9]/g, "").slice(0, 6))}
              placeholder="000000"
              keyboardType="number-pad"
            />
            <Field
              label="Nouveau mot de passe"
              testID="forgot-password-new"
              value={password}
              onChangeText={setPassword}
              placeholder="8 caractères minimum"
              secureTextEntry
            />
            <Field
              label="Confirmez le mot de passe"
              testID="forgot-password-confirm"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Le même mot de passe"
              secureTextEntry
            />
            <PrimaryButton testID="forgot-reset" label="Changer le mot de passe" onPress={resetPassword} loading={loading} />
            <Pressable testID="forgot-resend" onPress={sendCode} style={styles.linkBtn}>
              <Text style={styles.linkText}>Renvoyer un code</Text>
            </Pressable>
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  title: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface, marginBottom: spacing.sm },
  sub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 21, marginBottom: spacing.lg },
  linkBtn: { alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md },
  linkText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, textDecorationLine: "underline" },
});
