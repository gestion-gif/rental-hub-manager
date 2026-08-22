export type InterventionType = {
  key: string;
  label: string;
  color: string;
  icon: string; // MaterialCommunityIcons name
};

export const INTERVENTION_TYPES: InterventionType[] = [
  { key: "menage", label: "Ménage", color: "#AF52DE", icon: "broom" },
  { key: "intervention", label: "Intervention", color: "#FFCC00", icon: "hammer-wrench" },
  { key: "remise_cles", label: "Remise de clés", color: "#0A84FF", icon: "key-variant" },
  { key: "caution", label: "Caution", color: "#FF9500", icon: "cash-remove" },
];

export function getInterventionType(key: string): InterventionType {
  return INTERVENTION_TYPES.find((t) => t.key === key) || INTERVENTION_TYPES[1];
}
