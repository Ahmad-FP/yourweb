import { describe, expect, it } from "vitest";
import { createPresetFork } from "../composition/presets";
import { createExportBundle, validateImportBundle } from "./export";

describe("portable configuration bundles", () => {
  it("omits personal records by default and validates the round trip", () => {
    const bundle = createExportBundle({
      configuration: createPresetFork("minimal"),
      activeSurfaceId: "discover",
      planRevision: 0,
      planEntries: [],
      favorites: [],
      customRecords: [{ id: "private", collectionId: "private", values: { note: "secret" }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }],
      history: [],
      activity: [],
    }, false);
    expect(bundle.customRecords).toBeUndefined();
    expect(validateImportBundle(bundle).ok).toBe(true);
  });

  it("rejects code-shaped component payloads", () => {
    const bundle = {
      format: "yourweb-bundle",
      formatVersion: 1,
      capabilityVersion: 1,
      configuration: {
        ...createPresetFork("minimal"),
        surfaces: [{ id: "unsafe", title: "Unsafe", order: 0, root: { id: "script", kind: "html", html: "<script />" } }],
      },
    };
    expect(validateImportBundle(bundle).ok).toBe(false);
  });
});
