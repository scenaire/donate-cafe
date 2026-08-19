import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" → project-root mapping so tests can import (and
    // mock) modules that use the alias, e.g. "@/lib/supabase".
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: false,
  },
});
