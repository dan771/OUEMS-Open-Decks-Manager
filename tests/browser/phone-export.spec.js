import { test, expect } from "./fixtures.js";
import { sheet } from "../fixture.mjs";

for (const width of [390, 1280]) {
  test(`copy night phone numbers and manual fallback at ${width}px`, async ({
    page,
  }) => {
    let { state } = await (await page.request.get("/api/state")).json();
    const rows = [
      [...sheet[0], "Mobile phone number"],
      ...["07123 456789", "+33 6 12 34 56 78", "", "07999 111222"].map(
        (phone, index) => {
          const row = [...sheet[1], phone];
          row[0] = `2026-09-28 12:0${index}:00`;
          row[2] = `Phone DJ ${index}`;
          return row;
        },
      ),
    ];
    const created = await page.request.post("/api/terms", {
      headers: { Origin: "http://localhost:8790" },
      data: {
        code: width === 390 ? "MT64" : "MT65",
        rows,
        version: state.version,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    ({ state } = await created.json());
    const term = state.terms.at(-1);
    const night = term.nights[0];
    for (let index = 0; index < 3; index++) {
      const moved = await page.request.post("/api/action", {
        headers: { Origin: "http://localhost:8790" },
        data: {
          type: "move",
          termId: term.id,
          instanceId: term.instances[index].id,
          nightId: night.id,
          period: index === 0 ? "early" : "late",
          version: state.version,
        },
      });
      expect(moved.status()).toBe(200);
      ({ state } = await moved.json());
    }
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.copiedPhones = text;
          },
        },
      });
    });
    await page.setViewportSize({ width, height: 768 });
    await page.goto("/");
    await page.locator("#term-select").selectOption(term.id);
    if (width === 390)
      await page
        .getByRole("button", { name: "Next night", exact: true })
        .click();
    // Export ignores board filters.
    await page.locator("#search").fill("Phone DJ 0");
    const copy = page.locator(
      `[data-night-column="${night.id}"] [data-action="copy-phones"]`,
    );
    await expect(copy).toBeVisible();
    await copy.click();
    await expect
      .poll(() => page.evaluate(() => window.copiedPhones))
      .toBe("07123 456789\n+33 6 12 34 56 78");
    await expect(page.locator("#toast")).toContainText(
      "1 DJ without a phone number",
    );
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error("Clipboard blocked");
      };
    });
    await copy.click();
    await expect(page.locator("#phone-export")).toHaveValue(
      "07123 456789\n+33 6 12 34 56 78",
    );
    await expect(page.locator("#phone-export")).toBeFocused();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.screenshot({ path: `test-results/phone-export-${width}.png` });
  });
}
