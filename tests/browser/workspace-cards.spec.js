import { test, expect } from "./fixtures.js";
import { sheet } from "../fixture.mjs";

async function createBoard(page, code, count = 1) {
  const { state } = await (await page.request.get("/api/state")).json();
  const rows = [
    sheet[0],
    ...Array.from({ length: count }, (_, index) => {
      const row = [...sheet[1]];
      row[0] = `2026-09-28 12:${String(index).padStart(2, "0")}:00`;
      row[2] = `Board DJ ${index + 1}`;
      return row;
    }),
  ];
  const response = await page.request.post("/api/terms", {
    headers: { Origin: "http://localhost:8790" },
    data: { code, rows, version: state.version },
  });
  expect(response.status()).toBe(201);
  const next = await response.json();
  return {
    state: next.state,
    term: next.state.terms.find((t) => t.code === code),
  };
}

async function boardView(page) {
  return page.evaluate(() => ({
    left: document.querySelector(".board").scrollLeft,
    columns: [
      ...document.querySelectorAll(".unassigned > .cards, .column-content"),
    ].map((el) => el.scrollTop),
    windowY: window.scrollY,
  }));
}

for (const width of [390, 1280]) {
  test(`card confirmations and edits preserve night scroll at ${width}px`, async ({
    page,
  }) => {
    let { state, term } = await createBoard(
      page,
      width === 390 ? "MT41" : "MT42",
      24,
    );
    const nightId = term.nights[0].id;
    for (const instance of term.instances) {
      const response = await page.request.post("/api/action", {
        headers: { Origin: "http://localhost:8790" },
        data: {
          type: "move",
          termId: term.id,
          instanceId: instance.id,
          nightId,
          period: "early",
          version: state.version,
        },
      });
      expect(response.status()).toBe(200);
      ({ state } = await response.json());
    }
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/");
    await page.locator("#term-select").selectOption(term.id);
    if (width === 390)
      await page
        .getByRole("button", { name: "Next night", exact: true })
        .click();
    const night = page.locator(`[data-night-column="${nightId}"]`);
    const content = night.locator(".column-content");
    for (const compact of [false, true]) {
      if (compact)
        await page
          .getByRole("button", { name: "Compact mode", exact: true })
          .click();
      await content.evaluate((element) => {
        element.scrollTop = 300;
      });
      const before = await content.evaluate((element) => element.scrollTop);
      expect(before).toBeGreaterThan(200);
      const instanceId = await content.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return [...element.querySelectorAll(".dj-card")].find((card) => {
          const rect = card.getBoundingClientRect();
          return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
        }).dataset.instance;
      });
      const card = night.locator(`[data-instance="${instanceId}"]`);
      const confirm = card.locator(".card-confirmation");
      const wasConfirmed = await confirm.getAttribute("aria-pressed");
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/action") &&
          response.request().postDataJSON()?.type === "confirm",
      );
      await confirm.click();
      expect((await saved).status()).toBe(200);
      await expect(confirm).toHaveAttribute(
        "aria-pressed",
        wasConfirmed === "true" ? "false" : "true",
      );
      await expect
        .poll(() => content.evaluate((element) => element.scrollTop))
        .toBe(before);
      await expect(night).toBeVisible();

      await card.locator(".card-open").click();
      const beforeEdit = await content.evaluate((element) => element.scrollTop);
      await page
        .locator('#edit-form [name="genres"]')
        .fill(compact ? "Compact scroll edit" : "Scroll edit");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await expect(page.locator("#dialog")).not.toBeVisible();
      await expect(card).toContainText(
        compact ? "Compact scroll edit" : "Scroll edit",
      );
      await expect
        .poll(() => content.evaluate((element) => element.scrollTop))
        .toBe(beforeEdit);
    }
  });
}

test("drag and dialog moves preserve board, column and page scroll positions", async ({
  page,
}) => {
  let { state, term } = await createBoard(page, "MT30", 36);
  for (let index = 0; index < 20; index++) {
    const response = await page.request.post("/api/action", {
      headers: { Origin: "http://localhost:8790" },
      data: {
        type: "move",
        termId: term.id,
        instanceId: term.instances[index].id,
        nightId: term.nights[index < 10 ? 0 : 1].id,
        period: "early",
        version: state.version,
      },
    });
    expect(response.status()).toBe(200);
    ({ state } = await response.json());
  }
  await page.setViewportSize({ width: 1280, height: 768 });
  await page.goto("/");
  await page.locator("#term-select").selectOption(term.id);
  await page.evaluate(() => {
    document.querySelector(".board").scrollLeft = 100;
    document.querySelector(".unassigned > .cards").scrollTop = 260;
    const columns = [...document.querySelectorAll(".column-content")];
    columns[0].scrollTop = 230;
    columns[1].scrollTop = 190;
  });
  const before = await boardView(page);
  expect(before.left).toBeGreaterThan(0);
  expect(before.columns.slice(0, 3).every((top) => top > 0)).toBe(true);
  expect(before.windowY).toBe(0);
  const sourceId = await page.locator(".unassigned > .cards").evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    return [...el.querySelectorAll(".dj-card")].find((card) => {
      const rect = card.getBoundingClientRect();
      return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    }).dataset.instance;
  });
  const destination = page.locator(
    `[data-night-column="${term.nights[0].id}"]`,
  );
  // Native drag automation can scroll the source into view before dropping.
  // Preserve the user's position at the drop, including any drag scrolling.
  await page.evaluate(() => {
    document.addEventListener(
      "drop",
      () => {
        window.viewAtDrop = {
          left: document.querySelector(".board").scrollLeft,
          columns: [
            ...document.querySelectorAll(
              ".unassigned > .cards, .column-content",
            ),
          ].map((el) => el.scrollTop),
          windowY: window.scrollY,
        };
      },
      { once: true, capture: true },
    );
  });
  await page
    .locator(`[data-instance="${sourceId}"]`)
    .dragTo(destination.locator(".column-header"));
  await expect(
    destination.locator(`[data-instance="${sourceId}"]`),
  ).toHaveCount(1);
  const atDrop = await page.evaluate(() => window.viewAtDrop);
  expect(atDrop.left).toBeGreaterThan(0);
  expect(await boardView(page)).toEqual(atDrop);

  // The Add picker is also the move control used on touch devices.
  await destination
    .getByRole("button", { name: "Add a DJ to this night" })
    .click();
  const beforePickerMove = await boardView(page);
  await page.locator("#picker-search").fill("Board DJ 36");
  await page.locator("#picker-period").selectOption("late");
  await page.locator(".picker-item").click();
  await expect(
    destination.locator('.period-list[data-period="late"]'),
  ).toContainText("Board DJ 36");
  expect(await boardView(page)).toEqual(beforePickerMove);

  // Moving through the card editor must not scroll to the header on closing.
  await page
    .getByRole("button", { name: "Edit Board DJ 36", exact: true })
    .click();
  const beforeDialogMove = await boardView(page);
  await page.getByText("Move this card", { exact: true }).click();
  await page
    .locator("#move-destination")
    .selectOption(`${term.nights[1].id}:late`);
  await page.getByRole("button", { name: "Move card", exact: true }).click();
  await expect(
    page.locator(
      `[data-night-column="${term.nights[1].id}"] .period-list[data-period="late"]`,
    ),
  ).toContainText("Board DJ 36");
  const limits = await page
    .locator(".unassigned > .cards, .column-content")
    .evaluateAll((els) => els.map((el) => el.scrollHeight - el.clientHeight));
  expect(await boardView(page)).toEqual({
    ...beforeDialogMove,
    columns: beforeDialogMove.columns.map((top, index) =>
      Math.min(top, limits[index]),
    ),
  });
});

test("availability dots show each night's Early and Late status in existing card space", async ({
  page,
}) => {
  const { term } = await createBoard(page, "MT31");
  await page.goto("/");
  await page.locator("#term-select").selectOption(term.id);
  const dots = page.locator(".card-availability .availability-dot");
  await expect(dots).toHaveCount(8);
  const statuses = () =>
    dots.evaluateAll((els) => els.map((el) => el.classList[1]));
  expect(await statuses()).toEqual([
    "available",
    "outside",
    "available",
    "available",
    "unavailable",
    "unavailable",
    "unavailable",
    "unavailable",
  ]);
  await expect(dots.nth(0)).toHaveAttribute(
    "title",
    "16 Oct · Early: Available",
  );
  await expect(dots.nth(1)).toHaveAttribute(
    "title",
    "16 Oct · Late: Outside preferred half",
  );
  await expect(page.locator(".card-availability")).toHaveAttribute(
    "aria-label",
    /16 Oct · Early: Available/,
  );
  const gridFits = () =>
    page.locator(".dj-card").evaluate((el) => {
      const card = el.getBoundingClientRect();
      const grid = el
        .querySelector(".card-availability")
        .getBoundingClientRect();
      const dots = [...el.querySelectorAll(".availability-dot")].map((dot) =>
        dot.getBoundingClientRect(),
      );
      return {
        height: card.height,
        rows: new Set(dots.map((dot) => dot.top)).size,
        columns: new Set(dots.map((dot) => dot.left)).size,
        fits:
          grid.top >= card.top &&
          grid.bottom <= card.bottom &&
          grid.right <= card.right,
      };
    });
  expect(await gridFits()).toMatchObject({ rows: 2, columns: 4, fits: true });
  await page.screenshot({ path: "test-results/availability-dots.png" });
  await page.getByRole("button", { name: "Compact mode", exact: true }).click();
  expect(await gridFits()).toEqual({
    height: 32,
    rows: 2,
    columns: 4,
    fits: true,
  });
  await page.screenshot({ path: "test-results/availability-dots-compact.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await gridFits()).toEqual({
    height: 32,
    rows: 2,
    columns: 4,
    fits: true,
  });
  await page
    .getByRole("button", { name: "Edit Board DJ 1", exact: true })
    .click();
  await page
    .getByLabel("Availability for 12 Nov", { exact: true })
    .selectOption("unknown");
  await page
    .getByLabel("Timing preference for 16 Oct", { exact: true })
    .fill("Late");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect
    .poll(statuses)
    .toEqual([
      "outside",
      "available",
      "available",
      "available",
      "unknown",
      "unknown",
      "unavailable",
      "unavailable",
    ]);
});
