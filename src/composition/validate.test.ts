import { beforeEach, describe, expect, it } from "vitest";
import { approveConfigurationPreview, consumeConfigurationPreview, createConfigurationPreview, clearConfigurationPreviews, getLatestConfigurationPreview } from "./operations";
import { createPresetFork } from "./presets";
import type { UIChangeOperation } from "./types";
import { validateConfiguration, validateOperations } from "./validate";

const intakeOperations: UIChangeOperation[] = [
  {
    op: "upsert_collection",
    collection: {
      id: "calorie-entries",
      name: "Calorie entries",
      fields: [
        { id: "date", label: "Date", type: "date", required: true },
        { id: "meal", label: "Meal", type: "mealRef", required: true },
        { id: "servings", label: "Servings", type: "number", required: true, min: 0.25, max: 12, default: 1 },
      ],
    },
  },
  {
    op: "upsert_surface",
    surface: {
      id: "daily-intake",
      title: "Daily Intake",
      icon: "pulse",
      order: 3,
      root: {
        id: "intake-root",
        kind: "section",
        eyebrow: "Created for this table",
        title: "Today's intake",
        children: [
          {
            id: "intake-grid",
            kind: "grid",
            columns: 2,
            children: [
              {
                id: "intake-total",
                kind: "metric",
                label: "Calories today",
                unit: "kcal",
                value: {
                  op: "sum",
                  source: { op: "filter", source: { op: "resource", id: "calorie-entries" }, where: { op: "eq", left: { op: "field", name: "date" }, right: { op: "today" } } },
                  value: { op: "multiply", left: { op: "mealField", mealRefField: "meal", field: "calories" }, right: { op: "field", name: "servings" } },
                },
              },
              { id: "intake-form", kind: "form", collectionId: "calorie-entries", fields: ["date", "meal", "servings"], submitLabel: "Log meal" },
            ],
          },
          { id: "intake-list", kind: "collection", query: { source: "calorie-entries" }, variant: "table", fields: ["date", "meal", "servings"] },
        ],
      },
    },
  },
];

describe("configuration validation and preview", () => {
  beforeEach(clearConfigurationPreviews);

  it("validates both shipped presets", () => {
    const minimal = validateConfiguration(createPresetFork("minimal"));
    const dense = validateConfiguration(createPresetFork("dense"));
    expect(minimal.ok).toBe(true);
    expect(dense.ok).toBe(true);
  });

  it("constructs a new persistent feature from generic primitives", () => {
    const base = createPresetFork("minimal");
    const result = createConfigurationPreview(base, intakeOperations, base.version);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.configuration.surfaces.some((surface) => surface.id === "daily-intake")).toBe(true);
      expect(result.preview.configuration.collections.some((collection) => collection.id === "calorie-entries")).toBe(true);
    }
  });

  it("requires approval and publishes a new preview snapshot when approved", () => {
    const base = createPresetFork("minimal");
    const result = createConfigurationPreview(base, intakeOperations, base.version);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const beforeApproval = getLatestConfigurationPreview();
    expect(consumeConfigurationPreview(result.preview.id, base.version).ok).toBe(false);
    expect(approveConfigurationPreview(result.preview.id)).toBe(true);
    const afterApproval = getLatestConfigurationPreview();
    expect(afterApproval).not.toBe(beforeApproval);
    expect(afterApproval?.approvedAt).toEqual(expect.any(Number));
    expect(consumeConfigurationPreview(result.preview.id, base.version).ok).toBe(true);
  });

  it("fails closed on an unknown component kind", () => {
    const configuration = createPresetFork("minimal") as unknown as Record<string, unknown>;
    const surfaces = configuration.surfaces as Array<Record<string, unknown>>;
    surfaces[0]!.root = { id: "unsafe", kind: "html", html: "<script>alert(1)</script>" };
    expect(validateConfiguration(configuration).ok).toBe(false);
  });

  it("rejects unknown fields instead of widening the configuration grammar", () => {
    const configuration = { ...createPresetFork("minimal"), arbitraryCode: "alert(1)" };
    const result = validateConfiguration(configuration);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.path === "/arbitraryCode")).toBe(true);
  });

  it("rejects malformed operation batches with no partial interpretation", () => {
    const result = validateOperations([{ op: "upsert_surface", surface: { id: "broken" }, execute: "fetch('/')" }]);
    expect(result.ok).toBe(false);
  });
});
