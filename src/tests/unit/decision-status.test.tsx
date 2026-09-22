import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DecisionStatusBadge } from "@/components/ui/DecisionStatusBadge";
import {
  DECISION_STATUS_ORDER,
  allDecisionStatusPresentations,
  presentDecisionStatus,
} from "@/lib/authorization";
import type { DecisionStatus } from "@/lib/domain";

const ALL_STATUSES: DecisionStatus[] = [
  "allow",
  "allow_constrained",
  "replan",
  "clarify",
  "require_approval",
  "deny",
];

describe("decision status presentation", () => {
  it("provides a presentation for every status", () => {
    for (const status of ALL_STATUSES) {
      const presentation = presentDecisionStatus(status);
      expect(presentation.status).toBe(status);
      expect(presentation.label.length).toBeGreaterThan(0);
      expect(presentation.description.length).toBeGreaterThan(0);
    }
  });

  it("marks only allow and allow_constrained as permitting execution", () => {
    const permitting = ALL_STATUSES.filter((s) => presentDecisionStatus(s).permitsExecution);
    expect(permitting).toEqual(["allow", "allow_constrained"]);
  });

  it("gives denial and approval distinct tones from success", () => {
    expect(presentDecisionStatus("allow").tone).toBe("positive");
    expect(presentDecisionStatus("allow_constrained").tone).toBe("constrained");
    expect(presentDecisionStatus("deny").tone).toBe("negative");
    expect(presentDecisionStatus("require_approval").tone).toBe("attention");
  });

  it("enumerates every status exactly once in escalation order", () => {
    expect([...DECISION_STATUS_ORDER].sort()).toEqual([...ALL_STATUSES].sort());
    expect(allDecisionStatusPresentations()).toHaveLength(ALL_STATUSES.length);
  });
});

describe("DecisionStatusBadge", () => {
  it("renders the human label by default", () => {
    render(<DecisionStatusBadge status="allow_constrained" />);
    expect(screen.getByText("Allow constrained")).toBeInTheDocument();
  });

  it("renders the uppercase token in mono mode", () => {
    render(<DecisionStatusBadge status="require_approval" mono />);
    expect(screen.getByText("REQUIRE_APPROVAL")).toBeInTheDocument();
  });

  it("exposes status and tone as data attributes for styling and tests", () => {
    render(<DecisionStatusBadge status="deny" />);
    const badge = screen.getByText("Deny");
    expect(badge).toHaveAttribute("data-status", "deny");
    expect(badge).toHaveAttribute("data-tone", "negative");
  });

  it("describes the status via a title for assistive tech and hover", () => {
    render(<DecisionStatusBadge status="clarify" />);
    expect(screen.getByText("Clarify")).toHaveAttribute(
      "title",
      "User intent is too ambiguous to authorize; clarification is required.",
    );
  });

  it("renders all six statuses without collision", () => {
    render(
      <>
        {ALL_STATUSES.map((status) => (
          <DecisionStatusBadge key={status} status={status} mono />
        ))}
      </>,
    );
    for (const status of ALL_STATUSES) {
      expect(screen.getByText(presentDecisionStatus(status).token)).toBeInTheDocument();
    }
  });
});
