import { create } from "zustand";
import { setSystemTimezone } from "@/api/system";

const STORAGE_KEY = "denarius-settings";

function readTimezone(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.timezone === "string" && parsed.timezone) {
        return parsed.timezone;
      }
    }
  } catch {}
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function writeTimezone(tz: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const existing = raw ? JSON.parse(raw) : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, timezone: tz }));
  } catch {}
}

interface SettingsState {
  timezone: string;
  setTimezone: (tz: string) => void;
  setTimezoneLocal: (tz: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  timezone: readTimezone(),
  // Called by admin to change the app-wide timezone — writes to DB
  setTimezone: (tz) =>
    set(() => {
      writeTimezone(tz);
      void setSystemTimezone(tz);
      return { timezone: tz };
    }),
  // Called on app boot to hydrate from DB without triggering a write-back
  setTimezoneLocal: (tz) =>
    set(() => {
      writeTimezone(tz);
      return { timezone: tz };
    }),
}));
