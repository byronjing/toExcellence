import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          material: [
            "@material/web/dialog/dialog.js",
            "@material/web/menu/menu.js",
            "@material/web/textfield/outlined-text-field.js",
            "@material/web/button/filled-button.js",
          ],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
});
