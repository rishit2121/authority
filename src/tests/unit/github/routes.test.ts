import { describe, expect, it } from "vitest";

import { GITHUB_API_ORIGIN } from "@/lib/github/constants";
import { buildUrl, ROUTES, RouteBuildError, type RouteRequest } from "@/lib/github/routes";

describe("fixed route table", () => {
  it("builds every URL on api.github.com over https", () => {
    const req: RouteRequest = {
      route: "getContents",
      params: { owner: "acme", repo: "widgets", path: "src/a b.ts".replace(" ", "_") },
      query: { ref: "main" },
    };
    const { url, method } = buildUrl(req);
    expect(url.origin).toBe(GITHUB_API_ORIGIN);
    expect(url.protocol).toBe("https:");
    expect(method).toBe("GET");
    expect(url.pathname).toBe("/repos/acme/widgets/contents/src/a_b.ts");
  });

  it("has exactly one method per route and never exposes DELETE for repository content", () => {
    const deletes = Object.entries(ROUTES)
      .filter(([, r]) => r.method === "DELETE")
      .map(([id]) => id);
    expect(deletes).toEqual(["deleteInstallation"]);
    // No route can reach secrets, actions, hooks, admin, collaborators, releases or repository deletion.
    for (const r of Object.values(ROUTES)) {
      const joined = r.segments.join("/");
      expect(joined).not.toMatch(
        /secrets|actions|hooks|collaborators|releases|keys|environments|rulesets|protection/,
      );
    }
    expect(Object.keys(ROUTES).sort()).toMatchInlineSnapshot(`
      [
        "createPull",
        "createRef",
        "deleteInstallation",
        "getBranch",
        "getContents",
        "getInstallation",
        "getIssue",
        "getPull",
        "getRef",
        "getRepository",
        "getUserInstallations",
        "listInstallationRepositories",
        "listPulls",
        "mintInstallationToken",
        "putContents",
      ]
    `);
  });

  it("encodes each path segment and refuses anything that could escape the template", () => {
    const attacks = [
      "../admin",
      "a/../b",
      "a/./b",
      "a?x=1",
      "a#f",
      "a%2f..%2f",
      "a\\b",
      "//evil.example",
      "a b",
      "x:y",
      "a\n",
      "",
    ];
    for (const path of attacks) {
      expect(
        () => buildUrl({ route: "getContents", params: { owner: "acme", repo: "widgets", path } }),
        JSON.stringify(path),
      ).toThrow(RouteBuildError);
    }
    for (const owner of ["ac me", "acme/x", "a?b", "..", "a:b", "https://evil.example"]) {
      expect(() => buildUrl({ route: "getRepository", params: { owner, repo: "w" } }), owner).toThrow(
        RouteBuildError,
      );
    }
  });

  it("cannot be redirected to another host by a parameter", () => {
    for (const evil of ["evil.example", "@evil.example", "api.github.com.evil.example", "//evil.example/x"]) {
      let built: URL | null = null;
      try {
        built = buildUrl({ route: "getIssue", params: { owner: evil, repo: "r", number: 1 } }).url;
      } catch {
        // refused — also fine
      }
      if (built) expect(built.origin).toBe(GITHUB_API_ORIGIN);
    }
  });

  it("only accepts declared query parameters", () => {
    expect(() =>
      buildUrl({ route: "getIssue", params: { owner: "a", repo: "b", number: 1 }, query: { per_page: 1 } }),
    ).toThrow(RouteBuildError);
    expect(() =>
      buildUrl({
        route: "getContents",
        params: { owner: "a", repo: "b", path: "x" },
        query: { ref: "main", extra: "1" },
      }),
    ).toThrow(RouteBuildError);
  });

  it("requires every path parameter", () => {
    expect(() => buildUrl({ route: "getIssue", params: { owner: "a", repo: "b" } })).toThrow(RouteBuildError);
  });

  it("refuses an unknown route id", () => {
    expect(() => buildUrl({ route: "deleteRepository" as never })).toThrow(RouteBuildError);
  });
});
