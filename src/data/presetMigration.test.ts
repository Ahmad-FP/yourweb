import { beforeEach, describe, expect, it } from "vitest";
import { PRESET_REVISION, createPresetFork, presets } from "../composition/presets";
import type { SurfaceDefinition, UIConfiguration } from "../composition/types";
import { validateConfiguration } from "../composition/validate";
import { persistSnapshot, resetDatabaseForTests } from "./db";
import { appStore } from "./store";

const agentSurface: SurfaceDefinition = {
  id: "daily-intake",
  title: "Daily Intake",
  order: 9,
  root: { id: "intake-root", kind: "section", title: "Today", children: [] },
};

/** A fork saved before the copy rewrite: old eyebrow text and no presetRevision. */
const staleFork = (): UIConfiguration => {
  const fork = createPresetFork("dense");
  const overview = fork.surfaces[0]!;
  // an old saved fork has no presetRevision key at all
  delete (fork as { presetRevision?: number }).presetRevision;
  return {
    ...fork,
    surfaces: [
      { ...overview, root: { ...overview.root, eyebrow: "Dense · the full signal", title: "The whole week, without the hunt." } as typeof overview.root },
      ...fork.surfaces.slice(1),
      agentSurface,
    ],
  };
};

const snapshotWith = (configuration: UIConfiguration) => ({
  configuration,
  activeSurfaceId: configuration.surfaces[0]!.id,
  planRevision: 0,
  planEntries: [{ id: "e1", date: "2026-09-01", slot: "dinner" as const, mealId: "miso-salmon-rice", servings: 1, author: "human" as const, updatedAt: "2026-09-01T00:00:00.000Z" }],
  favorites: ["miso-salmon-rice"],
  customRecords: [{ id: "r1", collectionId: "daily-intake", values: { note: "kept" }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }],
  history: [],
  activity: [],
});

describe("shipped preset refresh on load", () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
  });

  it("replaces stale preset copy while keeping assistant-created surfaces and personal data", async () => {
    await persistSnapshot(snapshotWith(staleFork()));
    await appStore.initialize();
    const state = appStore.getSnapshot();

    const serialized = JSON.stringify(state.configuration);
    expect(serialized).not.toContain("the full signal");
    expect(serialized).not.toContain("18 synthetic recipes");

    const overview = state.configuration.surfaces.find((surface) => surface.id === presets.dense.surfaces[0]!.id);
    expect(overview?.root.kind === "section" && overview.root.title).toBe("This week");
    expect(overview?.root.kind === "section" && overview.root.eyebrow).toBeUndefined();

    expect(state.configuration.surfaces.map((surface) => surface.id)).toContain("daily-intake");
    expect(state.customRecords).toHaveLength(1);
    expect(state.planEntries).toHaveLength(1);
    expect(state.favorites).toEqual(["miso-salmon-rice"]);
    expect(state.configuration.presetRevision).toBe(PRESET_REVISION);
    expect(validateConfiguration(state.configuration).ok).toBe(true);
  });

  it("keeps the pre-refresh configuration in history so the change can be undone", async () => {
    await persistSnapshot(snapshotWith(staleFork()));
    await appStore.initialize();
    const state = appStore.getSnapshot();
    expect(state.history.at(-1)?.configuration.surfaces[0]?.root).toMatchObject({ eyebrow: "Dense · the full signal" });
  });

  it("leaves an already-current configuration untouched", async () => {
    const current = createPresetFork("minimal");
    await persistSnapshot(snapshotWith(current));
    await appStore.initialize();
    const state = appStore.getSnapshot();
    expect(state.configuration.version).toBe(current.version);
    expect(state.history).toHaveLength(0);
  });
});
