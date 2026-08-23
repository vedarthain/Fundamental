import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Next's `@/…` path alias (tsconfig paths) for tests.
      "@": src,
      // `server-only` is a Next-provided marker with no real node module; the
      // server libs under test import it, so point it at an empty stub.
      "server-only": fileURLToPath(
        new URL("./src/lib/__tests__/fixtures/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
