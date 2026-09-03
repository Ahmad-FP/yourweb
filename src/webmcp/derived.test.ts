import { beforeEach, describe, expect, it } from "vitest";
import { approveConfigurationPreview, clearConfigurationPreviews, createConfigurationPreview } from "../composition/operations";
import { resetDatabaseForTests } from "../data/db";
import { YourWebStore } from "../data/store";
import { demoOperations } from "../test/demoConfiguration";
import { deriveTools, describeDerivedTools } from "./derived";

const call = async (definition: WebMCP.ModelContextTool, input: Record<string, unknown>) => {
  const output = await definition.execute(input, { signal: new AbortController().signal });
  if (typeof output !== "string") throw new Error("YourWeb tools must return bounded JSON strings.");
  return JSON.parse(output) as Record<string, unknown>;
};

const personalisedStore = async () => {
  const store = new YourWebStore();
  await store.initialize();
  const preview = createConfigurationPreview(store.getSnapshot().layer, demoOperations, store.getSnapshot().layer.revision);
  if (!preview.ok) throw new Error(preview.message);
  approveConfigurationPreview(preview.preview.id);
  const applied = await store.applyPreview(preview.preview.id, "agent");
  if (!applied.ok) throw new Error(applied.message);
  return store;
};

describe("tools derived from what the user saved", () => {
  beforeEach(async () => {
    clearConfigurationPreviews();
    await resetDatabaseForTests();
  });

  it("derives nothing before the user has added anything", async () => {
    const store = new YourWebStore();
    await store.initialize();
    expect(deriveTools(store, store.getSnapshot().configuration)).toEqual([]);
  });

  it("derives read and write tools from a saved record schema", async () => {
    const store = await personalisedStore();
    const tools = deriveTools(store, store.getSnapshot().configuration);
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("list_intake_log");
    expect(names).toContain("add_intake_log");
    expect(names).toContain("remove_intake_log");

    const add = tools.find((tool) => tool.name === "add_intake_log")!;
    expect(add.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["date", "meal", "servings"],
      properties: { servings: { type: "number", minimum: 0.25, maximum: 12 } },
    });

    const created = await call(add, { date: "2026-09-03", meal: "miso-salmon-rice", servings: 1 });
    expect(created.ok).toBe(true);

    const listed = await call(tools.find((tool) => tool.name === "list_intake_log")!, {});
    expect(listed).toMatchObject({ ok: true, count: 1 });
  });

  it("enforces the saved schema on a derived write", async () => {
    const store = await personalisedStore();
    const add = deriveTools(store, store.getSnapshot().configuration).find((tool) => tool.name === "add_intake_log")!;
    expect(await call(add, { date: "not-a-date", meal: "miso-salmon-rice", servings: 1 })).toMatchObject({ ok: false });
    expect(await call(add, { date: "2026-09-03", meal: "no-such-meal", servings: 1 })).toMatchObject({ ok: false });
    expect(await call(add, { date: "2026-09-03", meal: "miso-salmon-rice", servings: 1, note: "extra" })).toMatchObject({ ok: false });
    expect(store.recordsFor("intake-log")).toHaveLength(0);
  });

  it("derives one tool per interaction that performs the same drop", async () => {
    const store = await personalisedStore();
    const tools = deriveTools(store, store.getSnapshot().configuration);
    const run = tools.find((tool) => tool.name === "run_plan_by_dragging")!;
    expect(run.inputSchema).toMatchObject({ required: ["itemId", "date", "slot"] });

    const result = await call(run, { itemId: "miso-salmon-rice", date: "2026-09-07", slot: "dinner" });
    expect(result.ok).toBe(true);
    expect(store.getSnapshot().planEntries).toEqual([
      expect.objectContaining({ date: "2026-09-07", slot: "dinner", mealId: "miso-salmon-rice" }),
    ]);
  });

  it("refuses a derived drop with an item the source does not list", async () => {
    const store = await personalisedStore();
    const run = deriveTools(store, store.getSnapshot().configuration).find((tool) => tool.name === "run_plan_by_dragging")!;
    expect(await call(run, { itemId: "not-a-meal", date: "2026-09-07", slot: "dinner" })).toMatchObject({ ok: false });
    expect(await call(run, { itemId: "miso-salmon-rice", date: "2026-09-07", slot: "brunch" })).toMatchObject({ ok: false });
    expect(store.getSnapshot().planEntries).toEqual([]);
  });

  it("refuses to archive a record type a visible screen still shows", async () => {
    const store = await personalisedStore();
    const layer = store.getSnapshot().layer;
    expect(createConfigurationPreview(layer, [{ op: "remove_collection", collectionId: "intake-log" }], layer.revision)).toMatchObject({
      ok: false,
      code: "record_type_in_use",
    });
  });

  it("stops deriving tools once the record type is archived", async () => {
    const store = await personalisedStore();
    const layer = store.getSnapshot().layer;
    const preview = createConfigurationPreview(
      layer,
      [{ op: "remove_surface", surfaceId: "today" }, { op: "remove_collection", collectionId: "intake-log" }],
      layer.revision,
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    approveConfigurationPreview(preview.preview.id);
    await store.applyPreview(preview.preview.id, "agent");

    const names = deriveTools(store, store.getSnapshot().configuration).map((tool) => tool.name);
    expect(names).not.toContain("add_intake_log");
    expect(describeDerivedTools(store.getSnapshot().configuration).fromRecordTypes).toEqual([]);
  });

  it("keeps every derived tool name unique and within the WebMCP naming rules", async () => {
    const store = await personalisedStore();
    const tools = deriveTools(store, store.getSnapshot().configuration);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    expect(tools.every((tool) => /^[A-Za-z0-9_.-]{1,128}$/.test(tool.name))).toBe(true);
    expect(tools.every((tool) => tool.description.length <= 500)).toBe(true);
  });
});
