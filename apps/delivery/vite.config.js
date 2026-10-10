import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const shared = fileURLToPath(new URL("../../packages/shared", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@nova/shared": shared } },
  server: { fs: { allow: [".", shared, "../.."] } },
  base: "./",
  build: { outDir: "dist", sourcemap: false },
});
