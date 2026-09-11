import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import MaterialCommunityIcons from "@react-native-vector-icons/material-design-icons";
import Ionicons from "@react-native-vector-icons/ionicons";

const AIRBNB_LOGO = require("../../assets/images/airbnb.png");

const CONFIG: Record<string, { type: "icon" | "letter"; value: string; bg: string; set?: "mci" | "ion" }> = {
  "Booking.com": { type: "letter", value: "B", bg: "#003580" },
  "Vrbo": { type: "letter", value: "V", bg: "#1668E3" },
  "Direct": { type: "icon", value: "person", bg: "#34C759", set: "ion" },
  "Site web": { type: "icon", value: "globe-outline", bg: "#5E5CE6", set: "ion" },
};

export function PlatformLogo({ platform, size = 18 }: { platform?: string; size?: number }) {
  if (platform === "Airbnb") {
    return (
      <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2, backgroundColor: "#FF5A5F", overflow: "hidden" }]}>
        <Image source={AIRBNB_LOGO} style={{ width: size, height: size }} contentFit="cover" />
      </View>
    );
  }
  const c = CONFIG[platform || ""] || { type: "icon", value: "ellipse", bg: "#8E8E93", set: "ion" };
  const inner = Math.round(size * 0.62);
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg }]}>
      {c.type === "letter" ? (
        <Text style={[styles.letter, { fontSize: inner }]}>{c.value}</Text>
      ) : c.set === "mci" ? (
        <MaterialCommunityIcons name={c.value as any} size={inner} color="#fff" />
      ) : (
        <Ionicons name={c.value as any} size={inner} color="#fff" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  letter: { color: "#fff", fontWeight: "800" },
});
