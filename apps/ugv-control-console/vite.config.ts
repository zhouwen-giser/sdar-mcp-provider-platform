import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [react()],
  root: ".",
  build: { outDir: "dist" },
  server: { proxy: { "/api": "http://127.0.0.1:19102" } },
});
