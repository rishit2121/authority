import { describe, expect, it } from "vitest";

import {
  normalizeRepositoryPath,
  parsePositiveInt,
  parseRepositoryFullName,
  taskBranchPrefix,
  validateReadRef,
  validateTaskBranch,
} from "@/lib/github/validation";

const TASK = "dd000000-0000-4000-8000-000000000012";
const P = taskBranchPrefix(TASK);

describe("repository full name", () => {
  it("accepts owner/name and rejects everything else", () => {
    expect(parseRepositoryFullName("acme/widgets")).toMatchObject({ ok: true, value: { owner: "acme", name: "widgets" } });
    for (const bad of ["acme", "acme/", "/widgets", "a/b/c", "acme/..", "acme/.", "-acme/x", "acme/wid gets", "acme/x?y=1", "https://github.com/a/b", "acme\\x", "", null, 5]) {
      expect(parseRepositoryFullName(bad as never).ok, String(bad)).toBe(false);
    }
  });
});

describe("file paths", () => {
  it("normalizes plain paths", () => {
    expect(normalizeRepositoryPath("src/a/b.ts")).toEqual({ ok: true, value: "src/a/b.ts" });
    expect(normalizeRepositoryPath("README.md")).toEqual({ ok: true, value: "README.md" });
  });

  it("rejects traversal in every encoding", () => {
    const cases: Array<[string, string]> = [
      ["../etc/passwd", "PATH_TRAVERSAL"],
      ["a/../b", "PATH_TRAVERSAL"],
      ["./a", "PATH_TRAVERSAL"],
      ["a//b", "PATH_TRAVERSAL"],
      ["/abs", "PATH_INVALID"],
      ["a/", "PATH_INVALID"],
      ["a\\..\\b", "PATH_AMBIGUOUS"],
      ["%2e%2e/x", "PATH_AMBIGUOUS"],
      ["a/%2E%2E/b", "PATH_AMBIGUOUS"],
      ["%252e%252e/x", "PATH_AMBIGUOUS"],
      ["a%2Fb", "PATH_AMBIGUOUS"],
      ["a\u0000b", "PATH_AMBIGUOUS"],
      ["a‮b", "PATH_AMBIGUOUS"],
      ["ｆｉｌｅ", "PATH_AMBIGUOUS"],
      ["a b", "PATH_INVALID"],
      [".git/config", "PATH_FORBIDDEN"],
      ["x/.GIT/hooks", "PATH_FORBIDDEN"],
      [".github/workflows/ci.yml", "PATH_FORBIDDEN"],
      [".GitHub/Workflows/ci.yml", "PATH_FORBIDDEN"],
      ["a".repeat(241), "PATH_INVALID"],
      ["", "PATH_INVALID"],
    ];
    for (const [input, code] of cases) expect(normalizeRepositoryPath(input), input).toEqual({ ok: false, code });
  });

  it("allows other dot-directories", () => {
    expect(normalizeRepositoryPath(".github/CODEOWNERS").ok).toBe(true);
  });
});

describe("task branches", () => {
  it("derives a deterministic namespace from the task id", () => {
    expect(P).toBe("authority/dd000000/");
  });

  it("accepts branches inside the namespace", () => {
    for (const tail of ["fix", "fix-login", "a/b", "a/b/c", "v1.2"]) expect(validateTaskBranch(`${P}${tail}`, TASK).ok, tail).toBe(true);
  });

  it("rejects escapes, defaults, protected names and malformed refs", () => {
    const cases: Array<[unknown, string]> = [
      ["main", "BRANCH_OUTSIDE_TASK_NAMESPACE"],
      ["master", "BRANCH_OUTSIDE_TASK_NAMESPACE"],
      ["release/1.0", "BRANCH_OUTSIDE_TASK_NAMESPACE"],
      ["authority/other/x", "BRANCH_OUTSIDE_TASK_NAMESPACE"],
      ["authority/dd000000", "BRANCH_OUTSIDE_TASK_NAMESPACE"],
      ["refs/heads/authority/dd000000/x", "BRANCH_OUTSIDE_TASK_NAMESPACE"],
      [`${P}../main`, "BRANCH_INVALID"],
      [`${P}x/../../main`, "BRANCH_INVALID"],
      [`${P}`, "BRANCH_INVALID"],
      [`${P}X`, "BRANCH_INVALID"],
      [`${P}x.lock`, "BRANCH_INVALID"],
      [`${P}x@{1}`, "BRANCH_INVALID"],
      [`${P}x y`, "BRANCH_INVALID"],
      [`${P}x%2e`, "BRANCH_INVALID"],
      [`${P}${"a".repeat(130)}`, "BRANCH_INVALID"],
      [42, "BRANCH_INVALID"],
    ];
    for (const [input, code] of cases) expect(validateTaskBranch(input, TASK), String(input)).toEqual({ ok: false, code });
  });

  it("does not let one task write into another task's namespace", () => {
    expect(validateTaskBranch(`${taskBranchPrefix("aa000000-0000-4000-8000-000000000001")}x`, TASK).ok).toBe(false);
  });
});

describe("read refs and numbers", () => {
  it("validates read refs", () => {
    expect(validateReadRef("main").ok).toBe(true);
    expect(validateReadRef("release/1.0").ok).toBe(true);
    for (const bad of ["", "..", "a..b", "-x", "a b", "a%2e", "x".repeat(201)]) expect(validateReadRef(bad).ok, bad).toBe(false);
  });

  it("parses positive integers strictly", () => {
    expect(parsePositiveInt("12")).toEqual({ ok: true, value: 12 });
    expect(parsePositiveInt(12)).toEqual({ ok: true, value: 12 });
    for (const bad of ["0", "-1", "1.5", "1e3", "abc", "12345678901", "", null, 1.5, Number.NaN]) expect(parsePositiveInt(bad as never).ok, String(bad)).toBe(false);
  });
});
