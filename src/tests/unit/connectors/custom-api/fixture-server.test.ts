import { afterEach, describe, expect, it } from "vitest";

import { customApiFixtureServer } from "@/lib/connectors/custom-api/fixture-server";

function req(method: string, path: string, headers: Record<string, string> = {}) {
  return { url: new URL(`https://custom-api-fixture.authority.test${path}`), method, headers };
}

describe("customApiFixtureServer", () => {
  afterEach(() => {
    customApiFixtureServer().reset();
  });

  it("returns a seeded order on GET", async () => {
    const res = await customApiFixtureServer().handle(req("GET", "/v1/orders/4821"));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.bodyText)).toEqual({ id: "4821", status: "pending" });
  });

  it("404s for an unknown order", async () => {
    const res = await customApiFixtureServer().handle(req("GET", "/v1/orders/does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("cancels an order, and a subsequent GET reflects the new status", async () => {
    const cancel = await customApiFixtureServer().handle(req("POST", "/v1/orders/4821/cancel"));
    expect(cancel.status).toBe(200);
    expect(JSON.parse(cancel.bodyText)).toMatchObject({ status: "cancelled" });
    const get = await customApiFixtureServer().handle(req("GET", "/v1/orders/4821"));
    expect(JSON.parse(get.bodyText)).toMatchObject({ status: "cancelled" });
  });

  it("404s for an unrecognized route", async () => {
    const res = await customApiFixtureServer().handle(req("DELETE", "/v1/orders/4821"));
    expect(res.status).toBe(404);
  });

  it("logs every request, including the authorization header presented", async () => {
    await customApiFixtureServer().handle(req("GET", "/v1/orders/4821", { authorization: "Bearer xyz" }));
    const log = customApiFixtureServer().requestLog;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ method: "GET", path: "/v1/orders/4821", authorization: "Bearer xyz" });
  });

  it("reset() clears both order state and the request log", async () => {
    await customApiFixtureServer().handle(req("POST", "/v1/orders/4821/cancel"));
    customApiFixtureServer().reset();
    expect(customApiFixtureServer().requestLog).toHaveLength(0);
    const get = await customApiFixtureServer().handle(req("GET", "/v1/orders/4821"));
    expect(JSON.parse(get.bodyText)).toMatchObject({ status: "pending" });
  });
});
