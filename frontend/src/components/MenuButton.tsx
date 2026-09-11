import React from "react";
import { Pressable, StyleSheet } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useNavigation } from "expo-router";
import { colors } from "@/src/theme";

export function MenuButton() {
  const nav = useNavigation();
  return (
    <Pressable
      testID="menu-button"
      onPress={() => nav.dispatch({ type: "OPEN_DRAWER" })}
      style={styles.btn}
      hitSlop={8}
    >
      <Ionicons name="menu" size={26} color={colors.onSurface} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -6 },
});
