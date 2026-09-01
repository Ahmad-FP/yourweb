import { LIMITS } from "./limits";

const id = { type: "string", pattern: "^[a-z][a-z0-9-]{0,47}$" } as const;
const referenceName = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9-]{0,47}$" } as const;
const shortText = { type: "string", minLength: 1, maxLength: LIMITS.textLength } as const;

const expression = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["op", "value"], properties: { op: { const: "literal" }, value: { type: ["string", "number", "boolean", "null"] } } },
    { type: "object", additionalProperties: false, required: ["op", "id"], properties: { op: { const: "resource" }, id } },
    { type: "object", additionalProperties: false, required: ["op", "name"], properties: { op: { const: "field" }, name: referenceName } },
    {
      type: "object",
      additionalProperties: false,
      required: ["op", "mealRefField", "field"],
      properties: {
        op: { const: "mealField" },
        mealRefField: referenceName,
        field: { enum: ["name", "calories", "protein", "carbs", "fat", "fiber"] },
      },
    },
    { type: "object", additionalProperties: false, required: ["op"], properties: { op: { enum: ["today", "currentWeek"] } } },
    {
      type: "object",
      additionalProperties: false,
      required: ["op", "left", "right"],
      properties: {
        op: { enum: ["add", "subtract", "multiply", "divide", "eq", "gt", "gte", "lt", "lte"] },
        left: { $ref: "#/$defs/expression" },
        right: { $ref: "#/$defs/expression" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["op", "source", "where"],
      properties: { op: { const: "filter" }, source: { $ref: "#/$defs/expression" }, where: { $ref: "#/$defs/expression" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["op", "source", "value"],
      properties: { op: { const: "sum" }, source: { $ref: "#/$defs/expression" }, value: { $ref: "#/$defs/expression" } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["op", "source"],
      properties: { op: { const: "count" }, source: { $ref: "#/$defs/expression" } },
    },
  ],
} as const;

const className = { enum: ["quiet", "accent", "inset"] } as const;
const baseProperties = { id, className } as const;

const action = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "args"],
      properties: { id: { const: "navigate" }, args: { type: "object", additionalProperties: false, required: ["surfaceId"], properties: { surfaceId: { $ref: "#/$defs/expression" } } } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "args"],
      properties: {
        id: { const: "add_meal_to_plan" },
        args: {
          type: "object",
          additionalProperties: false,
          required: ["mealId", "date", "slot"],
          properties: {
            mealId: { $ref: "#/$defs/expression" },
            date: { $ref: "#/$defs/expression" },
            slot: { $ref: "#/$defs/expression" },
            servings: { $ref: "#/$defs/expression" },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "args"],
      properties: { id: { const: "remove_meal_from_plan" }, args: { type: "object", additionalProperties: false, required: ["date", "slot"], properties: { date: { $ref: "#/$defs/expression" }, slot: { $ref: "#/$defs/expression" } } } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "args"],
      properties: { id: { const: "favorite_meal" }, args: { type: "object", additionalProperties: false, required: ["mealId"], properties: { mealId: { $ref: "#/$defs/expression" } } } },
    },
  ],
} as const;

const query = {
  type: "object",
  additionalProperties: false,
  required: ["source"],
  properties: {
    source: id,
    where: { $ref: "#/$defs/expression" },
    sortBy: referenceName,
    sortDirection: { enum: ["asc", "desc"] },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
} as const;

const component = {
  oneOf: [
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "children"],
      properties: { ...baseProperties, kind: { const: "section" }, eyebrow: shortText, title: shortText, description: shortText, children: { type: "array", items: { $ref: "#/$defs/component" } } },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "columns", "children"],
      properties: { ...baseProperties, kind: { const: "grid" }, columns: { enum: [1, 2, 3, 4, "auto"] }, density: { enum: ["comfortable", "compact"] }, children: { type: "array", items: { $ref: "#/$defs/component" } } },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "text"],
      properties: { ...baseProperties, kind: { const: "text" }, text: shortText, variant: { enum: ["body", "caption", "lead", "display"] } },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "label", "value"],
      properties: { ...baseProperties, kind: { const: "metric" }, label: shortText, value: { $ref: "#/$defs/expression" }, unit: shortText, format: { enum: ["number", "decimal"] } },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "label", "value", "max"],
      properties: { ...baseProperties, kind: { const: "progress" }, label: shortText, value: { $ref: "#/$defs/expression" }, max: { $ref: "#/$defs/expression" }, unit: shortText },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "query", "variant"],
      properties: { ...baseProperties, kind: { const: "collection" }, title: shortText, query: { $ref: "#/$defs/query" }, variant: { enum: ["cards", "list", "table"] }, fields: { type: "array", maxItems: 12, items: referenceName }, emptyText: shortText },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "mealId"],
      properties: { ...baseProperties, kind: { const: "recipe" }, mealId: { $ref: "#/$defs/expression" } },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "collectionId"],
      properties: { ...baseProperties, kind: { const: "form" }, collectionId: id, title: shortText, fields: { type: "array", maxItems: 12, items: referenceName }, submitLabel: shortText },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "label", "action"],
      properties: { ...baseProperties, kind: { const: "button" }, label: shortText, action: { $ref: "#/$defs/action" }, variant: { enum: ["primary", "secondary", "quiet"] } },
    },
  ],
} as const;

const field = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "type"],
  properties: {
    id,
    label: shortText,
    type: { enum: ["text", "number", "boolean", "date", "mealRef"] },
    required: { type: "boolean" },
    min: { type: "number" },
    max: { type: "number" },
    default: { type: ["string", "number", "boolean", "null"] },
  },
} as const;

const collection = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "fields"],
  properties: { id, name: shortText, description: shortText, fields: { type: "array", maxItems: LIMITS.fieldsPerCollection, items: field }, archived: { type: "boolean" } },
} as const;

const surface = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "order", "root"],
  properties: { id, title: shortText, shortTitle: shortText, icon: { enum: ["spark", "market", "calendar", "basket", "plus", "pulse"] }, order: { type: "integer", minimum: 0, maximum: 99 }, root: { $ref: "#/$defs/component" } },
} as const;

export const configurationSchema = {
  $id: "yourweb-ui-configuration",
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "version", "capabilityVersion", "presetBase", "surfaces", "collections"],
  properties: {
    id,
    name: shortText,
    version: { type: "integer", minimum: 1 },
    capabilityVersion: { const: 1 },
    presetBase: { enum: ["minimal", "dense"] },
    surfaces: { type: "array", minItems: 1, maxItems: LIMITS.surfaces, items: { $ref: "#/$defs/surface" } },
    collections: { type: "array", maxItems: LIMITS.collections, items: { $ref: "#/$defs/collection" } },
  },
  $defs: { expression, action, query, component, field, collection, surface },
} as const;

export const operationBatchSchema = {
  $id: "yourweb-ui-operation-batch",
  type: "array",
  minItems: 1,
  maxItems: LIMITS.operationsPerPreview,
  items: {
    oneOf: [
      { type: "object", additionalProperties: false, required: ["op", "surface"], properties: { op: { const: "upsert_surface" }, surface: { $ref: "yourweb-ui-configuration#/$defs/surface" } } },
      { type: "object", additionalProperties: false, required: ["op", "surfaceId"], properties: { op: { const: "remove_surface" }, surfaceId: id } },
      { type: "object", additionalProperties: false, required: ["op", "collection"], properties: { op: { const: "upsert_collection" }, collection: { $ref: "yourweb-ui-configuration#/$defs/collection" } } },
      { type: "object", additionalProperties: false, required: ["op", "collectionId"], properties: { op: { const: "remove_collection" }, collectionId: id } },
    ],
  },
} as const;
