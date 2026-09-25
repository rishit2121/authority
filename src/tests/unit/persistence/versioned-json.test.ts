import { describe, expect, it } from "vitest";

import { RepositoryError } from "@/lib/persistence/errors";
import { readVersionedJson } from "@/lib/persistence/versioned-json";

describe("readVersionedJson", () => {
  it("returns the payload when its schemaVersion is in the allowed set", () => {
    const payload = { schemaVersion: 1, values: { a: "b" } };
    expect(readVersionedJson(payload, [1], "test")).toEqual(payload);
  });

  it("accepts any version present in a wider allowed set", () => {
    const payload = { schemaVersion: 2, shape: "new" };
    expect(readVersionedJson(payload, [1, 2], "test")).toEqual(payload);
  });

  describe("rejects an unrecognized schema version", () => {
    it("rejects a version number not in the allowed set", () => {
      expect(() => readVersionedJson({ schemaVersion: 2, values: {} }, [1], "test")).toThrow(RepositoryError);
    });

    it("rejects a missing schemaVersion entirely", () => {
      expect(() => readVersionedJson({ values: {} }, [1], "test")).toThrow(RepositoryError);
    });

    it("rejects a non-numeric schemaVersion", () => {
      expect(() => readVersionedJson({ schemaVersion: "1", values: {} }, [1], "test")).toThrow(
        RepositoryError,
      );
      expect(() => readVersionedJson({ schemaVersion: null, values: {} }, [1], "test")).toThrow(
        RepositoryError,
      );
    });

    it("includes the offending context and known versions in the message", () => {
      try {
        readVersionedJson({ schemaVersion: 99 }, [1, 2], "widgets.shape");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(RepositoryError);
        expect((error as RepositoryError).code).toBe("invalid_row");
        expect((error as RepositoryError).message).toContain("widgets.shape");
        expect((error as RepositoryError).message).toContain("99");
        expect((error as RepositoryError).message).toContain("1, 2");
      }
    });
  });

  describe("rejects a malformed payload shape", () => {
    it("rejects null", () => {
      expect(() => readVersionedJson(null, [1], "test")).toThrow(RepositoryError);
    });

    it("rejects a bare array", () => {
      expect(() => readVersionedJson([1, 2, 3], [1], "test")).toThrow(RepositoryError);
    });

    it("rejects a primitive", () => {
      expect(() => readVersionedJson("not an object", [1], "test")).toThrow(RepositoryError);
      expect(() => readVersionedJson(42, [1], "test")).toThrow(RepositoryError);
      expect(() => readVersionedJson(undefined, [1], "test")).toThrow(RepositoryError);
    });
  });
});
