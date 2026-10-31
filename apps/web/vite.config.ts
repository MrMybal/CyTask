import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:5080", ws: true, changeOrigin: false },
      "/health": "http://127.0.0.1:5080",
      "/plugins/cyannota": {
        target: "http://127.0.0.1:5174",
        changeOrigin: false
      }
    }
  },
  build: {
    target: "es2022",
    sourcemap: mode !== "release"
  }
}));
