import { test, expect } from "./fixtures.js";
import { sheet } from "../fixture.mjs";
import { prepareAction } from "../../public/lib/collaboration.js";

test("rapid card actions queue, review competing moves, recover lost replies and reconnect offline", async ({
  page,
  browser,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let { state } = await (await page.request.get("/api/state")).json();
  const rows = [
    sheet[0],
    ...["Queue Alpha", "Queue Beta", "Queue Gamma"].map((name, index) => {
      const row = [...sheet[1]];
      row[0] = `queued-response-${index}`;
      row[2] = name;
      return row;
    }),
  ];
  const created = await page.request.post("/api/terms", {
    headers: { Origin: "http://localhost:8790" },
    data: { code: "MT48", rows, version: state.version },
  });
  expect(created.status()).toBe(201);
  ({ state } = await created.json());
  const term = state.terms.at(-1),
    [night, secondNight] = term.nights;
  const user = await page.request.post("/api/admin/users", {
    headers: { Origin: "http://localhost:8790" },
    data: {
      username: "queue-manager",
      name: "Queue organiser",
      password: "Queue browser password 2026",
      role: "manager",
    },
  });
  expect(user.status()).toBe(200);
  const context = await browser.newContext();
  let release;
  try {
    const signed = await context.request.post(
      "http://localhost:8790/api/auth/login",
      {
        headers: { Origin: "http://localhost:8790" },
        data: {
          username: "queue-manager",
          password: "Queue browser password 2026",
        },
      },
    );
    expect(signed.status()).toBe(200);
    await context.setExtraHTTPHeaders({
      "X-CSRF-Token": (await signed.json()).csrf,
    });
    const other = await context.newPage();
    other.on("pageerror", (error) => errors.push(error.message));
    for (const editor of [page, other]) {
      await editor.goto("http://localhost:8790/");
      await editor.locator("#term-select").selectOption(term.id);
      await expect(editor.locator("#sync-status")).toHaveAttribute(
        "data-status",
        "live",
      );
    }
    const card = (editor, name) =>
      editor.locator(".dj-card").filter({
        has: editor.getByRole("button", {
          name: `Edit ${name}`,
          exact: true,
        }),
      });
    const half = (editor, nightId, period) =>
      editor.locator(
        `.period-list[data-night="${nightId}"][data-period="${period}"]`,
      );
    const holdNextSave = async () => {
      let first = true;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      await page.route("**/api/action", async (route) => {
        if (first) {
          first = false;
          await held;
        }
        await route.continue();
      });
    };
    await holdNextSave();
    await card(page, "Queue Alpha").dragTo(half(page, night.id, "early"));
    await expect(half(page, night.id, "early")).toContainText("Queue Alpha");
    await card(page, "Queue Alpha").dragTo(half(page, night.id, "late"));
    await card(page, "Queue Alpha").locator(".card-confirmation").click();
    await expect(page.locator("#sync-status")).toHaveText("Saving 3 changes…");
    await expect(card(page, "Queue Alpha")).toHaveAttribute(
      "data-confirmed",
      "true",
    );
    await other
      .getByRole("button", { name: "Edit Queue Beta", exact: true })
      .click();
    await other
      .getByLabel("Genres", { exact: true })
      .fill("Remote genres during pending moves");
    await other
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(card(page, "Queue Beta")).toContainText(
      "Remote genres during pending moves",
    );
    await other
      .getByRole("button", { name: "Board activity", exact: true })
      .click();
    release();
    await expect(
      page.getByRole("button", { name: "Pending board changes", exact: true }),
    ).toBeHidden();
    await expect(half(other, night.id, "late")).toContainText("Queue Alpha");
    await expect(card(other, "Queue Alpha")).toHaveAttribute(
      "data-confirmed",
      "true",
    );
    await expect(other.locator("#activity-list")).toContainText(
      "Confirmed Queue Alpha",
    );
    await other
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.unroute("**/api/action");

    await holdNextSave();
    await card(page, "Queue Beta").dragTo(half(page, night.id, "early"));
    ({ state } = await (await other.request.get("/api/state")).json());
    const beta = state.terms
      .find((t) => t.id === term.id)
      .instances.find((i) => i.profileId === term.profiles[1].id);
    const moved = await other.request.post("/api/action", {
      headers: { Origin: "http://localhost:8790" },
      data: {
        ...prepareAction(state, {
          type: "move",
          termId: term.id,
          instanceId: beta.id,
          nightId: secondNight.id,
          period: "late",
          slot: null,
        }),
        version: state.version,
        operationId: crypto.randomUUID(),
      },
    });
    expect(moved.status()).toBe(200);
    await expect(half(page, secondNight.id, "late")).toContainText(
      "Queue Beta",
    );
    release();
    await expect(page.locator("#sync-status")).toHaveText("Review 1 change");
    await page.unroute("**/api/action");
    await page
      .getByRole("button", { name: "Pending board changes", exact: true })
      .click();
    await expect(page.locator("#pending-saves-list")).toContainText(
      "Latest saved: 29 Oct",
    );
    await page
      .getByRole("button", { name: "Apply reviewed changes", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pending board changes", exact: true }),
    ).toBeHidden();
    await expect(half(other, night.id, "early")).toContainText("Queue Beta");

    await page.route("**/api/action", async (route) => {
      await route.fetch();
      await route.abort("failed");
    });
    await card(page, "Queue Alpha").dragTo(half(page, night.id, "early"));
    await card(page, "Queue Alpha").locator(".card-confirmation").click();
    await expect(page.locator("#sync-status")).toHaveText("2 unsaved changes");
    await page.unroute("**/api/action");
    await page.reload();
    await expect(page.locator("#sync-status")).toHaveText("2 unsaved changes");
    await page
      .getByRole("button", { name: "Pending board changes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Retry saves", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pending board changes", exact: true }),
    ).toBeHidden();
    await expect(card(other, "Queue Alpha")).toHaveAttribute(
      "data-confirmed",
      "false",
    );
    const activity = await (
      await page.request.get(`/api/activity?termId=${term.id}`)
    ).json();
    expect(
      activity.activity.filter((e) =>
        e.summary.startsWith("Moved Queue Alpha"),
      ),
    ).toHaveLength(3);

    await page.context().setOffline(true);
    await card(page, "Queue Gamma").dragTo(half(page, night.id, "early"));
    await card(page, "Queue Gamma").locator(".card-confirmation").click();
    await expect(page.locator("#sync-status")).toHaveText("2 unsaved changes");
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Pending board changes", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry saves", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/queued-saves-mobile.png" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.context().setOffline(false);
    await expect(
      page.getByRole("button", { name: "Pending board changes", exact: true }),
    ).toBeHidden({ timeout: 12000 });
    await expect(card(other, "Queue Gamma")).toHaveAttribute(
      "data-confirmed",
      "true",
    );
    expect(errors).toEqual([]);
  } finally {
    release?.();
    await page.context().setOffline(false);
    await context.close();
  }
});
