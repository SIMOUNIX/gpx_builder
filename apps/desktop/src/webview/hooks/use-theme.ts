import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { parseTheme, resolveTheme, THEME_KEY, type Theme } from "../theme";

const os = matchMedia("(prefers-color-scheme: dark)");

const load = () => {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return "system"; // storage blocked: the choice just isn't remembered
  }
};

export const useThemeStore = create<{
  theme: Theme;
  setTheme: (t: Theme) => void;
}>((set) => ({
  theme: load(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // see load()
    }
    set({ theme });
  },
}));

const isDark = () =>
  resolveTheme(useThemeStore.getState().theme, os.matches) === "dark";
const subscribe = (cb: () => void) => {
  os.addEventListener("change", cb);
  const unsub = useThemeStore.subscribe(cb);
  return () => {
    os.removeEventListener("change", cb);
    unsub();
  };
};

/** True when the app is dark: the saved choice, or the OS when it is "system". */
export const useIsDark = () => useSyncExternalStore(subscribe, isDark);

/** Puts the `dark` class on <html>, now and on every change. Call once, before first render. */
export function startTheme() {
  const apply = () =>
    document.documentElement.classList.toggle("dark", isDark());
  apply();
  subscribe(apply);
}
