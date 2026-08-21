import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { api } from "@/src/api";
import { StatusKey } from "@/src/theme";
import { useAuth } from "@/src/context/AuthContext";

export const DEFAULT_STATUS_COLORS: Record<StatusKey, string> = {
  demande: "#FF9500",
  confirmee: "#34C759",
  arrivee: "#32ADE6",
  depart: "#8E8E93",
  annulee: "#FF3B30",
};

// 10 selectable colors
export const COLOR_PALETTE = [
  "#FF9500", // orange
  "#34C759", // green
  "#32ADE6", // blue
  "#8E8E93", // grey
  "#FF3B30", // red
  "#AF52DE", // purple
  "#FF2D55", // pink
  "#5856D6", // indigo
  "#00C7BE", // teal
  "#FFCC00", // yellow
];

type PrefsState = {
  statusColors: Record<StatusKey, string>;
  setStatusColor: (status: StatusKey, color: string) => void;
  save: (colors: Record<StatusKey, string>) => Promise<void>;
  refresh: () => void;
};

const PreferencesContext = createContext<PrefsState>({} as PrefsState);
export const usePreferences = () => useContext(PreferencesContext);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [statusColors, setStatusColors] =
    useState<Record<StatusKey, string>>(DEFAULT_STATUS_COLORS);

  async function refresh() {
    try {
      const res = await api.get("/preferences");
      if (res?.status_colors) {
        setStatusColors({ ...DEFAULT_STATUS_COLORS, ...res.status_colors });
      }
    } catch {}
  }

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  function setStatusColor(status: StatusKey, color: string) {
    setStatusColors((c) => ({ ...c, [status]: color }));
  }

  async function save(colors: Record<StatusKey, string>) {
    setStatusColors(colors);
    try {
      await api.put("/preferences", { status_colors: colors });
    } catch {}
  }

  return (
    <PreferencesContext.Provider
      value={{ statusColors, setStatusColor, save, refresh }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}
