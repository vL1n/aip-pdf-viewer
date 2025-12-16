import { useEffect, useMemo, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "naip.themeMode";

function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (raw === "light" || raw === "dark" || raw === "system") return raw;
    } catch {
      // ignore
    }
    return "system";
  });

  const [systemDark, setSystemDark] = useState<boolean>(() => getSystemPrefersDark());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    onChange();
    // Safari < 14 fallback
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  const isDark = useMemo(() => {
    if (mode === "dark") return true;
    if (mode === "light") return false;
    return systemDark;
  }, [mode, systemDark]);

  useEffect(() => {
    // 让浏览器表单/滚动条等按主题渲染
    if (typeof document !== "undefined") {
      document.documentElement.style.colorScheme = isDark ? "dark" : "light";
      document.documentElement.dataset.theme = isDark ? "dark" : "light";
    }
  }, [isDark]);

  return { mode, setMode, isDark } as const;
}


