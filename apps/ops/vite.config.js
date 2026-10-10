import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const shared = fileURLToPath(new URL("../../packages/shared", import.meta.url));

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
  resolve: { alias: { "@nova/shared": shared } },
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  build: { chunkSizeWarningLimit: 700 },
});
