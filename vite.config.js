import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" => chemins relatifs, fonctionne aussi bien en local que sous
// un sous-dossier GitHub Pages (https://user.github.io/ardoise/).
export default defineConfig({
  plugins: [react()],
  base: "/ardoise/",
});
