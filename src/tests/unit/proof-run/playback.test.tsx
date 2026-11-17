import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CopyTextButton } from "@/components/marketing/proof-run/CopyTextButton";
import { ProofRunPlayback } from "@/components/marketing/proof-run/ProofRunPlayback";
import { transcriptMatchesRecipe } from "@/components/marketing/proof-run/ProofRunSection";
import { recipeHash } from "@/lib/proof-run/hash";
import { capturedRun, engineeringUpdateRecipe } from "@/lib/proof-run/recipe";

function stubReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => stubReducedMotion(false));

function panel() {
  return screen.getByRole("tabpanel");
}

describe("ProofRunPlayback", () => {
  it("starts on the first attempt: allowed, executed once, with a receipt", () => {
    render(<ProofRunPlayback recipeHashMatches={false} />);
    expect(screen.getByRole("tab", { name: /^Post to #engineering/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const result = within(panel());
    expect(result.getByTestId("proof-run-outcome")).toHaveTextContent("Executed");
    expect(result.getByText("Allowed")).toBeInTheDocument();
    expect(result.getByTestId("proof-run-dispatch")).toHaveTextContent("Reached the provider once");
    expect(result.getByTestId("proof-run-receipt")).toHaveTextContent(
      capturedRun.attempts[0].receipt!.receiptId,
    );
    expect(result.getByText("#engineering")).toBeInTheDocument();
  });

  it("shows #general as blocked before dispatch, with the reason in words", async () => {
    const user = userEvent.setup();
    render(<ProofRunPlayback recipeHashMatches={false} />);
    await user.click(screen.getByRole("tab", { name: /^Post to #general/ }));
    const result = within(panel());
    expect(result.getByTestId("proof-run-outcome")).toHaveTextContent("Blocked before dispatch");
    expect(result.getByText("Denied")).toBeInTheDocument();
    expect(result.getByText("CONSTRAINT_VIOLATION")).toBeInTheDocument();
    expect(result.getByTestId("proof-run-reason")).toHaveTextContent(
      "The destination is pinned to #engineering; #general is outside the contract.",
    );
    expect(result.getByTestId("proof-run-dispatch")).toHaveTextContent(
      "Not dispatched — blocked before the provider",
    );
    expect(result.getByTestId("proof-run-receipt")).toHaveTextContent("no receipt");
  });

  it("moves between attempts with the arrow keys, Home and End, and resets", async () => {
    const user = userEvent.setup();
    render(<ProofRunPlayback recipeHashMatches={false} />);
    screen.getByRole("tab", { name: /^Post to #engineering/ }).focus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /^Post to #general/ })).toHaveFocus();
    expect(screen.getByRole("tab", { name: /^Post to #general/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    const email = screen.getByRole("tab", { name: /^Send an email/ });
    expect(email).toHaveFocus();
    expect(within(panel()).getByTestId("proof-run-reason")).toHaveTextContent(
      "Email is not part of this task's contract.",
    );
    expect(screen.getByTestId("proof-run-progress")).toHaveTextContent("Viewed 3 of 4");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /^Post to #engineering/ })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(email).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("tab", { name: /^Post to #engineering/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("proof-run-progress")).toHaveTextContent("Viewed 1 of 4");
    // Roving tabindex: only the selected tab is in the tab order.
    expect(screen.getAllByRole("tab").filter((t) => t.tabIndex === 0)).toHaveLength(1);
  });

  it("says a second post is refused because the budget is spent, in the same task", async () => {
    const user = userEvent.setup();
    render(<ProofRunPlayback recipeHashMatches={false} />);
    await user.click(screen.getByRole("tab", { name: /^Post again to #engineering/ }));
    const result = within(panel());
    expect(result.getByText("INVOCATION_LIMIT_REACHED")).toBeInTheDocument();
    expect(result.getByText(/Same task, right after/)).toBeInTheDocument();
  });

  it("the checked-in transcript is a local-fixture capture of the recipe as it is now", () => {
    // Change the recipe and this fails until `npm run authority -- demo --capture` records a new run.
    expect(capturedRun.source).toBe("local-fixture");
    expect(capturedRun.recipeHash).toBe(recipeHash(engineeringUpdateRecipe));
    expect(capturedRun.attempts.map((a) => a.id)).toEqual(engineeringUpdateRecipe.attempts.map((a) => a.id));
  });

  it("labels the illustrative transcript and shows no stale warning", () => {
    const transcript = { ...capturedRun, source: "illustrative" as const, recipeHash: "" };
    render(<ProofRunPlayback recipeHashMatches={false} transcript={transcript} />);
    expect(screen.getByText("Example run · No accounts connected")).toBeInTheDocument();
    expect(screen.getByTestId("proof-run-source")).toHaveTextContent("Illustrative transcript");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("warns when a captured run does not match the current recipe", () => {
    const transcript = { ...capturedRun, source: "local-fixture" as const, recipeHash: "0".repeat(64) };
    render(<ProofRunPlayback recipeHashMatches={false} transcript={transcript} />);
    expect(screen.getByTestId("proof-run-source")).toHaveTextContent("Captured from the local fixture run");
    expect(screen.getByRole("note")).toHaveTextContent(
      "Recipe changed since this run was captured — this run does not cover the new scope.",
    );
  });

  it("animates a change of outcome, but not under reduced motion", async () => {
    const user = userEvent.setup();
    const first = render(<ProofRunPlayback recipeHashMatches={false} />);
    await user.click(screen.getByRole("tab", { name: /^Post to #general/ }));
    expect(panel().querySelector(".proof-run-enter")).not.toBeNull();
    first.unmount();

    stubReducedMotion(true);
    render(<ProofRunPlayback recipeHashMatches={false} />);
    await user.click(screen.getByRole("tab", { name: /^Post to #general/ }));
    expect(panel().querySelector(".proof-run-enter, .proof-run-stamp-block")).toBeNull();
    expect(within(panel()).getByTestId("proof-run-outcome")).toHaveTextContent("Blocked before dispatch");
  });

  it("has no form inputs", () => {
    const { container } = render(<ProofRunPlayback recipeHashMatches />);
    expect(container.querySelectorAll("input, textarea, select, form")).toHaveLength(0);
  });
});

describe("transcriptMatchesRecipe", () => {
  it("compares the transcript's hash with the shared recipe hash", () => {
    expect(transcriptMatchesRecipe()).toBe(capturedRun.recipeHash === recipeHash(engineeringUpdateRecipe));
  });
});

describe("CopyTextButton", () => {
  it("copies the text and announces it", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<CopyTextButton text="npm run authority -- demo" label="Copy regression test" />);
    await user.click(screen.getByRole("button", { name: "Copy regression test" }));
    expect(writeText).toHaveBeenCalledWith("npm run authority -- demo");
    expect(screen.getByRole("button")).toHaveTextContent("Copied");
    expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard");
  });

  it("reports a clipboard failure instead of claiming success", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<CopyTextButton text="x" />);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("button")).toHaveTextContent("Copy failed");
  });
});
