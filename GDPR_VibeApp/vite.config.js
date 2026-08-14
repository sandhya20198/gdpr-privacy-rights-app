import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  // Vite does not read PORT on its own; honouring it lets a launcher assign a
  // free port instead of colliding on a hardcoded one.
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {},
  build: { outDir: "dist", emptyOutDir: true },
});
