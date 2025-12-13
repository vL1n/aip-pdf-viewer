import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        // 仅替换 `import "pdfjs-dist"`（不影响 `pdfjs-dist/build/...`）
        find: /^pdfjs-dist$/,
        replacement: fileURLToPath(new URL("./src/pdfjs-dist-shim.ts", import.meta.url))
      }
    ]
  },
  server: {
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET || "http://localhost:13001",
        changeOrigin: true
      }
    }
  }
});


