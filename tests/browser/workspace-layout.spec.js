import { test, expect } from "./fixtures.js";
import { sheet } from "../fixture.mjs";

const accountName = "Account menu for Browser administrator";

test("college icons and per-appearance final confirmation work and persist in both densities", async ({
  page,
}) => {
  let { state } = await (await page.request.get("/api/state")).json();
  const rows = [
    [...sheet[0], "College"],
    ...["College Reply DJ", "No College DJ"].map((name, index) => {
      const row = [...sheet[1]];
      row[0] = `college-confirm-${index}`;
      row[2] = name;
      return [...row, index === 0 ? "Wadham" : ""];
    }),
  ];
  const created = await page.request.post("/api/terms", {
    headers: { Origin: "http://localhost:8790" },
    data: { code: "TT40", rows, version: state.version },
  });
  expect(created.status()).toBe(201);
  ({ state } = await created.json());
  const term = state.terms.at(-1);
  const assignedId = term.instances[0].id;
  await page.goto("/");
  await page.locator("#term-select").selectOption(term.id);
  await expect(page.locator(".college-marker")).toHaveCount(1);
  await page.locator(".college-marker").hover();
  await expect(page.locator(".college-marker")).toHaveAttribute(
    "title",
    "Wadham",
  );
  await expect(page.locator(".college-marker")).toHaveAttribute(
    "aria-label",
    "College: Wadham",
  );
  await expect(page.locator(".card-confirmation")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit College Reply DJ", exact: true })
    .click();
  await expect(page.locator("#college")).toHaveValue("Wadham");
  await page.locator("#college").fill("Balliol");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".college-marker")).toHaveAttribute(
    "title",
    "Balliol",
  );
  ({ state } = await (await page.request.get("/api/state")).json());
  for (const action of [
    { type: "duplicate", instanceId: assignedId },
    {
      type: "move",
      instanceId: assignedId,
      nightId: term.nights[0].id,
      slot: 0,
    },
  ]) {
    const response = await page.request.post("/api/action", {
      headers: { Origin: "http://localhost:8790" },
      data: { ...action, termId: term.id, version: state.version },
    });
    expect(response.status()).toBe(200);
    ({ state } = await response.json());
  }
  await page.reload();
  const originalCard = page.locator(`[data-instance="${assignedId}"]`);
  await expect(originalCard.locator(".college-marker")).toHaveAttribute(
    "title",
    "Balliol",
  );
  const confirm = originalCard.locator(".card-confirmation");
  await expect(confirm).toHaveAttribute("aria-pressed", "false");
  await confirm.click();
  await expect(confirm).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#dialog")).not.toBeVisible();
  await page.reload();
  await expect(confirm).toHaveAttribute("aria-pressed", "true");
  await confirm.click();
  await expect(confirm).toHaveAttribute("aria-pressed", "false");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Space");
  await expect(confirm).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".unassigned .card-confirmation")).toHaveCount(0);
  for (const compact of [false, true]) {
    if (compact)
      await page
        .getByRole("button", { name: "Compact mode", exact: true })
        .click();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await originalCard.evaluate((element) => {
          const card = element.getBoundingClientRect();
          const confirm = element
            .querySelector(".card-confirmation")
            .getBoundingClientRect();
          const remove = element
            .querySelector(".card-remove")
            .getBoundingClientRect();
          const dots = element
            .querySelector(".card-availability")
            .getBoundingClientRect();
          const overlaps = (a, b) =>
            a.left < b.right &&
            b.left < a.right &&
            a.top < b.bottom &&
            b.top < a.bottom;
          return (
            confirm.left >= card.left &&
            confirm.right <= card.right &&
            confirm.bottom <= card.bottom &&
            !overlaps(confirm, remove) &&
            !overlaps(confirm, dots)
          );
        }),
      ).toBe(true);
      await confirm.click();
      await expect(confirm).toHaveAttribute("aria-pressed", "false");
      await confirm.click();
      await expect(confirm).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({
        path: `test-results/college-confirm-${compact ? "compact" : "regular"}-${width}.png`,
      });
    }
  }
  await originalCard
    .getByRole("button", {
      name: "Remove College Reply DJ from night",
      exact: true,
    })
    .click();
  await expect(originalCard).toHaveAttribute("data-confirmed", "false");
  await expect(originalCard.locator(".card-confirmation")).toHaveCount(0);
  await expect(originalCard.locator(".college-marker")).toHaveAttribute(
    "title",
    "Balliol",
  );
});

test("filters, saved-state controls and account menu fit and align across viewport sizes", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1540, height: 900 },
    { width: 1280, height: 768 },
    { width: 945, height: 768 },
    { width: 768, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 667 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.locator(".board").evaluate((element) => {
      const board = element.getBoundingClientRect();
      const column = element.querySelector(".column").getBoundingClientRect();
      return {
        visibleFraction:
          (Math.min(board.bottom, innerHeight) - Math.max(board.top, 0)) /
          innerHeight,
        columnFraction: column.height / innerHeight,
        fits:
          board.bottom <= innerHeight &&
          document.documentElement.scrollHeight <= innerHeight,
      };
    });
    expect(
      layout.visibleFraction,
      JSON.stringify(viewport),
    ).toBeGreaterThanOrEqual(0.8);
    expect(
      layout.columnFraction,
      JSON.stringify(viewport),
    ).toBeGreaterThanOrEqual(0.8);
    expect(layout.fits).toBe(true);
    await page.screenshot({
      path: `test-results/board-fullscreen-${viewport.width}-${viewport.height}.png`,
    });
  }
  for (const compact of [false, true]) {
    if (compact)
      await page
        .getByRole("button", { name: "Compact mode", exact: true })
        .click();
    for (const width of [1540, 1280, 945, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await page.locator(".filters").evaluate((element) => {
        const controls = [...element.querySelectorAll("input, select")].map(
          (control) => control.getBoundingClientRect(),
        );
        const row = element.getBoundingClientRect();
        return {
          tops: controls.map((control) => control.top),
          heights: controls.map((control) => control.height),
          fits: controls.every(
            (control) =>
              control.left >= row.left && control.right <= row.right + 1,
          ),
          pageFits: document.documentElement.scrollWidth <= innerWidth,
        };
      });
      expect(new Set(bounds.heights).size).toBe(1);
      expect(bounds.tops[1]).toBe(bounds.tops[2]);
      if (width > 800) expect(new Set(bounds.tops).size).toBe(1);
      expect(bounds.fits).toBe(true);
      expect(bounds.pageFits).toBe(true);
      const trigger = page.getByRole("button", {
        name: accountName,
        exact: true,
      });
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveText("BA");
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(".account-identity")).toContainText(
        "Administrator",
      );
      expect(
        await page.locator("#account-menu").evaluate((element) => {
          const menu = element.getBoundingClientRect();
          return (
            menu.left >= 0 &&
            menu.right <= innerWidth &&
            menu.bottom <= innerHeight
          );
        }),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      if (width === 1280 || width === 390) {
        await page.screenshot({
          path: `test-results/board-aligned-${compact ? "compact" : "regular"}-${width}.png`,
        });
      }
    }
  }
  await page.getByRole("button", { name: accountName, exact: true }).click();
  await page.getByRole("heading", { name: "Open Decks.", exact: true }).click();
  await expect(page.locator("#account-menu")).toBeHidden();
  for (const width of [945, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: accountName, exact: true }).click();
    await page
      .getByRole("button", { name: "Edit history & saved states", exact: true })
      .click();
    const layout = await page
      .locator(".snapshot-composer")
      .evaluate((element) => {
        const input = element.querySelector("input").getBoundingClientRect();
        const button = element.querySelector("button").getBoundingClientRect();
        const body = element.closest(".modal-body");
        return {
          inputBottom: input.bottom,
          buttonBottom: button.bottom,
          inputHeight: input.height,
          buttonHeight: button.height,
          fits: body.scrollWidth <= body.clientWidth,
        };
      });
    expect(layout.inputHeight).toBe(layout.buttonHeight);
    if (width > 700) expect(layout.inputBottom).toBe(layout.buttonBottom);
    expect(layout.fits).toBe(true);
    await page.screenshot({
      path: `test-results/history-aligned-${width}.png`,
    });
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: accountName, exact: true }),
    ).toBeFocused();
  }
  await page.getByRole("button", { name: accountName, exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Change password", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Change password", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("demographic fields import, edit, search and switch on cards in both densities", async ({
  page,
}) => {
  let { state } = await (await page.request.get("/api/state")).json();
  const demographicHeaders = [
    ...sheet[0],
    "Ethnic background",
    "Gender identity",
  ];
  const imported = [...sheet[1], "Mixed heritage", "Non-binary"];
  imported[0] = "demographic-import";
  imported[2] = "Identity Fields DJ";
  const created = await page.request.post("/api/terms", {
    headers: { Origin: "http://localhost:8790" },
    data: {
      code: "HT39",
      rows: [demographicHeaders, imported],
      version: state.version,
    },
  });
  expect(created.status()).toBe(201);
  ({ state } = await created.json());
  const term = state.terms.at(-1);
  await page.goto("/");
  await page.locator("#term-select").selectOption(term.id);
  await expect(page.locator(".genres")).toContainText("House, garage");
  await page.locator("#search").fill("NON-BINARY");
  await expect(page.locator(".dj-card")).toHaveCount(1);
  await page.locator("#search").fill("mixed heritage");
  await expect(page.locator(".dj-card")).toHaveCount(1);
  await page.locator("#search").fill("");
  await page
    .getByRole("button", { name: "Edit Identity Fields DJ", exact: true })
    .click();
  await expect(page.getByLabel("Ethnicity", { exact: true })).toHaveValue(
    "Mixed heritage",
  );
  await expect(page.getByLabel("Gender", { exact: true })).toHaveValue(
    "Non-binary",
  );
  await page.getByLabel("Ethnicity", { exact: true }).fill("South Asian");
  await page.getByLabel("Gender", { exact: true }).fill("Agender");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Add a DJ", exact: true }).click();
  await page.getByLabel("DJ name", { exact: true }).fill("Manual Identity DJ");
  await page.getByLabel("Genres", { exact: true }).fill("Techno");
  await page.getByLabel("Ethnicity", { exact: true }).fill("White British");
  await page.getByLabel("Gender", { exact: true }).fill("Woman");
  await page.getByRole("button", { name: "Add DJ", exact: true }).click();
  await page
    .getByRole("button", { name: "Show ethnicity and gender", exact: true })
    .click();
  await expect(page.locator(".genres")).toHaveText([
    "Ethnicity: South Asian · Gender: Agender",
    "Ethnicity: White British · Gender: Woman",
  ]);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Show genres", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Edit Identity Fields DJ", exact: true })
    .click();
  await expect(page.getByLabel("Gender", { exact: true })).toHaveValue(
    "Agender",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.locator("#search").fill("techno");
  await expect(page.locator(".dj-card")).toHaveCount(1);
  await expect(page.locator(".genres")).toContainText("White British");
  await page.locator("#search").fill("");
  for (const compact of [false, true]) {
    if (compact)
      await page
        .getByRole("button", { name: "Compact mode", exact: true })
        .click();
    for (const viewport of [
      { width: 945, height: 768 },
      { width: 390, height: 844 },
      { width: 320, height: 667 },
    ]) {
      await page.setViewportSize(viewport);
      for (let toggle = 0; toggle < 2; toggle++) {
        const button = page.getByRole("button", {
          name: toggle === 0 ? "Show genres" : "Show ethnicity and gender",
          exact: true,
        });
        await expect(button).toBeVisible();
        await button.click();
      }
      const layout = await page.locator(".board").evaluate((element) => {
        const board = element.getBoundingClientRect();
        return {
          fraction: board.height / innerHeight,
          pageFits:
            document.documentElement.scrollHeight <= innerHeight &&
            document.documentElement.scrollWidth <= innerWidth,
        };
      });
      expect(layout.fraction).toBeGreaterThanOrEqual(0.8);
      expect(layout.pageFits).toBe(true);
      if (compact) {
        await expect(page.locator(".genres")).toHaveText([
          "South Asian · Agender",
          "White British · Woman",
        ]);
        await expect(page.locator(".genres").first()).toHaveAttribute(
          "title",
          "Ethnicity: South Asian · Gender: Agender",
        );
      }
      await page.screenshot({
        path: `test-results/demographics-${compact ? "compact" : "regular"}-${viewport.width}.png`,
      });
    }
  }
  await page.locator("#search").fill("south asian");
  await page.getByRole("button", { name: "Next night", exact: true }).click();
  await page
    .locator(".column")
    .nth(1)
    .getByRole("button", { name: "Add a DJ to this night", exact: true })
    .click();
  await page.locator("#picker-search").fill("agender");
  await expect(page.locator(".picker-item")).toHaveCount(1);
  await expect(page.locator(".picker-item")).toContainText("South Asian");
});

test("compact experience and plain vinyl markers sit side by side without covering dots or remove buttons", async ({
  page,
}) => {
  let { state } = await (await page.request.get("/api/state")).json();
  const rows = [
    [...sheet[0], "College"],
    ...["Gigging vinyl", "Beginner vinyl", "Unspecified format"].map(
      (name, index) => {
        const row = [...sheet[1]];
        row[0] = `layout-${index}`;
        row[2] = name;
        row[10] =
          index === 0
            ? "Gigging"
            : index === 1
              ? "Absolute beginner"
              : "Ambiguous experience";
        row[11] =
          index === 0 ? "Yes" : index === 1 ? "Would like to learn" : "";
        row.push(index === 1 ? "Wadham" : "");
        return row;
      },
    ),
  ];
  const created = await page.request.post("/api/terms", {
    headers: { Origin: "http://localhost:8790" },
    data: { code: "TT38", rows, version: state.version },
  });
  expect(created.status()).toBe(201);
  ({ state } = await created.json());
  const term = state.terms.at(-1);
  const instanceId = term.instances[1].id;
  for (const action of [
    { type: "duplicate", instanceId },
    {
      type: "comment",
      profileId: term.profiles[1].id,
      text: "A useful team note",
    },
    {
      type: "move",
      instanceId,
      nightId: term.nights[0].id,
      period: "early",
      slot: null,
    },
  ]) {
    const response = await page.request.post("/api/action", {
      headers: { Origin: "http://localhost:8790" },
      data: { ...action, termId: term.id, version: state.version },
    });
    expect(response.status()).toBe(200);
    ({ state } = await response.json());
  }
  await page.goto("/");
  await page.locator("#term-select").selectOption(term.id);
  await page.getByRole("button", { name: "Compact mode", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const layouts = await page
      .locator(".dj-card:visible")
      .evaluateAll((cards) =>
        cards.map((element) => {
          const card = element.getBoundingClientRect();
          const badge = element.querySelector(".badge").getBoundingClientRect();
          const symbols = element
            .querySelector(".card-symbols")
            .getBoundingClientRect();
          const dots = element
            .querySelector(".card-availability")
            .getBoundingClientRect();
          const remove = element
            .querySelector(".card-remove")
            ?.getBoundingClientRect();
          const confirm = element
            .querySelector(".card-confirmation")
            ?.getBoundingClientRect();
          return {
            height: card.height,
            separated: badge.right <= symbols.left,
            centered:
              Math.abs(
                (badge.top + badge.bottom) / 2 -
                  (symbols.top + symbols.bottom) / 2,
              ) < 1,
            fits: symbols.right <= card.right && badge.left >= dots.right,
            dotsClear:
              (!remove || symbols.right <= remove.left) &&
              (!confirm || symbols.right <= confirm.left),
          };
        }),
      );
    for (const layout of layouts)
      expect(layout).toEqual({
        height: 32,
        separated: true,
        centered: true,
        fits: true,
        dotsClear: true,
      });
    await expect(page.locator(".vinyl-marker")).toHaveCount(3);
    await expect(page.locator(".review-symbol")).toHaveCount(0);
    expect(await page.locator(".vinyl-marker").allTextContents()).toEqual([
      "",
      "",
      "",
    ]);
    await page.screenshot({
      path: `test-results/compact-aligned-${width}.png`,
    });
  }
});
