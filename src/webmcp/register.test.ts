import { beforeEach, describe, expect, it } from "vitest";
import { clearConfigurationPreviews } from "../composition/operations";
import { resetDatabaseForTests } from "../data/db";
import { YourWebStore } from "../data/store";
import { compositionFixture } from "../test/fixtures";
import { createWebMCPToolsForTesting } from "./register";

const execute = async (definition: WebMCP.ModelContextTool, input: Record<string, unknown>) => {
  const output = await definition.execute(input, { signal: new AbortController().signal });
  if (typeof output !== "string") throw new Error("YourWeb tools must return bounded JSON strings.");
  return JSON.parse(output) as Record<string, unknown>;
};

describe("WebMCP tool contract", () => {
  beforeEach(async () => {
    clearConfigurationPreviews();
    await resetDatabaseForTests();
  });

  it("exposes ten concise, non-overlapping static tools with explicit mutation hints", async () => {
    const definitions = createWebMCPToolsForTesting(new YourWebStore());
    const names = definitions.map((definition) => definition.name);
    expect(definitions).toHaveLength(10);
    expect(new Set(names).size).toBe(10);
    expect(definitions.every((definition) => definition.name.length <= 30 && definition.description.length <= 500)).toBe(true);
    expect(definitions.find((definition) => definition.name === "search_meals")?.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(definitions.find((definition) => definition.name === "apply_ui_preview")?.annotations?.readOnlyHint).toBe(false);

    const search = definitions.find((definition) => definition.name === "search_meals");
    if (!search) throw new Error("search_meals is missing.");
    const result = await execute(search, { dietaryTags: ["vegan"], minProtein: 18, limit: 3 });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(JSON.stringify(result).length).toBeLessThan(1_500);
  });

  it("reports the developer policy and drag capability of every element in the outline", async () => {
    const store = new YourWebStore();
    await store.initialize();
    const outline = await execute(createWebMCPToolsForTesting(store).find((tool) => tool.name === "get_ui_outline")!, {});
    expect(outline.ok).toBe(true);

    const surfaces = outline.surfaces as Array<Record<string, unknown>>;
    const discover = surfaces.find((surface) => surface.id === "discover")!;
    expect(discover).toMatchObject({ owner: "developer", can: ["hideable", "movable"] });

    const root = discover.tree as Record<string, unknown>;
    expect(root).toMatchObject({ id: "discover-root", can: ["extendable"] });
    const meals = (root.children as Array<Record<string, unknown>>)[0]!;
    expect(meals).toMatchObject({ id: "discover-meals", dragProvides: { type: "meal" } });

    const week = surfaces.find((surface) => surface.id === "week")!;
    const calendar = ((week.tree as Record<string, unknown>).children as Array<Record<string, unknown>>).find((child) => child.id === "week-calendar")!;
    expect(calendar).toMatchObject({ dropAccepts: { cellFields: ["date", "slot"], actions: ["add_meal_to_plan", "remove_meal_from_plan"] } });
  });

  it("refuses to commit a preview the visible app has not approved", async () => {
    const store = new YourWebStore();
    await store.initialize();
    const tools = createWebMCPToolsForTesting(store);
    const staged = await execute(tools.find((tool) => tool.name === "preview_ui_changes")!, { operations: compositionFixture });
    expect(staged.ok).toBe(true);

    const applied = await execute(tools.find((tool) => tool.name === "apply_ui_preview")!, { previewId: staged.previewId });
    expect(applied).toMatchObject({ ok: false, error: { code: "preview_not_approved" } });
    expect(store.getSnapshot().configuration.surfaces.some((surface) => surface.id === "today")).toBe(false);
  });

  it("reports the tools that a committed preview derives", async () => {
    const store = new YourWebStore();
    await store.initialize();
    const tools = createWebMCPToolsForTesting(store);
    const staged = await execute(tools.find((tool) => tool.name === "preview_ui_changes")!, { operations: compositionFixture });
    const { approveConfigurationPreview } = await import("../composition/operations");
    approveConfigurationPreview(String(staged.previewId));

    const applied = await execute(tools.find((tool) => tool.name === "apply_ui_preview")!, { previewId: staged.previewId });
    expect(applied.ok).toBe(true);
    expect(applied.derivedTools).toMatchObject({
      fromRecordTypes: [{ collectionId: "intake-log", tools: ["list_intake_log", "add_intake_log", "remove_intake_log"] }],
      fromInteractions: [{ interactionId: "plan-by-dragging", tool: "run_plan_by_dragging" }, { interactionId: "log-by-dragging", tool: "run_log_by_dragging" }],
    });
  });

  it("refuses an operation batch that targets a protected developer element", async () => {
    const store = new YourWebStore();
    await store.initialize();
    const tools = createWebMCPToolsForTesting(store);
    const staged = await execute(tools.find((tool) => tool.name === "preview_ui_changes")!, {
      operations: [{ op: "remove_surface", surfaceId: "week" }],
    });
    expect(staged).toMatchObject({ ok: false, error: { code: "protected_element" } });
  });

  it("reports every failure through one error envelope, whatever raised it", async () => {
    const store = new YourWebStore();
    await store.initialize();
    const tools = createWebMCPToolsForTesting(store);

    // Rejected by the tool's own argument checks.
    const badInput = await execute(tools.find((tool) => tool.name === "get_meal")!, { mealId: "no-such-meal" });
    // Rejected by the domain layer, which reports { ok: false, code, message }.
    const stale = await execute(tools.find((tool) => tool.name === "update_week_plan")!, {
      changes: [{ date: "2026-03-02", slot: "dinner", mealId: null }],
      expectedRevision: 99,
    });

    for (const failure of [badInput, stale]) {
      expect(failure.ok).toBe(false);
      expect(failure.code).toBeUndefined();
      expect(failure.error).toMatchObject({ code: expect.any(String), message: expect.any(String) });
    }
    expect((badInput.error as Record<string, unknown>).code).toBe("meal_not_found");
    expect((stale.error as Record<string, unknown>).code).toBe("stale_plan");
  });
});
