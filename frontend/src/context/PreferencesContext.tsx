import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useMemo,
} from "react";
import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";

export type StatusDef = { key: string; label: string; color: string };

export const DEFAULT_STATUSES: StatusDef[] = [
  { key: "demande", label: "Demande", color: "#FF9500" },
  { key: "confirmee", label: "Confirmée", color: "#34C759" },
  { key: "arrivee", label: "Arrivée", color: "#32ADE6" },
  { key: "depart", label: "Départ", color: "#8E8E93" },
  { key: "annulee", label: "Annulée", color: "#FF3B30" },
];

export const CORE_STATUS_KEYS = DEFAULT_STATUSES.map((s) => s.key);

// Taux de commission par défaut (%) par plateforme — modifiables dans Paramètres
export const DEFAULT_COMMISSION_RATES: Record<string, number> = {
  "Airbnb": 15.5,
  "Booking.com": 15,
  "Vrbo": 8,
  "Direct": 0,
  "Site web": 0,
};

// Selectable colors palette
export const COLOR_PALETTE = [
  "#FF9500", "#FF6B00", "#FFCC00", "#FFD60A", "#34C759", "#30D158",
  "#00C7BE", "#63E6BE", "#32ADE6", "#0A84FF", "#0055FF", "#5856D6",
  "#5E5CE6", "#AF52DE", "#BF5AF2", "#FF2D55", "#FF375F", "#FF3B30",
  "#D70015", "#A2845E", "#AC8E68", "#8E8E93", "#48484A", "#1C1C1E",
];

type PrefsState = {
  statuses: StatusDef[];
  statusColors: Record<string, string>;
  commissionRates: Record<string, number>;
  getStatus: (key: string) => StatusDef;
  save: (statuses: StatusDef[]) => Promise<void>;
  saveCommissionRates: (rates: Record<string, number>) => Promise<void>;
  refresh: () => void;
};

const PreferencesContext = createContext<PrefsState>({} as PrefsState);
export const usePreferences = () => useContext(PreferencesContext);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [statuses, setStatuses] = useState<StatusDef[]>(DEFAULT_STATUSES);
  const [commissionRates, setCommissionRates] = useState<Record<string, number>>(DEFAULT_COMMISSION_RATES);

  async function refresh() {
    try {
      const res = await api.get("/preferences");
      if (res?.statuses && Array.isArray(res.statuses) && res.statuses.length) {
        setStatuses(res.statuses);
      }
      if (res?.commission_rates) {
        setCommissionRates({ ...DEFAULT_COMMISSION_RATES, ...res.commission_rates });
      }
    } catch {}
  }

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  const statusColors = useMemo(() => {
    const m: Record<string, string> = {};
    statuses.forEach((s) => (m[s.key] = s.color));
    return m;
  }, [statuses]);

  const statusMap = useMemo(() => {
    const m: Record<string, StatusDef> = {};
    statuses.forEach((s) => (m[s.key] = s));
    return m;
  }, [statuses]);

  function getStatus(key: string): StatusDef {
    return statusMap[key] || { key, label: key, color: "#8E8E93" };
  }

  async function save(next: StatusDef[]) {
    setStatuses(next);
    try {
      await api.put("/preferences", { statuses: next });
    } catch {}
  }

  async function saveCommissionRates(rates: Record<string, number>) {
    const merged = { ...DEFAULT_COMMISSION_RATES, ...rates };
    setCommissionRates(merged);
    try {
      await api.put("/preferences", { commission_rates: merged });
    } catch {}
  }

  return (
    <PreferencesContext.Provider
      value={{ statuses, statusColors, commissionRates, getStatus, save, saveCommissionRates, refresh }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}
