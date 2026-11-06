import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { SettingsDialog } from "@/components/chat/settings-dialog";

interface SettingsContextValue {
  openSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSettings = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ openSettings }), [openSettings]);
  return (
    <SettingsContext.Provider value={value}>
      {children}
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
