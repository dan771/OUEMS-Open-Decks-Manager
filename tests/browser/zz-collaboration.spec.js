import { test, expect } from "./fixtures.js";
import { sheet } from "../fixture.mjs";

test("live organisers merge drafts, resolve field conflicts, recover reloads and see activity", async ({
  page,
  browser,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rows = [
    sheet[0],
    ...["Collab Alpha", "Collab Beta", "Collab Gamma"].map((name, index) => {
      const row = [...sheet[1]];
      row[0] = `collaboration-${index}`;
      row[2] = name;
      return row;
    }),
  ];
  let { state } = await (await page.request.get("/api/state")).json();
  const created = await page.request.post("/api/terms", {
    headers: { Origin: "http://localhost:8790" },
    data: { code: "TT46", rows, version: state.version },
  });
  expect(created.status()).toBe(201);
  ({ state } = await created.json());
  const term = state.terms.at(-1);
  const user = await page.request.post("/api/admin/users", {
    headers: { Origin: "http://localhost:8790" },
    data: {
      username: "collaboration-manager",
      name: "Live organiser",
      password: "Browser collaboration password 2026",
      role: "manager",
    },
  });
  expect(user.status()).toBe(200);
  const context = await browser.newContext();
  try {
    const signed = await context.request.post(
      "http://localhost:8790/api/auth/login",
      {
        headers: { Origin: "http://localhost:8790" },
        data: {
          username: "collaboration-manager",
          password: "Browser collaboration password 2026",
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
    await expect(page.locator("#collaborators")).toContainText("LO");
    for (const editor of [page, other])
      await editor
        .getByRole("button", { name: "Edit Collab Alpha", exact: true })
        .click();
    await expect(page.locator("#editing-presence")).toContainText(
      "Live organiser",
    );
    await page.getByLabel("DJ name", { exact: true }).fill("Alpha renamed");
    await other
      .getByLabel("Genres", { exact: true })
      .fill("Independent remote genres");
    await other
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.locator("#dialog-live-notice")).toBeVisible();
    await expect(page.getByLabel("DJ name", { exact: true })).toHaveValue(
      "Alpha renamed",
    );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      other.getByRole("button", { name: "Edit Alpha renamed", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Edit Alpha renamed", exact: true })
      .click();
    await expect(page.getByLabel("Genres", { exact: true })).toHaveValue(
      "Independent remote genres",
    );
    await other
      .getByRole("button", { name: "Edit Alpha renamed", exact: true })
      .click();
    await page.getByLabel("DJ name", { exact: true }).fill("My chosen name");
    await other
      .getByLabel("DJ name", { exact: true })
      .fill("Remote chosen name");
    await other
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.locator(".conflict-choice")).toContainText(
      "Remote chosen name",
    );
    await expect(page.getByLabel("DJ name", { exact: true })).toHaveValue(
      "My chosen name",
    );
    await page
      .getByRole("button", { name: "Keep my value", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      other.getByRole("button", { name: "Edit My chosen name", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Edit My chosen name", exact: true })
      .click();
    await page
      .locator("#new-comment")
      .fill("Retry this comment without duplicating it");
    await page.route("**/api/action", async (route) => {
      if (route.request().postDataJSON().type === "comment") {
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: "Add comment", exact: true })
      .click();
    await expect(page.locator("#sync-status")).toContainText("Save failed");
    await page.unroute("**/api/action");
    await page.reload();
    await page
      .getByRole("button", { name: "Edit My chosen name", exact: true })
      .click();
    await expect(page.locator("#new-comment")).toHaveValue(
      "Retry this comment without duplicating it",
    );
    await page
      .getByRole("button", { name: "Add comment", exact: true })
      .click();
    await expect(page.locator("#new-comment")).toHaveValue("");
    await expect(page.locator("#comments .comment")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit Collab Beta", exact: true })
      .click();
    await page
      .getByLabel("Genres", { exact: true })
      .fill("Recover this local draft");
    await page.reload();
    await page
      .getByRole("button", { name: "Edit Collab Beta", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Restore draft", exact: true })
      .click();
    await expect(page.getByLabel("Genres", { exact: true })).toHaveValue(
      "Recover this local draft",
    );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Board activity", exact: true })
      .click();
    await expect(page.locator(".history-list")).toContainText("Live organiser");
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await context.setOffline(true);
    await expect(other.locator("#sync-status")).toHaveAttribute(
      "data-status",
      "offline",
    );
    await page
      .getByRole("button", { name: "Edit Collab Gamma", exact: true })
      .click();
    await page
      .getByLabel("DJ name", { exact: true })
      .fill("Gamma after reconnect");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await context.setOffline(false);
    await expect(
      other.getByRole("button", {
        name: "Edit Gamma after reconnect",
        exact: true,
      }),
    ).toBeVisible({ timeout: 12000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("button", { name: "Board activity", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/live-collaboration-mobile.png",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await other
      .getByRole("button", { name: "Edit Collab Beta", exact: true })
      .click();
    await other
      .getByLabel("Genres", { exact: true })
      .fill("Draft kept through board removal");
    ({ state } = await (await page.request.get("/api/state")).json());
    const removed = await page.request.post("/api/action", {
      headers: { Origin: "http://localhost:8790" },
      data: {
        type: "delete-board",
        termId: term.id,
        version: state.version,
      },
    });
    expect(removed.status()).toBe(200);
    await expect(other.locator(".inline-error")).toContainText(
      "removed by another organiser",
    );
    await expect(
      other.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeDisabled();
    await other
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    const history = await (await page.request.get("/api/admin/history")).json();
    ({ state } = await (await page.request.get("/api/state")).json());
    const restored = await page.request.post("/api/admin/restore", {
      headers: { Origin: "http://localhost:8790" },
      data: {
        id: history.snapshots[0].id,
        version: state.version,
      },
    });
    expect(restored.status()).toBe(200);
    await expect(
      other.locator(`#term-select option[value="${term.id}"]`),
    ).toHaveCount(1);
    await other.locator("#term-select").selectOption(term.id);
    await other
      .getByRole("button", { name: "Edit Collab Beta", exact: true })
      .click();
    await other
      .getByRole("button", { name: "Restore draft", exact: true })
      .click();
    await expect(other.getByLabel("Genres", { exact: true })).toHaveValue(
      "Draft kept through board removal",
    );
    await other
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(other.locator("#dialog")).not.toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
