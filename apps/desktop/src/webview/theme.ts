export const THEMES = ["light", "system", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_KEY = "theme";

/** A saved value back to a theme; anything unknown (or missing) is "system". */
export const parseTheme = (raw: string | null): Theme =>
  THEMES.find((t) => t === raw) ?? "system";

export const resolveTheme = (theme: Theme, systemDark: boolean) =>
  theme === "system" ? (systemDark ? "dark" : "light") : theme;
