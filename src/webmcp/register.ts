import { mealById } from "../catalog/meals";
import type { DietaryTag, Meal } from "../catalog/types";
import { capabilityCatalog } from "../composition/capabilities";
import { describeInteraction } from "../composition/interactions";
import { createConfigurationPreview } from "../composition/operations";
import { describeCapabilities } from "../composition/policy";
import { operationBatchSchema } from "../composition/schemas";
import type { ComponentNode, ElementInfo, ResolvedSurface } from "../composition/types";
import type { YourWebStore } from "../data/store";
import { deriveGroceryList, searchMeals } from "../domain/mealPlan";
import type { PlanChange } from "../domain/types";
import { deriveTools, describeDerivedTools } from "./derived";

type UnknownRecord = Record<string, unknown>;

const emptyObjectSchema = { type: "object", additionalProperties: false, properties: {} } as const;
const dietaryTags: DietaryTag[] = ["vegetarian", "vegan", "gluten-free", "high-protein", "quick", "dairy-free"];
const mealSlots = ["breakfast", "lunch", "dinner"] as const;

const json = (value: unknown) => JSON.stringify(value);
const fail = (code: string, message: string, details?: unknown) => json({ ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } });
const isRecord = (value: unknown): value is UnknownRecord => Boolean(value && typeof value === "object" && !Array.isArray(value));
const stringValue = (value: unknown, maximum = 120) => (typeof value === "string" && value.length <= maximum ? value : undefined);
const numberValue = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const onlyKeys = (input: UnknownRecord, allowed: readonly string[]) => Object.keys(input).every((key) => allowed.includes(key));
const isIntegerInRange = (value: unknown, minimum: number, maximum: number) => typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;

const compactMeal = (meal: Meal) => ({
  id: meal.id,
  name: meal.name,
  summary: meal.summary,
  cuisine: meal.cuisine,
  mealType: meal.mealType,
  minutes: meal.prepMinutes,
  tags: meal.tags,
  nutrition: { calories: meal.calories, protein: meal.protein, carbs: meal.carbs, fat: meal.fat, fiber: meal.fiber },
  creator: meal.creator.name,
});

const grantedPolicy = (info: ElementInfo | undefined) => {
  if (!info) return {};
  const granted = Object.entries(info.policy).filter(([, allowed]) => allowed).map(([name]) => name);
  return { owner: info.owner, can: granted, ...(info.hidden ? { hidden: true } : {}), ...(info.insertedIntoSlot ? { insertedInto: info.insertedIntoSlot } : {}) };
};

const outlineNode = (
  node: ComponentNode,
  elements: Map<string, ElementInfo>,
  collections: Parameters<typeof describeCapabilities>[1],
): UnknownRecord => {
  const base: UnknownRecord = { id: node.id, kind: node.kind, ...grantedPolicy(elements.get(node.id)), ...describeCapabilities(node, collections) };
  if (node.kind === "section" || node.kind === "grid") base.children = node.children.map((child) => outlineNode(child, elements, collections));
  if (node.kind === "collection") Object.assign(base, { source: node.query.source, variant: node.variant, fields: node.fields });
  if (node.kind === "calendar") base.slots = node.slots;
  if (node.kind === "form") Object.assign(base, { collectionId: node.collectionId, fields: node.fields });
  if (node.kind === "metric" || node.kind === "progress") base.label = node.label;
  if (node.kind === "button") base.action = node.action.id;
  return base;
};

const outlineSurface = (
  surface: ResolvedSurface,
  elements: Map<string, ElementInfo>,
  collections: Parameters<typeof describeCapabilities>[1],
) => ({
  id: surface.id,
  title: surface.title,
  order: surface.order,
  ...grantedPolicy(elements.get(surface.id)),
  tree: outlineNode(surface.root, elements, collections),
});

const tool = (
  name: string,
  title: string,
  description: string,
  inputSchema: object,
  execute: WebMCP.ToolExecuteCallback,
  annotations: WebMCP.ToolAnnotations,
): WebMCP.ModelContextTool => ({ name, title, description, inputSchema, execute, annotations });

const createTools = (store: YourWebStore): WebMCP.ModelContextTool[] => [
  tool(
    "search_meals",
    "Search meals",
    "Find synthetic marketplace meals by text, dietary needs, nutrition, type, or time. Returns compact ids and nutrition; call get_meal for full details.",
    {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", maxLength: 120, description: "Optional name, cuisine, creator, or ingredient-style query." },
        dietaryTags: { type: "array", maxItems: 6, uniqueItems: true, items: { enum: dietaryTags } },
        minProtein: { type: "number", minimum: 0, maximum: 100 },
        maxCalories: { type: "number", minimum: 1, maximum: 2000 },
        mealType: { enum: mealSlots },
        limit: { type: "integer", minimum: 1, maximum: 8 },
      },
    },
    (input) => {
      if (!onlyKeys(input, ["query", "dietaryTags", "minProtein", "maxCalories", "mealType", "limit"])) return fail("invalid_input", "search_meals received an unknown parameter.");
      if ("query" in input && stringValue(input.query) === undefined) return fail("invalid_input", "query must be text no longer than 120 characters.");
      if ("dietaryTags" in input && (!Array.isArray(input.dietaryTags) || input.dietaryTags.length > 6 || !input.dietaryTags.every((tag) => dietaryTags.includes(tag as DietaryTag)))) return fail("invalid_input", "dietaryTags contains an unsupported value.");
      if ("minProtein" in input && (numberValue(input.minProtein) === undefined || Number(input.minProtein) < 0 || Number(input.minProtein) > 100)) return fail("invalid_input", "minProtein must be between 0 and 100.");
      if ("maxCalories" in input && (numberValue(input.maxCalories) === undefined || Number(input.maxCalories) < 1 || Number(input.maxCalories) > 2000)) return fail("invalid_input", "maxCalories must be between 1 and 2000.");
      if ("mealType" in input && !mealSlots.includes(input.mealType as typeof mealSlots[number])) return fail("invalid_input", "mealType must be breakfast, lunch, or dinner.");
      if ("limit" in input && !isIntegerInRange(input.limit, 1, 8)) return fail("invalid_input", "limit must be an integer from 1 to 8.");
      const result = searchMeals({
        query: stringValue(input.query),
        dietaryTags: input.dietaryTags as DietaryTag[] | undefined,
        minProtein: numberValue(input.minProtein),
        maxCalories: numberValue(input.maxCalories),
        mealType: mealSlots.includes(input.mealType as typeof mealSlots[number]) ? (input.mealType as Meal["mealType"]) : undefined,
        limit: numberValue(input.limit) ?? 6,
      });
      return json({ ok: true, count: result.length, meals: result.map(compactMeal), next: result.length ? "Use get_meal with an id for ingredients, method, micronutrients, and discussion." : "Broaden the filters." });
    },
    { readOnlyHint: true, untrustedContentHint: true },
  ),
  tool(
    "get_meal",
    "Get meal details",
    "Read one synthetic marketplace meal by id, including ingredients, method, nutrition, creator, and community discussion.",
    { type: "object", additionalProperties: false, required: ["mealId"], properties: { mealId: { type: "string", maxLength: 48, description: "Meal id returned by search_meals." } } },
    (input) => {
      if (!onlyKeys(input, ["mealId"])) return fail("invalid_input", "get_meal only accepts mealId.");
      const mealId = stringValue(input.mealId, 48);
      const meal = mealId ? mealById.get(mealId) : undefined;
      if (!meal) return fail("meal_not_found", "No meal matches that id. Call search_meals for valid ids.");
      return json({ ok: true, meal: { ...compactMeal(meal), servings: meal.servings, micronutrientsPercentDV: meal.micros, ingredients: meal.ingredients, method: meal.instructions, discussion: meal.discussion } });
    },
    { readOnlyHint: true, untrustedContentHint: true },
  ),
  tool(
    "get_week_plan",
    "Read week plan",
    "Read the browser-local meal plan and revision. Use the revision as expectedRevision when updating it.",
    emptyObjectSchema,
    (input) => {
      if (Object.keys(input).length) return fail("invalid_input", "get_week_plan does not accept parameters.");
      const state = store.getSnapshot();
      return json({ ok: true, revision: state.planRevision, entries: state.planEntries, next: "Use update_week_plan with expectedRevision to make an atomic change." });
    },
    { readOnlyHint: true },
  ),
  tool(
    "update_week_plan",
    "Update week plan",
    "Atomically add, replace, or remove up to 21 browser-local meal slots. A null mealId removes a slot. If a change conflicts with a human-authored meal, relay the returned Are you sure message and retry the exact batch with its token after confirmation.",
    {
      type: "object",
      additionalProperties: false,
      required: ["changes"],
      properties: {
        changes: {
          type: "array", minItems: 1, maxItems: 21,
          items: { type: "object", additionalProperties: false, required: ["date", "slot", "mealId"], properties: { date: { type: "string", format: "date" }, slot: { enum: mealSlots }, mealId: { type: ["string", "null"], maxLength: 48 }, servings: { type: "number", exclusiveMinimum: 0, maximum: 12 } } },
        },
        expectedRevision: { type: "integer", minimum: 0 },
        confirmationToken: { type: "string", maxLength: 80 },
      },
    },
    async (input) => {
      if (!onlyKeys(input, ["changes", "expectedRevision", "confirmationToken"])) return fail("invalid_input", "update_week_plan received an unknown parameter.");
      if ("expectedRevision" in input && !isIntegerInRange(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER)) return fail("invalid_input", "expectedRevision must be a non-negative integer.");
      if ("confirmationToken" in input && stringValue(input.confirmationToken, 80) === undefined) return fail("invalid_input", "confirmationToken must be a string no longer than 80 characters.");
      if (!Array.isArray(input.changes)) return fail("invalid_changes", "changes must be an array.");
      if (!input.changes.length || input.changes.length > 21) return fail("invalid_changes", "Provide between 1 and 21 changes.");
      const changes = input.changes.filter(isRecord).map((change) => ({ date: change.date, slot: change.slot, mealId: change.mealId, servings: change.servings })) as PlanChange[];
      if (changes.length !== input.changes.length) return fail("invalid_changes", "Every change must be an object.");
      if (input.changes.some((change) => isRecord(change) && !onlyKeys(change, ["date", "slot", "mealId", "servings"]))) return fail("invalid_changes", "A plan change contains an unknown parameter.");
      const result = await store.applyPlanChanges(changes, "agent", { expectedRevision: numberValue(input.expectedRevision), confirmationToken: stringValue(input.confirmationToken, 80) });
      if (!result.ok) return json(result);
      return json({ ok: true, revision: result.plan.revision, changed: result.changed, removed: result.removed, message: "The local week plan is updated and visible." });
    },
    { readOnlyHint: false },
  ),
  tool(
    "get_grocery_list",
    "Read grocery list",
    "Derive the current grocery list from the browser-local meal plan, scaled by servings and grouped with aisle metadata.",
    emptyObjectSchema,
    (input) => {
      if (Object.keys(input).length) return fail("invalid_input", "get_grocery_list does not accept parameters.");
      const state = store.getSnapshot();
      const items = deriveGroceryList(state.planEntries);
      return json({ ok: true, planRevision: state.planRevision, count: items.length, items });
    },
    { readOnlyHint: true },
  ),
  tool(
    "get_ui_capabilities",
    "Read UI grammar",
    "Read the bounded composition grammar, the developer policy model, and the safety limits. Call this before inventing a new local feature, screen, or drag-and-drop interaction.",
    emptyObjectSchema,
    (input) => {
      if (Object.keys(input).length) return fail("invalid_input", "get_ui_capabilities does not accept parameters.");
      return json({
        ok: true,
        version: capabilityCatalog.version,
        model: capabilityCatalog.model,
        invariant: capabilityCatalog.invariant,
        layering: capabilityCatalog.layering,
        resources: { ...capabilityCatalog.resources, customFields: ["text", "number", "boolean", "date", "mealRef"] },
        components: capabilityCatalog.components,
        expressions: capabilityCatalog.expressions,
        actions: capabilityCatalog.actions,
        operations: capabilityCatalog.operations,
        interactions: capabilityCatalog.interactions,
        derivedTools: capabilityCatalog.derivedTools,
        examples: capabilityCatalog.examples,
        limits: capabilityCatalog.limits,
        workflow: capabilityCatalog.workflow,
      });
    },
    { readOnlyHint: true },
  ),
  tool(
    "get_ui_outline",
    "Read active UI outline",
    "Read the live interface without returning personal records: the developer base in use, every element id with the policy governing it, which components can be dragged from or dropped onto, the saved interactions, and the tools derived from them. Call before proposing UI changes.",
    emptyObjectSchema,
    (input) => {
      if (Object.keys(input).length) return fail("invalid_input", "get_ui_outline does not accept parameters.");
      const state = store.getSnapshot();
      const { configuration, elements } = state;
      return json({
        ok: true,
        revision: configuration.revision,
        base: { id: configuration.baseId, name: configuration.baseName, revision: configuration.baseRevision },
        activeSurfaceId: state.activeSurfaceId,
        surfaces: configuration.surfaces.map((surface) => outlineSurface(surface, elements, configuration.collections)),
        collections: configuration.collections,
        interactions: configuration.interactions.map((interaction) => ({ ...interaction, describes: describeInteraction(interaction) })),
        derivedTools: describeDerivedTools(configuration),
        policyNote: "Each element lists what the developer allows under can. Developer-owned elements are never removable; hide_element and show_element are the reversible alternative where the policy allows it.",
        recovery: "The app shell can undo, reset, export and import. Removing a screen never deletes records.",
      });
    },
    { readOnlyHint: true },
  ),
  tool(
    "preview_ui_changes",
    "Preview UI changes",
    "Validate and stage one atomic batch of bounded UI operations against the user layer. This never commits, and never edits the developer base. The user must approve the visible preview in YourWeb before apply_ui_preview can commit it.",
    {
      type: "object",
      additionalProperties: false,
      required: ["operations"],
      properties: { operations: operationBatchSchema, expectedRevision: { type: "integer", minimum: 1 } },
    },
    async (input) => {
      if (!onlyKeys(input, ["operations", "expectedRevision"])) return fail("invalid_input", "preview_ui_changes received an unknown parameter.");
      if ("expectedRevision" in input && !isIntegerInRange(input.expectedRevision, 1, Number.MAX_SAFE_INTEGER)) return fail("invalid_input", "expectedRevision must be a positive integer.");
      const state = store.getSnapshot();
      const result = createConfigurationPreview(state.layer, input.operations, numberValue(input.expectedRevision));
      if (!result.ok) return json(result);
      await store.addActivity({ source: "agent", title: "Interface preview proposed", detail: result.preview.diff.summary, status: "pending" });
      return json({
        ok: true,
        previewId: result.preview.id,
        baseRevision: result.preview.baseRevision,
        expiresAt: new Date(result.preview.expiresAt).toISOString(),
        diff: result.preview.diff,
        approvalRequired: true,
        next: "Ask the user to inspect and approve the visible YourWeb preview, then call apply_ui_preview with this previewId.",
      });
    },
    { readOnlyHint: false },
  ),
  tool(
    "apply_ui_preview",
    "Apply approved UI preview",
    "Commit one valid, unexpired preview. Fails until the user explicitly approves the visible preview in YourWeb, and if the base revision has changed. New record types and interactions in the preview immediately derive their own tools.",
    { type: "object", additionalProperties: false, required: ["previewId"], properties: { previewId: { type: "string", maxLength: 80, description: "Id returned by preview_ui_changes." } } },
    async (input) => {
      if (!onlyKeys(input, ["previewId"])) return fail("invalid_input", "apply_ui_preview only accepts previewId.");
      const previewId = stringValue(input.previewId, 80);
      if (!previewId) return fail("invalid_preview_id", "previewId is required.");
      const result = await store.applyPreview(previewId, "agent");
      if (!result.ok) return json(result);
      const configuration = store.getSnapshot().configuration;
      return json({
        ok: true,
        revision: configuration.revision,
        applied: result.preview.diff,
        derivedTools: describeDerivedTools(configuration),
        message: "The approved interface is now active and persisted in this browser. Any newly derived tools are registered.",
      });
    },
    { readOnlyHint: false },
  ),
  tool(
    "undo_ui_change",
    "Undo UI change",
    "Undo the most recent persistent interface change. Meal history and custom records are preserved.",
    emptyObjectSchema,
    async (input) => {
      if (Object.keys(input).length) return fail("invalid_input", "undo_ui_change does not accept parameters.");
      const undone = await store.undoConfiguration("agent");
      return undone ? json({ ok: true, revision: store.getSnapshot().configuration.revision, message: "The last interface change was undone; records were preserved." }) : fail("nothing_to_undo", "There is no earlier interface configuration in local history.");
    },
    { readOnlyHint: false },
  ),
];

const derivedSignature = (tools: WebMCP.ModelContextTool[]) => tools.map((tool) => `${tool.name}:${JSON.stringify(tool.inputSchema)}`).join("|");

/**
 * Keep the derived tool set in step with what the user has saved. A change to the record types or
 * interactions aborts the previous registration and registers a freshly derived set.
 */
const startDerivedToolSync = (store: YourWebStore, modelContext: WebMCP.ModelContext) => {
  let controller: AbortController | null = null;
  let signature = "";
  let syncing: Promise<void> = Promise.resolve();

  const sync = () => {
    const tools = deriveTools(store, store.getSnapshot().configuration);
    const next = derivedSignature(tools);
    if (next === signature) return;
    signature = next;
    const previous = controller;
    const nextController = new AbortController();
    controller = nextController;
    syncing = syncing.then(async () => {
      previous?.abort();
      if (!tools.length) {
        window.__YOURWEB_WEBMCP__ = { ...(window.__YOURWEB_WEBMCP__ ?? { registered: true, count: 0 }), derived: 0 };
        return;
      }
      try {
        await Promise.all(tools.map((definition) => modelContext.registerTool(definition, { signal: nextController.signal })));
        window.__YOURWEB_WEBMCP__ = { ...(window.__YOURWEB_WEBMCP__ ?? { registered: true, count: 0 }), derived: tools.length };
      } catch (error) {
        await store.addActivity({
          source: "system",
          title: "Derived tools unavailable",
          detail: error instanceof Error ? error.message : "The tools derived from your saved features could not be registered.",
          status: "warning",
        });
      }
    });
  };

  sync();
  return store.subscribe(sync);
};

export const registerWebMCPTools = async (store: YourWebStore) => {
  const modelContext = document.modelContext;
  if (!modelContext) {
    window.__YOURWEB_WEBMCP__ = { registered: false, count: 0 };
    return { registered: false, count: 0 };
  }

  const tools = createTools(store);
  try {
    await Promise.all(tools.map((definition) => modelContext.registerTool(definition)));
    window.__YOURWEB_WEBMCP__ = { registered: true, count: tools.length, derived: 0 };
    startDerivedToolSync(store, modelContext);
    return { registered: true, count: tools.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool registration failed.";
    window.__YOURWEB_WEBMCP__ = { registered: false, count: 0, error: message };
    await store.addActivity({ source: "system", title: "Site Tools unavailable", detail: message, status: "warning" });
    return { registered: false, count: 0, error: message };
  }
};

export const createWebMCPToolsForTesting = createTools;
