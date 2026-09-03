import { findComponent } from "../composition/layer";
import { LIMITS } from "../composition/limits";
import { buildDragPayload, performDrop } from "../composition/interactions";
import { dragCapabilityFor, dropCapabilityFor } from "../composition/policy";
import type {
  CustomCollectionSchema,
  CustomFieldSchema,
  InteractionDefinition,
  MealSlot,
  ResolvedConfiguration,
  Scalar,
} from "../composition/types";
import type { YourWebStore } from "../data/store";

/**
 * Tools the assistant did not have on page load, derived by trusted app code from what the user
 * saved: the field schema of each record type, and each bound drag-and-drop interaction.
 *
 * Nothing here evaluates generated code. A derived tool is a closure over a validated schema, and
 * every write goes through the same store method the visible UI uses.
 */

type UnknownRecord = Record<string, unknown>;

const json = (value: unknown) => JSON.stringify(value);
const fail = (code: string, message: string, details?: unknown) =>
  json({ ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } });

const toolSafe = (id: string) => id.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 48);
const onlyKeys = (input: UnknownRecord, allowed: readonly string[]) => Object.keys(input).every((key) => allowed.includes(key));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const fieldSchema = (field: CustomFieldSchema) => {
  const description = `${field.label}${field.required ? " (required)" : ""}`;
  switch (field.type) {
    case "number":
      return { type: "number", description, ...(field.min === undefined ? {} : { minimum: field.min }), ...(field.max === undefined ? {} : { maximum: field.max }) };
    case "boolean":
      return { type: "boolean", description };
    case "date":
      return { type: "string", format: "date", maxLength: 10, description: `${description}, as YYYY-MM-DD` };
    case "mealRef":
      return { type: "string", maxLength: 48, description: `${description}. A meal id from search_meals.` };
    default:
      return { type: "string", maxLength: LIMITS.textLength, description };
  }
};

const collectionInputSchema = (collection: CustomCollectionSchema) => ({
  type: "object",
  additionalProperties: false,
  required: collection.fields.filter((field) => field.required).map((field) => field.id),
  properties: Object.fromEntries(collection.fields.map((field) => [field.id, fieldSchema(field)])),
});

const collectionTools = (store: YourWebStore, collection: CustomCollectionSchema): WebMCP.ModelContextTool[] => {
  const slug = toolSafe(collection.id);
  const fieldList = collection.fields.map((field) => `${field.id} (${field.type})`).join(", ");
  const allowed = collection.fields.map((field) => field.id);

  return [
    {
      name: `list_${slug}`,
      title: `List ${collection.name}`,
      description: `Read the browser-local ${collection.name} records this site was asked to keep. Fields: ${fieldList}.`,
      inputSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 200 } } },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        if (!onlyKeys(input, ["limit"])) return fail("invalid_input", `list_${slug} only accepts limit.`);
        const limit = typeof input.limit === "number" && Number.isInteger(input.limit) ? Math.min(Math.max(input.limit, 1), 200) : 50;
        const records = store.recordsFor(collection.id);
        return json({
          ok: true,
          collectionId: collection.id,
          count: records.length,
          records: records.slice(-limit).map((record) => ({ id: record.id, ...record.values, createdAt: record.createdAt })),
        });
      },
    },
    {
      name: `add_${slug}`,
      title: `Add to ${collection.name}`,
      description: `Add one browser-local ${collection.name} record. The input shape comes from the saved field schema: ${fieldList}.`,
      inputSchema: collectionInputSchema(collection),
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        if (!onlyKeys(input, allowed)) return fail("invalid_input", `add_${slug} accepts only: ${allowed.join(", ")}.`);
        const result = await store.addCustomRecord(collection.id, input);
        if (!result.ok) return fail("invalid_record", `The record does not fit the ${collection.name} schema.`, result.issues);
        return json({ ok: true, recordId: result.record.id, values: result.record.values, message: `Saved to ${collection.name} in this browser.` });
      },
    },
    {
      name: `remove_${slug}`,
      title: `Remove from ${collection.name}`,
      description: `Delete one browser-local ${collection.name} record by id. Ids come from list_${slug}.`,
      inputSchema: { type: "object", additionalProperties: false, required: ["recordId"], properties: { recordId: { type: "string", maxLength: 80 } } },
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        if (!onlyKeys(input, ["recordId"])) return fail("invalid_input", `remove_${slug} only accepts recordId.`);
        const recordId = typeof input.recordId === "string" ? input.recordId : "";
        const removed = await store.removeCustomRecord(recordId);
        return removed ? json({ ok: true, message: "Record removed." }) : fail("record_not_found", "No record with that id exists.");
      },
    },
  ];
};

const cellSchemaFor = (cellFields: readonly string[], slots: readonly MealSlot[]) => {
  const properties: Record<string, unknown> = {};
  for (const name of cellFields) {
    if (name === "date") properties.date = { type: "string", format: "date", maxLength: 10, description: "Target day, as YYYY-MM-DD." };
    else if (name === "slot") properties.slot = { enum: [...slots], description: "Target slot in that day." };
  }
  return properties;
};

const interactionTool = (
  store: YourWebStore,
  configuration: ResolvedConfiguration,
  interaction: InteractionDefinition,
): WebMCP.ModelContextTool | null => {
  const source = findComponent(configuration, interaction.source.componentId);
  const target = findComponent(configuration, interaction.target.componentId);
  if (!source || !target) return null;
  const drag = dragCapabilityFor(source, configuration.collections);
  const drop = dropCapabilityFor(target, configuration.collections);
  if (!drag || !drop) return null;

  const sourceResource = source.kind === "collection" ? source.query.source : "";
  const slots = target.kind === "calendar" ? target.slots : (["breakfast", "lunch", "dinner"] as MealSlot[]);
  const cellProperties = cellSchemaFor(drop.cellFields, slots);
  const cellNames = Object.keys(cellProperties);
  const slug = toolSafe(interaction.id);

  return {
    name: `run_${slug}`,
    title: interaction.label,
    description: `${interaction.label}. Performs the same drop the user would do by dragging an item from ${source.id} onto ${target.id}; it runs ${interaction.target.action.id}. This tool exists because that interaction is saved in this browser.`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["itemId", ...cellNames],
      properties: {
        itemId: { type: "string", maxLength: 80, description: `Id of the ${sourceResource || "source"} item being dropped.` },
        ...cellProperties,
      },
    },
    annotations: { readOnlyHint: false },
    execute: async (input) => {
      if (!onlyKeys(input, ["itemId", ...cellNames])) return fail("invalid_input", `run_${slug} accepts only: itemId, ${cellNames.join(", ")}.`);
      const itemId = typeof input.itemId === "string" ? input.itemId : "";
      const resources = store.getResources();
      const record = (resources[sourceResource] ?? []).find((candidate) => candidate.id === itemId);
      if (!record) return fail("item_not_found", `No item with id '${itemId}' is listed by ${source.id}.`);

      const cell: Record<string, Scalar> = {};
      for (const name of cellNames) {
        const value = input[name];
        if (name === "date") {
          if (typeof value !== "string" || !ISO_DATE.test(value)) return fail("invalid_input", "date must be YYYY-MM-DD.");
          cell.date = value;
        } else if (name === "slot") {
          if (typeof value !== "string" || !slots.includes(value as MealSlot)) return fail("invalid_input", `slot must be one of ${slots.join(", ")}.`);
          cell.slot = value;
        }
      }
      for (const name of drop.cellFields) {
        if (name === "collectionId" && target.kind === "collection") cell.collectionId = target.query.source;
      }

      const payload = buildDragPayload(interaction, record, resources, String(record.name ?? itemId));
      const result = await performDrop(interaction, payload, cell, resources, store);
      return result.ok ? json({ ok: true, message: result.message }) : fail("drop_failed", result.message);
    },
  };
};

export const deriveTools = (store: YourWebStore, configuration: ResolvedConfiguration): WebMCP.ModelContextTool[] => {
  const tools: WebMCP.ModelContextTool[] = [];
  for (const collection of configuration.collections) {
    if (collection.archived || collection.exposeTools === false) continue;
    tools.push(...collectionTools(store, collection));
  }
  for (const interaction of configuration.interactions) {
    if (interaction.enabled === false) continue;
    const tool = interactionTool(store, configuration, interaction);
    if (tool) tools.push(tool);
  }

  const seen = new Set<string>();
  return tools.filter((tool) => !seen.has(tool.name) && seen.add(tool.name)).slice(0, LIMITS.derivedTools);
};

export const describeDerivedTools = (configuration: ResolvedConfiguration) => ({
  fromRecordTypes: configuration.collections
    .filter((collection) => !collection.archived && collection.exposeTools !== false)
    .map((collection) => ({ collectionId: collection.id, tools: [`list_${toolSafe(collection.id)}`, `add_${toolSafe(collection.id)}`, `remove_${toolSafe(collection.id)}`] })),
  fromInteractions: configuration.interactions
    .filter((interaction) => interaction.enabled !== false)
    .map((interaction) => ({ interactionId: interaction.id, tool: `run_${toolSafe(interaction.id)}` })),
});
