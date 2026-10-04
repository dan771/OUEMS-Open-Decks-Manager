import { test as base, expect } from "@playwright/test";
let administratorCookies = [];
export const test = base.extend({
  page: async ({ page, context }, use) => {
    // Browser contexts keep their own storage and UI state. Reuse only the
    // administrator session so a growing suite does not trip login throttles.
    await context.addCookies(administratorCookies);
    const status = await (await page.request.get("/api/auth/status")).json();
    let csrf;
    const existing = await page.request.get("/api/state");
    if (existing.ok()) {
      ({ csrf } = await existing.json());
    } else if (!status.initialized) {
      await page.goto("/login");
      await expect(
        page.getByRole("heading", {
          name: "Create the administrator account",
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByLabel("Your name", { exact: true })
        .fill("Browser administrator");
      await page.getByLabel("Username", { exact: true }).fill("browser-admin");
      await page
        .getByLabel("Password", { exact: true })
        .fill("Browser test password 2026");
      await page.screenshot({ path: "test-results/administrator-setup.png" });
      await page
        .getByRole("button", { name: "Create account & sign in", exact: true })
        .click();
      await expect(page).toHaveURL("http://localhost:8790/");
      await expect(page.locator("#term-select")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Open Decks." }),
      ).toBeVisible();
      ({ csrf } = await (await page.request.get("/api/state")).json());
    } else {
      const signed = await page.request.post("/api/auth/login", {
        headers: { Origin: "http://localhost:8790" },
        data: {
          username: "browser-admin",
          name: "Browser administrator",
          password: "Browser test password 2026",
        },
      });
      expect(signed.status()).toBe(200);
      ({ csrf } = await signed.json());
    }
    administratorCookies = await context.cookies("http://localhost:8790");
    await context.setExtraHTTPHeaders({ "X-CSRF-Token": csrf });
    await use(page);
  },
});
export { expect };
