import { test, expect } from "./fixtures.js";
import { sheet } from "../fixture.mjs";

test("mobile shows one page, keeps navigation across refresh, and safely deletes and restores nights and boards", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let { state } = await (await page.request.get("/api/state")).json();
  const created = await page.request.post("/api/terms", {
    headers: { Origin: "http://localhost:8790" },
    data: { code: "HT41", rows: [sheet[0], sheet[1]], version: state.version },
  });
  expect(created.status()).toBe(201);
  ({ state } = await created.json());
  const term = state.terms.at(-1),
    night = term.nights[0];
  const moved = await page.request.post("/api/action", {
    headers: { Origin: "http://localhost:8790" },
    data: {
      type: "move",
      termId: term.id,
      instanceId: term.instances[0].id,
      nightId: night.id,
      slot: 0,
      version: state.version,
    },
  });
  expect(moved.status()).toBe(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#term-select").selectOption(term.id);
  await expect(page.locator(".column:visible")).toHaveCount(1);
  await expect(page.locator(".unassigned")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Previous night", exact: true }),
  ).toBeDisabled();
  for (let i = 0; i < term.nights.length; i++) {
    await page.getByRole("button", { name: "Next night", exact: true }).click();
    await expect(page.locator(".column:visible")).toHaveAttribute(
      "data-night-column",
      term.nights[i].id,
    );
    const geometry = await page.locator(".board").evaluate((board) => ({
      fits: board.scrollWidth <= board.clientWidth,
      pageFits: document.documentElement.scrollWidth <= innerWidth,
      fraction: board.getBoundingClientRect().height / innerHeight,
    }));
    expect(geometry.fits).toBe(true);
    expect(geometry.pageFits).toBe(true);
    expect(geometry.fraction).toBeGreaterThanOrEqual(0.8);
  }
  await expect(
    page.getByRole("button", { name: "Next night", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.locator(".column:visible")).toHaveAttribute(
    "data-night-column",
    term.nights.at(-1).id,
  );
  for (let i = 1; i < term.nights.length; i++)
    await page
      .getByRole("button", { name: "Previous night", exact: true })
      .click();
  await page.getByRole("button", { name: "Compact mode", exact: true }).click();
  await expect(page.locator(".column:visible")).toHaveCount(1);
  await page.screenshot({ path: "test-results/mobile-night-navigation.png" });
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await page.getByRole("button", { name: "Delete night", exact: true }).click();
  await expect(page.locator("#dialog")).toContainText(
    "1 cards will return to Unassigned",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await (await page.request.get("/api/state")).json()).state.terms.find(
      (t) => t.id === term.id,
    ).nights.length,
  ).toBe(term.nights.length);
  await page.getByRole("button", { name: "Configure", exact: true }).click();
  await page.getByRole("button", { name: "Delete night", exact: true }).click();
  await page.getByRole("button", { name: "Delete night", exact: true }).click();
  await expect(page.locator(`[data-night-column="${night.id}"]`)).toHaveCount(
    0,
  );
  await expect(page.locator(".column:visible")).toHaveCount(1);
  await expect(page.locator(".unassigned .dj-card")).toHaveCount(1);
  let history = await (await page.request.get("/api/admin/history")).json();
  expect(history.snapshots[0].name).toContain("Before deleting HT41 night");
  await page
    .getByRole("button", {
      name: "Account menu for Browser administrator",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Delete current board", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete board", exact: true }).click();
  await expect(
    page.locator(`#term-select option[value="${term.id}"]`),
  ).toHaveCount(0);
  history = await (await page.request.get("/api/admin/history")).json();
  expect(history.snapshots[0].name).toBe("Before deleting Open Decks HT41");
  ({ state } = await (await page.request.get("/api/state")).json());
  const restored = await page.request.post("/api/admin/restore", {
    headers: { Origin: "http://localhost:8790" },
    data: { id: history.snapshots[1].id, version: state.version },
  });
  expect(restored.status()).toBe(200);
  await page.reload();
  await page.locator("#term-select").selectOption(term.id);
  await expect(page.locator(".column:visible")).toHaveCount(1);
  await page.getByRole("button", { name: "Next night", exact: true }).click();
  await expect(page.locator(".column:visible .dj-card")).toHaveCount(1);
  await page.setViewportSize({ width: 1540, height: 900 });
  await expect(page.locator(".column:visible")).toHaveCount(
    term.nights.length + 1,
  );
  await expect(
    page.getByRole("button", { name: "Next night", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
