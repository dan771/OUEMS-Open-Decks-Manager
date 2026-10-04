import { test, expect } from "./fixtures.js";
import { sheet } from "../fixture.mjs";

async function loginPage(page, username, password) {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:8790/");
  await expect(
    page.getByRole("heading", { name: "Open Decks." }),
  ).toBeVisible();
}

test("Late drops leave Early gaps intact and set timings can be cleared and replanned", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let { state } = await (await page.request.get("/api/state")).json();
  const rows = [
    sheet[0],
    ...["Gap Opener", "Gap Closer", "Gap Arrival"].map((name, index) => {
      const row = [...sheet[1]];
      row[0] = `gap-planning-${index}`;
      row[2] = name;
      return row;
    }),
  ];
  const created = await page.request.post("/api/terms", {
    headers: { Origin: "http://localhost:8790" },
    data: { code: "MT36", rows, version: state.version },
  });
  expect(created.status()).toBe(201);
  ({ state } = await created.json());
  const term = state.terms.at(-1);
  const nightId = term.nights[0].id;
  const [opener, closer, arrival] = term.instances;
  for (const action of [
    { type: "configure", start: "18:00", end: "00:00", setLength: 45 },
    { type: "move", instanceId: opener.id, period: "early" },
    { type: "move", instanceId: closer.id, period: "late" },
    {
      type: "plan",
      sets: [
        { instanceIds: [opener.id], duration: 135 },
        { instanceIds: [], duration: 45 },
        { instanceIds: [closer.id], duration: 45 },
      ],
    },
  ]) {
    const saved = await page.request.post("/api/action", {
      headers: { Origin: "http://localhost:8790" },
      data: { ...action, termId: term.id, nightId, version: state.version },
    });
    expect(saved.status()).toBe(200);
    ({ state } = await saved.json());
  }
  await page.goto("/");
  await page.locator("#term-select").selectOption(term.id);
  const night = page.locator(`[data-night-column="${nightId}"]`);
  const early = night.locator('.period-list[data-period="early"]');
  const late = night.locator('.period-list[data-period="late"]');
  const earlyGap = early.locator('.empty-set[data-slot="1"]');
  await expect(earlyGap).toContainText("20:15–21:00");
  await page
    .locator(`[data-instance="${arrival.id}"]`)
    .dragTo(late.locator(".period-heading"));
  await expect(late.locator(`[data-instance="${arrival.id}"]`)).toBeVisible();
  await expect(late.locator('.scheduled-set[data-slot="3"]')).toContainText(
    "21:45–22:30",
  );
  await expect(earlyGap).toBeVisible();
  await night
    .getByRole("button", { name: "Remove Gap Opener from night", exact: true })
    .click();
  await expect(early.locator('.empty-set[data-slot="0"]')).toBeVisible();
  await expect(late.locator('.scheduled-set[data-slot="2"]')).toContainText(
    "21:00–21:45",
  );
  await page.reload();
  await expect(earlyGap).toBeVisible();
  await expect(late.locator('.scheduled-set[data-slot="3"]')).toContainText(
    "Gap Arrival",
  );
  await night.getByRole("button", { name: "Plan sets", exact: true }).click();
  await expect(
    page.locator(".plan-row").filter({ hasText: "Open slot" }),
  ).toHaveCount(2);
  await page
    .getByRole("button", { name: "Add empty slot", exact: true })
    .click();
  await expect(
    page.locator(".plan-row").filter({ hasText: "Open slot" }),
  ).toHaveCount(3);
  await page
    .getByRole("button", { name: "Save set plan", exact: true })
    .click();
  await expect(late.locator('.empty-set[data-slot="4"]')).toContainText(
    "22:30–23:15",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await night.getByRole("button", { name: "Plan sets", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear set timings", exact: true })
    .click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await expect(night.locator(".scheduled-set, .empty-set")).toHaveCount(0);
  await expect(late.locator(".dj-card")).toHaveCount(2);
  await expect(late).not.toContainText("21:00–21:45");
  await page.reload();
  await expect(late.locator(".dj-card")).toHaveCount(2);
  await night.getByRole("button", { name: "Plan sets", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Clear set timings", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Save set plan", exact: true })
    .click();
  await expect(late.locator(".scheduled-set")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("named venues, inline set planning, B2B, individual durations and one-click removal work on desktop and mobile", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { state } = await (await page.request.get("/api/state")).json();
  const rows = [
    sheet[0],
    ...["Planning One", "Planning Two", "Planning Closer"].map((name, i) => {
      const row = [...sheet[1]];
      row[0] = `test-planning-${i}`;
      row[2] = name;
      return row;
    }),
  ];
  const response = await page.request.post("/api/terms", {
    headers: { Origin: "http://localhost:8790" },
    data: {
      code: "HT35",
      rows,
      venue: "The Bullingdon",
      version: state.version,
    },
  });
  expect(response.status()).toBe(201);
  const term = (await response.json()).state.terms.at(-1);
  await page.goto("/");
  await page.locator("#term-select").selectOption(term.id);
  const night = page.locator(`[data-night-column="${term.nights[0].id}"]`);
  for (const name of ["Planning One", "Planning Two", "Planning Closer"]) {
    await night
      .getByRole("button", { name: "Add a DJ to this night", exact: true })
      .click();
    await page.locator("#picker-search").fill(name);
    await page.locator(".picker-item").click();
  }
  await night.getByRole("button", { name: "Configure", exact: true }).click();
  await page.getByLabel("Venue name", { exact: true }).fill("The Library");
  await page.getByLabel("Start time", { exact: true }).fill("18:00");
  await page.getByLabel("End time", { exact: true }).fill("21:00");
  await page
    .getByRole("button", { name: "Save configuration", exact: true })
    .click();
  await expect(night.locator(".column-kicker")).toContainText("The Library");
  await expect(night.locator(".scheduled-set")).toHaveCount(3);
  expect(
    await night
      .locator(".dj-card")
      .first()
      .evaluate((card) => {
        const dots = card
          .querySelector(".card-availability")
          .getBoundingClientRect();
        const remove = card
          .querySelector(".card-remove")
          .getBoundingClientRect();
        return dots.right <= remove.left;
      }),
  ).toBe(true);
  await expect(page.locator(".set-planner")).toHaveCount(0);
  await night.getByRole("button", { name: "Plan sets", exact: true }).click();
  await page
    .getByRole("button", { name: "Move Planning Two up", exact: true })
    .click();
  await expect(page.locator(".plan-row").first()).toContainText("Planning Two");
  await page
    .getByLabel("B2B partner for Planning Two", { exact: true })
    .selectOption({ label: "Planning One" });
  await expect(page.locator(".plan-row")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Fill night equally", exact: true })
    .click();
  await page
    .getByLabel("Duration for Planning Two B2B Planning One", { exact: true })
    .fill("120");
  await page
    .getByLabel("Duration for Planning Closer", { exact: true })
    .fill("60");
  await expect(page.locator("#plan-summary")).toContainText(
    "Night fully scheduled",
  );
  await page.screenshot({ path: "test-results/set-planning-desktop.png" });
  await page
    .getByRole("button", { name: "Save set plan", exact: true })
    .click();
  await expect(night.locator(".scheduled-set")).toHaveCount(2);
  await expect(night.locator(".scheduled-set").first()).toContainText("B2B");
  await expect(
    night.locator(".scheduled-set").first().locator(".dj-card"),
  ).toHaveCount(2);
  await expect(night.locator('.period-list[data-period="late"]')).toContainText(
    "20:00–21:00",
  );
  await page.reload();
  await expect(night.locator(".scheduled-set")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await night.getByRole("button", { name: "Plan sets", exact: true }).click();
  await expect(
    page.getByLabel("Duration for Planning Closer", { exact: true }),
  ).toHaveValue("60");
  await expect(page.locator(".plan-row").first()).toContainText("B2B");
  await page.screenshot({ path: "test-results/set-planning-mobile.png" });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await night
    .getByRole("button", {
      name: "Remove Planning One from night",
      exact: true,
    })
    .click();
  await expect(page.locator(".unassigned")).toContainText("Planning One");
  await expect(night).not.toContainText("Planning One");
  await expect(night.locator(".scheduled-set").first()).not.toContainText(
    "B2B",
  );
  await page.getByRole("button", { name: "Add a night", exact: true }).click();
  await page.getByLabel("Venue name", { exact: true }).fill("New Venue");
  await page.getByLabel("Night date", { exact: true }).fill("2035-03-01");
  await page.getByRole("button", { name: "Add night", exact: true }).click();
  await expect(
    page.locator("[data-night-column] .column-kicker strong"),
  ).toHaveCount(5);
  await expect(
    page
      .locator("[data-night-column] .column-kicker strong")
      .filter({ hasText: "New Venue" }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("administrators can create roles and restore a saved state; manager and viewer UIs enforce permissions", async ({
  page,
  browser,
}) => {
  const password = "Browser role password 2026";
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "Account menu for Browser administrator",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Users & roles", exact: true })
    .click();
  for (const role of ["manager", "viewer"]) {
    await page.getByLabel("Username", { exact: true }).fill(`ui-${role}`);
    await page.getByLabel("Display name", { exact: true }).fill(`UI ${role}`);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Role", { exact: true }).selectOption(role);
    await page
      .getByRole("button", { name: "Save account", exact: true })
      .click();
    await expect(page.locator("#account-choice option")).toContainText([
      "Create a new login",
      "Browser administrator",
      ...(role === "manager" ? ["UI manager"] : ["UI manager", "UI viewer"]),
    ]);
  }
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  const termId = await page.locator("#term-select").inputValue();
  await page
    .getByRole("button", {
      name: "Account menu for Browser administrator",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Edit history & saved states", exact: true })
    .click();
  await page
    .getByLabel("Saved state name", { exact: true })
    .fill("Before browser restore check");
  await page
    .getByRole("button", { name: "Save current state", exact: true })
    .click();
  await expect(page.locator(".saved-states")).toContainText(
    "Before browser restore check",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Add a DJ", exact: true }).click();
  await page.getByLabel("DJ name", { exact: true }).fill("Restoration test DJ");
  await page.getByRole("button", { name: "Add DJ", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Account menu for Browser administrator",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Edit history & saved states", exact: true })
    .click();
  await expect(page.locator(".history-list")).toContainText(
    "Browser administrator",
  );
  page.once("dialog", (d) => d.accept());
  await page
    .locator(".saved-state")
    .filter({ hasText: "Before browser restore check" })
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await expect(page.locator(".saved-states")).toContainText(
    "Before restoring Before browser restore check",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.locator(".board")).not.toContainText("Restoration test DJ");
  for (const role of ["manager", "viewer"]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 768 },
    });
    const other = await context.newPage();
    const errors = [];
    other.on("pageerror", (e) => errors.push(e.message));
    await loginPage(other, `ui-${role}`, password);
    await other.locator("#term-select").selectOption(termId);
    await other
      .getByRole("button", { name: `Account menu for UI ${role}`, exact: true })
      .click();
    await expect(other.locator(".account-identity")).toContainText(
      role === "manager" ? "Manager" : "Viewer",
    );
    await expect(
      other.getByRole("button", {
        name: "Edit history & saved states",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      other.getByRole("button", { name: "Users & roles", exact: true }),
    ).toHaveCount(0);
    await expect(other.locator('[data-action="delete-board"]')).toHaveCount(0);
    await expect(
      other.getByRole("link", { name: "Export workspace", exact: true }),
    ).toHaveCount(0);
    await other.keyboard.press("Escape");
    if (role === "manager") {
      await expect(
        other.getByRole("button", { name: "Create Open Decks", exact: true }),
      ).toBeVisible();
      await other.locator('[data-action="configure"]').first().click();
      await expect(
        other.getByRole("button", { name: "Delete night", exact: true }),
      ).toBeVisible();
      await other
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await other.locator(".card-open").first().click();
      await expect(
        other.getByRole("button", { name: "Save changes", exact: true }),
      ).toBeVisible();
      await expect(
        other.getByRole("button", {
          name: "Revert to initial response",
          exact: true,
        }),
      ).toHaveCount(0);
    } else {
      await expect(other.locator('[data-action="configure"]')).toHaveCount(0);
      await expect(
        other.getByRole("button", { name: "Create Open Decks", exact: true }),
      ).toHaveCount(0);
      await expect(other.locator('[draggable="true"]')).toHaveCount(0);
      await expect(other.locator('[data-action="confirm-card"]')).toHaveCount(
        0,
      );
      await other.locator("#search").fill("unmatched viewer search");
      await expect(other.locator(".dj-card")).toHaveCount(0);
      await other.locator("#search").fill("");
      await other.locator(".card-open").first().click();
      await expect(
        other.getByRole("button", { name: "Save changes", exact: true }),
      ).toHaveCount(0);
      await expect(other.locator(".transcript")).toHaveCount(0);
    }
    const stateResponse = await other.request.get("/api/state");
    const stateData = await stateResponse.json();
    const denied = await other.request.post("/api/admin/users", {
      headers: {
        Origin: "http://localhost:8790",
        "X-CSRF-Token": stateData.csrf,
      },
      data: {},
    });
    expect(denied.status()).toBe(403);
    expect(errors).toEqual([]);
    await context.close();
  }
});

test("signed-out visitors see only login and sign-out revokes workspace access", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const visitor = await context.newPage();
  await visitor.goto("/");
  await expect(visitor).toHaveURL(/\/login$/);
  expect((await visitor.request.get("/api/state")).status()).toBe(401);
  await expect(visitor.locator(".board")).toHaveCount(0);
  await visitor.screenshot({ path: "test-results/login-mobile.png" });
  await loginPage(visitor, "browser-admin", "Browser test password 2026");
  await visitor
    .getByRole("button", {
      name: "Account menu for Browser administrator",
      exact: true,
    })
    .click();
  await visitor.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(visitor).toHaveURL(/\/login$/);
  expect((await visitor.request.get("/api/state")).status()).toBe(401);
  await visitor.goBack();
  await expect(visitor.locator(".board")).toHaveCount(0);
  await context.close();
});
