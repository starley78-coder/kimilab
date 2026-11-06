import { useSyncExternalStore } from "react";

import {
  DEFAULT_REASONING_EFFORT,
  isReasoningEffort,
  type ReasoningEffort,
} from "@/lib/kimi/config";
import {
  readThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "@/lib/theme";

const EFFORT_KEY = "kimi-lab-reasoning-effort";
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === EFFORT_KEY || e.key === "kimi-lab-theme") listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function readReasoningEffort(): ReasoningEffort {
  try {
    const v = localStorage.getItem(EFFORT_KEY);
    return isReasoningEffort(v) ? v : DEFAULT_REASONING_EFFORT;
  } catch {
    return DEFAULT_REASONING_EFFORT;
  }
}

export function setReasoningEffort(value: ReasoningEffort) {
  try {
    localStorage.setItem(EFFORT_KEY, value);
  } catch {
    // storage unavailable
  }
  emit();
}

export function useReasoningEffort(): [ReasoningEffort, (v: ReasoningEffort) => void] {
  const value = useSyncExternalStore(subscribe, readReasoningEffort, () => DEFAULT_REASONING_EFFORT);
  return [value, setReasoningEffort];
}

export function setThemePreference(value: ThemePreference) {
  saveThemePreference(value);
  emit();
}

export function useThemePreference(): [ThemePreference, (v: ThemePreference) => void] {
  const value = useSyncExternalStore(subscribe, readThemePreference, () => "system" as const);
  return [value, setThemePreference];
}
