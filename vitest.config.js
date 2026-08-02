import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    // The private web app uses Node's built-in test runner in web/test/.
    // Keep Vitest scoped to the core/runtime suite so it does not execute the
    // same files under an incompatible runner.
    include: ["tests/**/*.test.js"],
  },
});
