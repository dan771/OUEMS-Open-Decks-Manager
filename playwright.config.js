import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:8790",
    viewport: { width: 1540, height: 1000 },
    trace: "retain-on-failure",
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
  },
  webServer: {
    command: `"${process.execPath}" server/dev.mjs`,
    url: "http://localhost:8790/api/auth/status",
    env: { PORT: "8790", LOCAL_STATE_NAME: `browser-${Date.now()}.json` },
    reuseExistingServer: false,
    timeout: 15000,
  },
});
