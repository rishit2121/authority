import { expect, test, type Page } from "@playwright/test";

import { DEMO_COMMANDS, REGRESSION_COMMAND, REPO_URL } from "../../lib/proof-run/commands";

import { signIn } from "./support/auth";
import { OWNER_A } from "./support/users";

/**
 * The marketing flow: one scenario ("Post one update in #engineering. Don't email anyone.") from the hero, through
 * the Proof Run playback, to /demo and /how-it-works. Assertions are on content and state, never on animation timing
 * or exact pixel positions.
 */

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

function playback(page: Page) {
  return page.locator("#proof-run").getByTestId("proof-run-playback");
}

test.describe("home page", () => {
  test("shows the headline, the supporting line and a page title", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Give your agent tools. Set the limits.",
    );
    await expect(
      page.getByText(
        "Decide what an agent can do for each task. Authority checks the tool, the destination and the usage limit before the call runs.",
      ),
    ).toBeVisible();
    await expect(page).toHaveTitle("Authority — Give your agent tools. Set the limits.");
  });

  test("hero actions point at the in-page proof run and at setup", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator("#top");
    await expect(hero.getByRole("link", { name: "Try a protected call" })).toHaveAttribute(
      "href",
      "#proof-run",
    );
    await expect(hero.getByRole("link", { name: "Set up my agent" })).toHaveAttribute("href", "/app/setup");

    await hero.getByRole("link", { name: "Try a protected call" }).click();
    await expect(page).toHaveURL(/#proof-run$/);
    await expect(page.locator("#proof-run")).toBeInViewport();
  });

  test("Set up my agent sends a signed-out visitor to sign in", async ({ page }) => {
    await page.goto("/");
    await page.locator("#top").getByRole("link", { name: "Set up my agent" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("the hero shows the real demo commands and the task scope", async ({ page }) => {
    await page.goto("/");
    const commands = page.getByTestId("hero-commands");
    for (const command of DEMO_COMMANDS) await expect(commands).toContainText(command);
    await expect(commands).not.toContainText("npx @authority");

    const scope = page.getByTestId("hero-scope");
    await expect(scope).toContainText("slack.post_message");
    await expect(scope).toContainText("#engineering (pinned)");
    await expect(scope).toContainText("written by the agent");
    await expect(scope).toContainText("1 post");
    await expect(scope).toContainText("email");
  });

  test("the action flow states both outcomes in words", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Post to #engineering · allowed")).toBeVisible();
    await expect(page.getByText("Post to #general · blocked before dispatch")).toBeVisible();
  });

  test("the hero's copy button copies the commands and says Copied", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    const copy = page.getByTestId("hero-commands-copy");
    await copy.click();
    await expect(copy).toHaveText("Copied");
    await expect(page.getByTestId("hero-commands").getByRole("status")).toHaveText("Copied to clipboard");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(DEMO_COMMANDS.join("\n"));
  });
});

test.describe("proof run playback", () => {
  test("is labeled as an example with no accounts connected", async ({ page }) => {
    await page.goto("/");
    await expect(playback(page).getByText("Example run · No accounts connected")).toBeVisible();
    await expect(playback(page).getByTestId("proof-run-source")).toHaveText(
      /Illustrative transcript|Captured from the local fixture run/,
    );
  });

  test("starts on Post to #engineering: executed, with a receipt", async ({ page }) => {
    await page.goto("/");
    const run = playback(page);
    await expect(run.getByRole("tab", { name: /^Post to #engineering/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const result = run.getByRole("tabpanel");
    await expect(result.getByTestId("proof-run-outcome")).toHaveText("Executed");
    await expect(result.getByTestId("proof-run-dispatch")).toHaveText("Reached the provider once");
    await expect(result.getByTestId("proof-run-receipt")).toContainText("rcpt_");
  });

  test("selecting Post to #general shows Blocked before dispatch and the reason", async ({ page }) => {
    await page.goto("/");
    const run = playback(page);
    await run.getByRole("tab", { name: /^Post to #general/ }).click();
    const result = run.getByRole("tabpanel");
    await expect(result.getByTestId("proof-run-outcome")).toHaveText("Blocked before dispatch");
    await expect(result.getByTestId("proof-run-reason")).toHaveText(
      "The destination is pinned to #engineering; #general is outside the contract.",
    );
    await expect(result.getByTestId("proof-run-dispatch")).toHaveText(
      "Not dispatched — blocked before the provider",
    );

    await run.getByRole("tab", { name: /^Post to #engineering/ }).click();
    await expect(result.getByTestId("proof-run-outcome")).toHaveText("Executed");
    await expect(result.getByTestId("proof-run-receipt")).toContainText("rcpt_");
  });

  test("attempts switch with the keyboard, and Reset returns to the first", async ({ page }) => {
    await page.goto("/");
    const run = playback(page);
    const first = run.getByRole("tab", { name: /^Post to #engineering/ });
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(run.getByRole("tab", { name: /^Post to #general/ })).toBeFocused();
    await expect(run.getByRole("tab", { name: /^Post to #general/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("End");
    await expect(run.getByRole("tab", { name: /^Send an email/ })).toHaveAttribute("aria-selected", "true");
    await expect(run.getByRole("tabpanel").getByTestId("proof-run-reason")).toHaveText(
      "Email is not part of this task's contract.",
    );
    await expect(run.getByTestId("proof-run-progress")).toHaveText("Viewed 3 of 4");

    const { outlineStyle } = await run
      .getByRole("tab", { name: /^Send an email/ })
      .evaluate((el) => ({ outlineStyle: getComputedStyle(el).outlineStyle }));
    expect(outlineStyle).not.toBe("none");

    await run.getByRole("button", { name: "Reset" }).click();
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(run.getByTestId("proof-run-progress")).toHaveText("Viewed 1 of 4");
  });

  test("makes no network request when an attempt is selected", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const requests: string[] = [];
    // Next's own link prefetches (RSC payloads, chunks) are navigation plumbing, not the playback.
    page.on("request", (request) => {
      const url = request.url();
      if (!url.includes("_rsc=") && !url.includes("/_next/")) requests.push(url);
    });
    const run = playback(page);
    for (const name of [/^Post to #general/, /^Post again/, /^Send an email/]) {
      await run.getByRole("tab", { name }).click();
    }
    expect(requests).toEqual([]);
  });

  test("offers the quickstart, the regression command and the recipe file", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    const section = page.locator("#proof-run");
    await expect(section.getByRole("link", { name: "Use this in my app" })).toHaveAttribute(
      "href",
      "/docs/quickstart",
    );
    await expect(section.getByRole("link", { name: "View the recipe on GitHub" })).toHaveAttribute(
      "href",
      `${REPO_URL}/blob/main/examples/proof-run/engineering-update.json`,
    );
    const copy = section.getByTestId("copy-regression");
    await copy.click();
    await expect(copy).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(REGRESSION_COMMAND);
  });

  test("stays fully readable with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const run = playback(page);
    await run.getByRole("tab", { name: /^Post to #general/ }).click();
    await expect(run.getByRole("tabpanel").getByTestId("proof-run-outcome")).toHaveText(
      "Blocked before dispatch",
    );
    await expect(page.locator(".proof-run-enter")).toHaveCount(0);
    const animation = await page
      .locator(".action-flow-march")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
  });
});

test.describe("layout and navigation", () => {
  for (const width of [390, 360]) {
    test(`the home page has no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await expectNoHorizontalOverflow(page);
    });

    for (const route of ["/demo", "/how-it-works"]) {
      test(`${route} has no horizontal overflow at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(route);
        await page.waitForLoadState("networkidle");
        await expectNoHorizontalOverflow(page);
      });
    }
  }

  test("on a phone, the headline, primary action and commands come before the scope", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/");
    const top = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!.y;
    const h1 = await top(page.getByRole("heading", { level: 1 }));
    const cta = await top(page.locator("#top").getByRole("link", { name: "Try a protected call" }));
    const commands = await top(page.getByTestId("hero-commands"));
    const scope = await top(page.getByTestId("hero-scope"));
    expect(h1).toBeLessThan(cta);
    expect(cta).toBeLessThan(commands);
    expect(commands).toBeLessThan(scope);
    await expect(page.locator("#top").getByRole("link", { name: "Try a protected call" })).toBeInViewport();
  });

  test("the header has Docs, GitHub, How it works, Sign in and Set up my agent when signed out", async ({
    page,
  }) => {
    await page.goto("/");
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    const github = header.getByRole("link", { name: "GitHub" });
    await expect(github).toHaveAttribute("href", REPO_URL);
    await expect(github).toHaveAttribute("rel", "noopener noreferrer");
    await expect(header.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/how-it-works");
    await expect(header.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    await expect(header.getByRole("link", { name: "Set up my agent" })).toHaveAttribute("href", "/app/setup");
    await expect(header.getByRole("link", { name: "Open console" })).toHaveCount(0);
    await expect(header.getByRole("link", { name: /Authority/ }).first()).toHaveAttribute("href", "/");
  });

  test("the header says Open console when signed in", async ({ page }) => {
    await signIn(page, OWNER_A);
    await page.goto("/");
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Open console" })).toHaveAttribute("href", "/app");
    await expect(header.getByRole("link", { name: "Set up my agent" })).toHaveCount(0);
  });

  test("the mobile menu lists the same links plus the setup action", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/how-it-works");
    await page.getByRole("button", { name: "Open menu" }).click();
    const panel = page.locator("#mobile-nav-panel");
    for (const name of ["Docs", "GitHub", "How it works", "Sign in", "Set up my agent"]) {
      await expect(panel.getByRole("link", { name })).toBeVisible();
    }
  });

  test("footer links are real routes, not in-page hashes", async ({ page }) => {
    await page.goto("/how-it-works");
    const hrefs = await page
      .getByRole("contentinfo")
      .getByRole("link")
      .evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href.startsWith("#")).toBe(false);
  });
});

test.describe("/demo and /how-it-works", () => {
  test("/demo shows the same playback and the commands to run it", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Post one update in #engineering");
    const run = page.getByTestId("proof-run-playback");
    await run.getByRole("tab", { name: /^Post to #general/ }).click();
    await expect(run.getByRole("tabpanel").getByTestId("proof-run-outcome")).toHaveText(
      "Blocked before dispatch",
    );

    const commands = page.getByTestId("demo-commands");
    for (const command of DEMO_COMMANDS) await expect(commands).toContainText(command);
    await expect(page.getByTestId("demo-regression")).toContainText(REGRESSION_COMMAND);
    await expect(page.getByRole("heading", { name: "Run it yourself" })).toBeVisible();
    await expect(page.getByText("Node 22")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What the runner proves" })).toBeVisible();
  });

  test("/how-it-works keeps the architecture sections", async ({ page }) => {
    await page.goto("/how-it-works");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How Authority works");
    await expect(page.locator("#product")).toContainText("The contract decides.");
    await expect(page.locator("#how-it-works")).toContainText("Propose");
    await expect(page.locator("#trace")).toContainText("Every call, checked and recorded.");
    await expect(page.locator("#security")).toContainText("The security model");
  });

  test("the home page links to the architecture page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "How Authority works" }).click();
    await expect(page).toHaveURL(/\/how-it-works$/);
  });

  test("opens the full task investigation and confirms secret access was denied", async ({ page }) => {
    await signIn(page, OWNER_A);

    await page.goto("/app/tasks/demo-task");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Resolve issue #991");

    const boundary = page.locator("#boundary");
    await expect(boundary.getByText("Read repository secrets")).toBeVisible();

    const evidence = page.locator("#evidence");
    await expect(evidence.getByText("FORBIDDEN_RESOURCE")).toBeVisible();
    await expect(evidence.getByText(/github\.get_repository_secret/)).toBeVisible();
    await expect(evidence.getByText("Deny").first()).toBeVisible();
  });
});
