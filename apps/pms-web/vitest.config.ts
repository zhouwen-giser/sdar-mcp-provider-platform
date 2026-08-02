import react from "@vitejs/plugin-react";

// Keep this as a plain config object because the locked Vitest and Vite majors expose
// structurally incompatible Plugin types even though Vitest accepts the Vite plugin at runtime.
export default {
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: [],
    restoreMocks: true,
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
};
