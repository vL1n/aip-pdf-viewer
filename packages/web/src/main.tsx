import React, { useMemo } from "react";
import ReactDOM from "react-dom/client";

import { App as AntdApp, ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";

import { App } from "./App";
import { useThemeMode } from "./hooks/useThemeMode";
import "antd/dist/reset.css";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";
import "./styles.css";

function Root() {
  const { mode: themeMode, setMode: setThemeMode, isDark } = useThemeMode();
  const algorithm = useMemo(() => (isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm), [isDark]);

  return (
    <ConfigProvider locale={zhCN} theme={{ algorithm }}>
      <AntdApp>
        <App themeMode={themeMode} onThemeModeChange={setThemeMode} />
      </AntdApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);


