import React from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { getInterventionType } from "@/src/interventionTypes";

export function InterventionIcon({ kind, size = 16, color }: { kind: string; size?: number; color?: string }) {
  const t = getInterventionType(kind);
  return <MaterialCommunityIcons name={t.icon as any} size={size} color={color || t.color} />;
}
