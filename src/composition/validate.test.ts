import { beforeEach, describe, expect, it } from "vitest";
import { demoOperations } from "../test/demoConfiguration";
import { createUserLayer } from "./layer";
import {
  applyOperations,
  approveConfigurationPreview,
  clearConfigurationPreviews,
  consumeConfigurationPreview,
  createConfigurationPreview,
  getLatestConfigurationPreview,
} from "./operations";
import type { UIChangeOperation } from "./types";
import { validateOperations, validateUserLayer } from "./validate";

/** The demo batch inserts a meal list beside the calendar; bindings below need it in place. */
const insertPicker = demoOperations.find((operation) => operation.op === "insert_into_slot")!;

const previewOf = (operations: UIChangeOperation[], layer = createUserLayer()) =>
  createConfigurationPreview(layer, operations, layer.revision);

describe("bounded composition grammar", () => {
  beforeEach(clearConfigurationPreviews);

  it("accepts the demo target configuration as one atomic batch", () => {
    const result = previewOf(demoOperations);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.layer.surfaces.map((surface) => surface.id)).toEqual(["today"]);
    expect(result.preview.layer.collections.map((collection) => collection.id)).toEqual(["intake-log"]);
    expect(result.preview.layer.interactions.map((interaction) => interaction.id)).toEqual(["plan-by-dragging", "log-by-dragging"]);
    expect(result.preview.diff.summary).toContain("drag-and-drop");
  });

  it("requires approval before a preview can be committed", () => {
    const result = previewOf(demoOperations);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const base = createUserLayer();
    expect(consumeConfigurationPreview(result.preview.id, base.revision)).toMatchObject({ ok: false, code: "preview_not_approved" });
    expect(approveConfigurationPreview(result.preview.id)).toBe(true);
    expect(getLatestConfigurationPreview()?.approvedAt).toEqual(expect.any(Number));
    expect(consumeConfigurationPreview(result.preview.id, base.revision).ok).toBe(true);
  });

  it("refuses a preview built against a stale revision", () => {
    const layer = createUserLayer();
    expect(createConfigurationPreview(layer, demoOperations, layer.revision + 5)).toMatchObject({ ok: false, code: "stale_configuration" });
  });

  it("fails closed on an unknown component kind", () => {
    const result = previewOf([
      { op: "upsert_surface", surface: { id: "unsafe", title: "Unsafe", order: 4, root: { id: "unsafe-root", kind: "html", html: "<script>alert(1)</script>" } } } as unknown as UIChangeOperation,
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects unknown fields instead of widening the grammar", () => {
    const result = validateOperations([{ op: "upsert_surface", surface: { id: "broken" }, execute: "fetch('/')" }]);
    expect(result.ok).toBe(false);
  });

  it("rejects a saved layer carrying an arbitrary extra property", () => {
    const result = validateUserLayer({ ...createUserLayer(), arbitraryCode: "alert(1)" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path === "/arbitraryCode")).toBe(true);
  });

  it("refuses an interaction whose source cannot be dragged", () => {
    const result = previewOf([
      {
        op: "bind_interaction",
        interaction: {
          id: "bad-source",
          label: "Drag the grocery list",
          source: { componentId: "week-groceries", type: "meal", payload: { mealId: { op: "field", name: "id" } } },
          target: { componentId: "week-calendar", accepts: ["meal"], action: { id: "add_meal_to_plan", args: { mealId: { op: "dragged", name: "mealId" }, date: { op: "cell", name: "date" }, slot: { op: "cell", name: "slot" } } } },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.issues)).toContain("not a drag source");
  });

  it("refuses a drop bound to an action the target does not allow", () => {
    const result = previewOf([
      insertPicker,
      {
        op: "bind_interaction",
        interaction: {
          id: "bad-action",
          label: "Favourite by dragging onto the week",
          source: { componentId: "week-picker", type: "meal", payload: { mealId: { op: "field", name: "id" } } },
          target: { componentId: "week-calendar", accepts: ["meal"], action: { id: "favorite_meal", args: { mealId: { op: "dragged", name: "mealId" } } } },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.issues)).toContain("cannot run 'favorite_meal'");
  });

  it("refuses a drop action reading a value the drag never carries", () => {
    const result = previewOf([
      insertPicker,
      {
        op: "bind_interaction",
        interaction: {
          id: "bad-payload",
          label: "Drag a meal onto a day",
          source: { componentId: "week-picker", type: "meal", payload: { mealId: { op: "field", name: "id" } } },
          target: { componentId: "week-calendar", accepts: ["meal"], action: { id: "add_meal_to_plan", args: { mealId: { op: "dragged", name: "somethingElse" }, date: { op: "cell", name: "date" }, slot: { op: "cell", name: "slot" } } } },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.issues)).toContain("does not carry 'somethingElse'");
  });

  it("refuses a binding whose two halves sit on different screens", () => {
    const result = previewOf([
      demoOperations[0]!,
      demoOperations[1]!,
      {
        op: "bind_interaction",
        interaction: {
          id: "cross-screen",
          label: "Drag across screens",
          source: { componentId: "discover-meals", type: "meal", payload: { mealId: { op: "field", name: "id" } } },
          target: { componentId: "week-calendar", accepts: ["meal"], action: { id: "add_meal_to_plan", args: { mealId: { op: "dragged", name: "mealId" }, date: { op: "cell", name: "date" }, slot: { op: "cell", name: "slot" } } } },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.issues)).toContain("cannot cross screens");
  });

  it("refuses dragged and cell expressions outside an interaction", () => {
    const result = previewOf([
      {
        op: "insert_into_slot",
        slotId: "week-root",
        node: { id: "leaky-metric", kind: "metric", label: "Leak", value: { op: "dragged", name: "mealId" } },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.issues)).toContain("only available inside an interaction");
  });

  it("refuses a log_record drop that skips a required field", () => {
    const result = previewOf([
      demoOperations[0]!,
      demoOperations[1]!,
      {
        op: "bind_interaction",
        interaction: {
          id: "incomplete-log",
          label: "Log by dragging",
          source: { componentId: "today-picker", type: "meal", payload: { mealId: { op: "field", name: "id" } } },
          target: {
            componentId: "today-entries",
            accepts: ["meal"],
            action: { id: "log_record", args: { collectionId: { op: "literal", value: "intake-log" }, values: { meal: { op: "dragged", name: "mealId" } } } },
          },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(JSON.stringify(result.issues)).toContain("is required by intake-log");
  });

  it("rejects a duplicate element id rather than shadowing a base element", () => {
    const result = previewOf([
      { op: "insert_into_slot", slotId: "week-root", node: { id: "week-calendar", kind: "text", text: "shadow" } },
    ]);
    expect(result).toMatchObject({ ok: false, code: "duplicate_id" });
  });

  it("archives a record type instead of destroying it, and unbinds what depended on it", () => {
    const applied = applyOperations(createUserLayer(), demoOperations);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applyOperations(applied.layer, [{ op: "remove_collection", collectionId: "intake-log" }])).toMatchObject({
      ok: false,
      code: "record_type_in_use",
    });

    const removed = applyOperations(applied.layer, [
      { op: "remove_surface", surfaceId: "today" },
      { op: "remove_collection", collectionId: "intake-log" },
    ]);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.layer.collections[0]).toMatchObject({ id: "intake-log", archived: true });
    expect(removed.layer.collections[0]?.fields).toHaveLength(3);
    expect(removed.layer.interactions.map((interaction) => interaction.id)).toEqual(["plan-by-dragging"]);
  });

  it("restores a hidden base element with show_element", () => {
    const hidden = applyOperations(createUserLayer(), [{ op: "hide_element", targetId: "week-metrics" }]);
    expect(hidden.ok).toBe(true);
    if (!hidden.ok) return;
    const shown = applyOperations(hidden.layer, [{ op: "show_element", targetId: "week-metrics" }]);
    expect(shown.ok).toBe(true);
    if (shown.ok) expect(shown.layer.patches).toEqual([]);
  });
});
