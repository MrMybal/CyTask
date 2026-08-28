import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/plugins/cyannota/",
  plugins: [react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true
  },
  build: {
    target: "es2022",
    sourcemap: true
  }
});