export type InterventionType = { key: string; label: string; color: string };

export const INTERVENTION_TYPES: InterventionType[] = [
  { key: "menage", label: "Ménage", color: "#AF52DE" }, // violet
  { key: "intervention", label: "Intervention", color: "#FFCC00" }, // jaune
  { key: "remise_cles", label: "Remise de clés", color: "#0A84FF" }, // bleu
  { key: "caution", label: "Caution", color: "#FF9500" }, // orange
];

export function getInterventionType(key: string): InterventionType {
  return (
    INTERVENTION_TYPES.find((t) => t.key === key) || INTERVENTION_TYPES[1]
  );
}
