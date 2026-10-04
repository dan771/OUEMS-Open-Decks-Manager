import { test, expect } from "./fixtures.js";
import { sheet } from "../fixture.mjs";
const csv = (rows) =>
  rows
    .map((row) =>
      row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(","),
    )
    .join("\n");

test("full board workflow: edit, comments, duplicate, move, configure, drag, revert, import and refresh", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Open Decks." }),
  ).toBeVisible();
  await expect(page.locator(".dj-card")).toHaveCount(12);
  await expect(page.locator(".column")).toHaveCount(5);
  await page.screenshot({
    path: "test-results/desktop-board.png",
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Edit Night Shift", exact: true })
    .click();
  await page.getByLabel("DJ name", { exact: true }).fill("Night Shift edited");
  await page.getByLabel("Genres", { exact: true }).fill("Garage, dub");
  await page
    .getByLabel("Availability for 12 Nov", { exact: true })
    .selectOption("false");
  await page.getByText("Full form response ·", { exact: false }).click();
  await page.locator("#answer-2").fill("Transcript corrected");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit Night Shift edited", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit Night Shift edited", exact: true })
    .click();
  await page
    .getByLabel("Add a comment", { exact: true })
    .fill("Test-only team comment");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.locator("#comments")).toContainText(
    "Test-only team comment",
  );
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.locator(".dj-card")).toHaveCount(13);
  await expect(
    page.getByRole("button", { name: "Edit Night Shift edited", exact: true }),
  ).toHaveCount(2);
  await page
    .locator(".unassigned .dj-card")
    .filter({ hasText: "Blue Hour" })
    .dragTo(page.locator(".column").nth(1).locator(".column-header"));
  await expect(
    page.locator(".column").nth(1).locator(".column-content"),
  ).toContainText("Blue Hour");
  await expect(page.locator(".unassigned")).not.toContainText("Blue Hour");
  await expect(page.locator(".board")).not.toContainText(
    "Test-only team comment",
  );

  await page
    .locator(".column")
    .nth(1)
    .getByRole("button", { name: "Add a DJ to this night", exact: true })
    .click();
  await page.locator("#picker-search").fill("Night Shift edited");
  await page.locator(".picker-item").first().click();
  await expect(page.locator(".dj-card")).toHaveCount(13);
  await expect(
    page.locator(".column").nth(1).locator(".column-content"),
  ).toContainText("Night Shift edited");
  await page
    .locator(".column")
    .nth(1)
    .getByRole("button", { name: "Configure", exact: true })
    .click();
  await page.getByLabel("Set length (minutes)", { exact: true }).fill("45");
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(
    page.locator(".column").nth(1).locator(".scheduled-set"),
  ).toHaveCount(3);

  const source = page
    .locator(".column")
    .first()
    .locator(".dj-card")
    .filter({ hasText: "Night Shift edited" })
    .first();
  const target = page
    .locator(".column")
    .nth(3)
    .locator('.period-list[data-period="early"]');
  await source.dragTo(target);
  await expect(target).toContainText("Night Shift edited");
  await expect(page.locator(".column").nth(3)).toContainText(
    "Not available for this night",
  );

  await page
    .getByRole("button", { name: "Edit Night Shift edited", exact: true })
    .first()
    .click();
  await page.getByLabel("DJ name", { exact: true }).fill("Shared edit");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit Shared edit", exact: true }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Edit Shared edit", exact: true })
    .first()
    .click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Revert to initial response", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit Night Shift", exact: true }),
  ).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".dj-card")).toHaveCount(13);
  await page
    .getByRole("button", { name: "Edit Night Shift", exact: true })
    .first()
    .click();
  await expect(page.locator("#comments")).toContainText(
    "Test-only team comment",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();

  await page
    .getByRole("button", { name: "Create Open Decks", exact: true })
    .click();
  await page.getByLabel("Oxford term", { exact: true }).last().fill("HT27");
  await page.getByLabel("Venue name", { exact: true }).fill("The Bullingdon");
  const nextRows = sheet.map((row) =>
    row.map((v) => String(v).replaceAll("Oct", "Jan").replaceAll("Nov", "Feb")),
  );
  await page.locator("#csv-file").setInputFiles({
    name: "test-responses.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv(nextRows)),
  });
  await page
    .getByRole("button", { name: "Preview responses & dates", exact: true })
    .click();
  await expect(page.locator("#create-preview")).toContainText(
    "4 nights detected",
  );
  await page.getByRole("button", { name: "Create board", exact: true }).click();
  await expect(page.locator("#term-select")).toHaveValue(
    await page.locator("#term-select option").last().getAttribute("value"),
  );
  await expect(page.locator(".dj-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  await page.locator("#import-file").setInputFiles({
    name: "test-responses.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv(nextRows)),
  });
  await page
    .getByRole("button", { name: "Import new responses", exact: true })
    .click();
  await expect(page.locator(".dj-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Add a DJ", exact: true }).click();
  await page.getByLabel("DJ name", { exact: true }).fill("Manual test DJ");
  await page.getByRole("button", { name: "Add DJ", exact: true }).click();
  await expect(page.locator(".dj-card")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".dj-card")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("mobile controls, search, filters and source preview are usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#term-select").selectOption({ label: "MT26 · demo" });
  await page
    .getByLabel("Search DJs, genres, college, ethnicity or gender", {
      exact: true,
    })
    .fill("Moss");
  await expect(page.locator(".dj-card")).toHaveCount(1);
  await page
    .getByLabel("Search DJs, genres, college, ethnicity or gender", {
      exact: true,
    })
    .fill("");
  await page
    .getByLabel("Filter experience", { exact: true })
    .selectOption("absolute beginner");
  await expect(page.locator(".dj-card")).toHaveCount(2);
  await page.getByLabel("Filter experience", { exact: true }).selectOption("");
  await page.screenshot({
    path: "test-results/mobile-board.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "Edit Moss", exact: true }).click();
  await expect(page.getByLabel("DJ name", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/mobile-editor.png",
    fullPage: false,
  });
  await page.getByText("Move this card", { exact: true }).click();
  const first = await page
    .locator("#move-destination option")
    .nth(1)
    .getAttribute("value");
  await page.locator("#move-destination").selectOption(first);
  await page.getByRole("button", { name: "Move card", exact: true }).click();
  await expect(
    page.locator(".column").nth(1).locator(".column-content"),
  ).toContainText("Moss");
  await expect(page.locator(".unassigned")).not.toContainText("Moss");
});
test("a concurrent edit keeps unsaved inputs and offers review of the latest saved DJ", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#term-select").selectOption({ label: "MT26 · demo" });
  const initialCount = await page
    .getByRole("button", { name: "Edit Night Shift", exact: true })
    .count();
  await page
    .getByRole("button", { name: "Edit Night Shift", exact: true })
    .first()
    .click();
  await page.getByLabel("DJ name", { exact: true }).fill("Unsaved local draft");
  const { state } = await (await page.request.get("/api/state")).json();
  const term = state.terms.find((t) => t.demo);
  const profile = term.profiles.find((p) => p.name === "Night Shift");
  const response = await page.request.post("/api/action", {
    headers: { Origin: "http://localhost:8790" },
    data: {
      type: "edit",
      termId: term.id,
      profileId: profile.id,
      version: state.version,
      fields: { name: "Another organiser" },
    },
  });
  expect(response.status()).toBe(200);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator(".inline-error")).toContainText("board changed");
  await expect(page.getByLabel("DJ name", { exact: true })).toHaveValue(
    "Unsaved local draft",
  );
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Review latest DJ", exact: true })
    .click();
  await expect(page.getByLabel("DJ name", { exact: true })).toHaveValue(
    "Another organiser",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit Another organiser", exact: true }),
  ).toHaveCount(initialCount);
});

test("early/late availability, override moves, collapse and ten compact DJs without scrolling", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let { state } = await (await page.request.get("/api/state")).json();
  const rows = structuredClone(sheet);
  rows[1][2] = "Half Test";
  rows[1][5] = "Second half - 9pm-11pm";
  let response = await page.request.post("/api/terms", {
    headers: { Origin: "http://localhost:8790" },
    data: { code: "MT28", rows, version: state.version },
  });
  expect(response.status()).toBe(201);
  ({ state } = await response.json());
  const term = state.terms.find((t) => t.code === "MT28");
  const night = term.nights[0];
  for (let i = 1; i <= 9; i++) {
    response = await page.request.post("/api/action", {
      headers: { Origin: "http://localhost:8790" },
      data: {
        type: "add",
        termId: term.id,
        nightId: night.id,
        period: "late",
        version: state.version,
        fields: {
          name: `Compact DJ ${i}`,
          genres: "House, garage",
          experience: "absolute beginner",
          vinyl: "yes",
        },
      },
    });
    expect(response.status()).toBe(200);
    ({ state } = await response.json());
  }
  await page.setViewportSize({ width: 1540, height: 800 });
  await page.goto("/");
  await page.locator("#term-select").selectOption(term.id);
  await page
    .getByRole("button", { name: "Edit Half Test", exact: true })
    .click();
  await expect(page.locator("#availability-summary")).toContainText(
    "Late · Monday 16 Oct",
  );
  await expect(page.locator("#availability-summary")).toContainText(
    "Early & Late · Sunday 29 Oct",
  );
  await page
    .getByLabel("Timing preference for 16 Oct", { exact: true })
    .fill("Don't mind");
  await expect(page.locator("#availability-summary")).toContainText(
    "Early & Late · Monday 16 Oct",
  );
  await page
    .getByLabel("Timing preference for 16 Oct", { exact: true })
    .fill("prefer late");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const column = page.locator(`[data-night-column="${night.id}"]`);
  const early = column.locator('.period-list[data-period="early"]');
  const late = column.locator('.period-list[data-period="late"]');
  const card = page
    .locator(".unassigned .dj-card")
    .filter({ hasText: "Half Test" });
  await card.dispatchEvent("dragstart", {
    dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
  });
  await expect(early).toHaveAttribute("data-availability", "outside");
  await expect(late).toHaveAttribute("data-availability", "available");
  await card.dispatchEvent("dragend");
  await card.dragTo(early.locator(".period-heading"));
  await expect(early).toContainText("Half Test");
  await expect(page.locator("#toast")).toContainText("override");
  await early.locator(".dj-card").dragTo(late.locator(".period-heading"));
  await expect(late.locator(".dj-card")).toHaveCount(10);
  await expect(page.locator(".night-queue")).toHaveCount(0);
  await page.getByRole("button", { name: "Compact mode", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Compact mode", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(late.locator(".dj-card")).toHaveCount(10);
  const geometry = await column.evaluate((el) => {
    const content = el.querySelector(".column-content");
    const cards = [...el.querySelectorAll(".dj-card")].map((card) =>
      card.getBoundingClientRect(),
    );
    const viewport = content.getBoundingClientRect();
    return {
      overflow: content.scrollHeight - content.clientHeight,
      allVisible: cards.every(
        (r) => r.top >= viewport.top && r.bottom <= viewport.bottom,
      ),
      bottom: el.getBoundingClientRect().bottom,
    };
  });
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.allVisible).toBe(true);
  expect(geometry.bottom).toBeLessThanOrEqual(800);
  await page.screenshot({ path: "test-results/compact-ten-djs.png" });
  await page.setViewportSize({ width: 1280, height: 768 });
  expect(
    await column
      .locator(".column-content")
      .evaluate((el) => el.scrollHeight - el.clientHeight),
  ).toBeLessThanOrEqual(1);
  await late.getByRole("button", { name: "Collapse Late" }).click();
  await expect(late.locator(".cards")).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Compact mode", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(late.locator(".cards")).toBeHidden();
  await late.getByRole("button", { name: "Expand Late" }).click();
  await expect(late.locator(".cards")).toBeVisible();
  await column
    .getByRole("button", { name: "Add a DJ to this night", exact: true })
    .click();
  await page.locator("#picker-period").selectOption("late");
  await page.locator("#picker-search").fill("Half Test");
  await expect(page.locator(".picker-item")).toHaveCount(0);
  await page.locator("#picker-period").selectOption("early");
  await page.locator(".picker-item").click();
  await expect(early.locator(".dj-card")).toHaveCount(1);
  await expect(late.locator(".dj-card")).toHaveCount(9);
  expect(
    await column
      .locator(".column-content")
      .evaluate((el) => el.scrollHeight - el.clientHeight),
  ).toBeLessThanOrEqual(1);
  await late.getByRole("button", { name: "Collapse Late" }).click();
  await early.locator(".dj-card").dragTo(late.locator(".period-heading"));
  await expect(late.locator(".cards")).toBeVisible();
  await expect(late.locator(".dj-card")).toHaveCount(10);
  expect(errors).toEqual([]);
});
