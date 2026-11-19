import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@meridian/strategies": fileURLToPath(
        new URL("../../packages/strategies/src/index.ts", import.meta.url)
      ),
      "@meridian/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url)
      ),
      "@meridian/stellar-sdk-helpers": fileURLToPath(
        new URL(
          "../../packages/stellar-sdk-helpers/src/index.ts",
          import.meta.url
        )
      ),
    },
  },
  test: {
    environment: "node",
  },
});
