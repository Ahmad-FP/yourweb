import { describe, expect, it } from "vitest";
import { createUserLayer } from "../composition/layer";
import { applyOperations } from "../composition/operations";
import type { UserLayer } from "../composition/types";
import { compositionFixture } from "../test/fixtures";
import { createExportBundle, validateImportBundle } from "./export";
import type { AppSnapshot } from "./types";

const snapshotWith = (layer: UserLayer): AppSnapshot => ({
  layer,
  activeSurfaceId: "discover",
  planRevision: 0,
  planEntries: [],
  favorites: [],
  customRecords: [{ id: "private", collectionId: "intake-log", values: { note: "secret" }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }],
  history: [],
  activity: [],
});

const personalised = () => {
  const applied = applyOperations(createUserLayer(), compositionFixture);
  if (!applied.ok) throw new Error(applied.message);
  return applied.layer;
};

describe("portable configuration bundles", () => {
  it("carries the user layer and omits personal records by default", () => {
    const bundle = createExportBundle(snapshotWith(personalised()), false);
    expect(bundle.customRecords).toBeUndefined();
    expect(bundle.layer.interactions.map((interaction) => interaction.id)).toEqual(["plan-by-dragging", "log-by-dragging"]);
    expect(JSON.stringify(bundle)).not.toContain("secret");
    expect(validateImportBundle(bundle).ok).toBe(true);
  });

  it("includes records only when explicitly asked", () => {
    const bundle = createExportBundle(snapshotWith(personalised()), true);
    expect(bundle.customRecords).toHaveLength(1);
    expect(validateImportBundle(bundle).ok).toBe(true);
  });

  it("never carries the developer base, so an import cannot redefine it", () => {
    const bundle = createExportBundle(snapshotWith(personalised()), false);
    expect(Object.keys(bundle)).toEqual(["format", "formatVersion", "capabilityVersion", "exportedAt", "layer"]);
    expect(JSON.stringify(bundle.layer)).not.toContain("discover-root");
  });

  it("rejects a bundle whose layer redefines a developer-owned screen", () => {
    const layer = personalised();
    const bundle = {
      ...createExportBundle(snapshotWith(layer), false),
      layer: { ...layer, surfaces: [{ id: "discover", title: "Hijacked", order: 0, root: { id: "hijack-root", kind: "text", text: "mine" } }] },
    };
    const result = validateImportBundle(bundle);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.issues)).toContain("developer base");
  });

  it("rejects code-shaped component payloads", () => {
    const bundle = {
      ...createExportBundle(snapshotWith(createUserLayer()), false),
      layer: { ...createUserLayer(), surfaces: [{ id: "unsafe", title: "Unsafe", order: 0, root: { id: "script", kind: "html", html: "<script />" } }] },
    };
    expect(validateImportBundle(bundle).ok).toBe(false);
  });

  it("rejects a bundle from an older capability version", () => {
    const bundle = { ...createExportBundle(snapshotWith(createUserLayer()), false), capabilityVersion: 1 };
    expect(validateImportBundle(bundle).ok).toBe(false);
  });
});
