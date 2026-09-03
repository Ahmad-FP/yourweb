import { CAPABILITY_VERSION, LIMITS } from "./limits";

const id = { type: "string", pattern: "^[a-z][a-z0-9-]{0,47}$" } as const;
const referenceName = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9-]{0,47}$" } as const;
const shortText = { type: "string", minLength: 1, maxLength: LIMITS.textLength } as const;
const dragType = { type: "string", pattern: "^[a-z][a-z0-9:-]{0,63}$" } as const;

const ref = (name: string) => ({ $ref: `yourweb-composition#/$defs/${name}` }) as const;

const expression = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["op", "value"], properties: { op: { const: "literal" }, value: { type: ["string", "number", "boolean", "null"] } } },
    { type: "object", additionalProperties: false, required: ["op", "id"], properties: { op: { const: "resource" }, id } },
    { type: "object", additionalProperties: false, required: ["op", "name"], properties: { op: { const: "field" }, name: referenceName } },
    { type: "object", additionalProperties: false, required: ["op", "name"], properties: { op: { const: "dragged" }, name: referenceName } },
    { type: "object", additionalProperties: false, required: ["op", "name"], properties: { op: { const: "cell" }, name: referenceName } },
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
        left: ref("expression"),
        right: ref("expression"),
      },
    },
    { type: "object", additionalProperties: false, required: ["op", "source", "where"], properties: { op: { const: "filter" }, source: ref("expression"), where: ref("expression") } },
    { type: "object", additionalProperties: false, required: ["op", "source", "value"], properties: { op: { const: "sum" }, source: ref("expression"), value: ref("expression") } },
    { type: "object", additionalProperties: false, required: ["op", "source"], properties: { op: { const: "count" }, source: ref("expression") } },
  ],
} as const;

const expressionMap = {
  type: "object",
  minProperties: 1,
  maxProperties: LIMITS.payloadKeys,
  propertyNames: referenceName,
  additionalProperties: ref("expression"),
} as const;

const policy = {
  type: "object",
  additionalProperties: false,
  properties: { hideable: { type: "boolean" }, movable: { type: "boolean" }, extendable: { type: "boolean" }, removable: { type: "boolean" } },
} as const;

const className = { enum: ["quiet", "accent", "inset"] } as const;
const baseProperties = { id, className, policy: ref("policy") } as const;
const mealSlot = { enum: ["breakfast", "lunch", "dinner"] } as const;

const action = {
  oneOf: [
    {
      type: "object", additionalProperties: false, required: ["id", "args"],
      properties: { id: { const: "navigate" }, args: { type: "object", additionalProperties: false, required: ["surfaceId"], properties: { surfaceId: ref("expression") } } },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "args"],
      properties: {
        id: { const: "add_meal_to_plan" },
        args: {
          type: "object", additionalProperties: false, required: ["mealId", "date", "slot"],
          properties: { mealId: ref("expression"), date: ref("expression"), slot: ref("expression"), servings: ref("expression") },
        },
      },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "args"],
      properties: { id: { const: "remove_meal_from_plan" }, args: { type: "object", additionalProperties: false, required: ["date", "slot"], properties: { date: ref("expression"), slot: ref("expression") } } },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "args"],
      properties: { id: { const: "favorite_meal" }, args: { type: "object", additionalProperties: false, required: ["mealId"], properties: { mealId: ref("expression") } } },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "args"],
      properties: {
        id: { const: "log_record" },
        args: { type: "object", additionalProperties: false, required: ["collectionId", "values"], properties: { collectionId: ref("expression"), values: ref("expressionMap") } },
      },
    },
  ],
} as const;

const query = {
  type: "object",
  additionalProperties: false,
  required: ["source"],
  properties: {
    source: id,
    where: ref("expression"),
    sortBy: referenceName,
    sortDirection: { enum: ["asc", "desc"] },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
} as const;

const component = {
  oneOf: [
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "children"],
      properties: { ...baseProperties, kind: { const: "section" }, eyebrow: shortText, title: shortText, description: shortText, children: { type: "array", maxItems: LIMITS.components, items: ref("component") } },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "columns", "children"],
      properties: { ...baseProperties, kind: { const: "grid" }, columns: { enum: [1, 2, 3, 4, "auto"] }, density: { enum: ["comfortable", "compact"] }, children: { type: "array", maxItems: LIMITS.components, items: ref("component") } },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "text"],
      properties: { ...baseProperties, kind: { const: "text" }, text: shortText, variant: { enum: ["body", "caption", "lead", "display"] } },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "label", "value"],
      properties: { ...baseProperties, kind: { const: "metric" }, label: shortText, value: ref("expression"), unit: shortText, format: { enum: ["number", "decimal"] } },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "label", "value", "max"],
      properties: { ...baseProperties, kind: { const: "progress" }, label: shortText, value: ref("expression"), max: ref("expression"), unit: shortText },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "query", "variant"],
      properties: { ...baseProperties, kind: { const: "collection" }, title: shortText, query: ref("query"), variant: { enum: ["cards", "list", "table"] }, fields: { type: "array", maxItems: 12, items: referenceName }, emptyText: shortText },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "slots"],
      properties: { ...baseProperties, kind: { const: "calendar" }, title: shortText, slots: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: mealSlot }, emptyText: shortText },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "mealId"],
      properties: { ...baseProperties, kind: { const: "recipe" }, mealId: ref("expression") },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "collectionId"],
      properties: { ...baseProperties, kind: { const: "form" }, collectionId: id, title: shortText, fields: { type: "array", maxItems: 12, items: referenceName }, submitLabel: shortText },
    },
    {
      type: "object", additionalProperties: false, required: ["id", "kind", "label", "action"],
      properties: { ...baseProperties, kind: { const: "button" }, label: shortText, action: ref("action"), variant: { enum: ["primary", "secondary", "quiet"] } },
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
  properties: {
    id,
    name: shortText,
    description: shortText,
    fields: { type: "array", minItems: 1, maxItems: LIMITS.fieldsPerCollection, items: ref("field") },
    archived: { type: "boolean" },
    exposeTools: { type: "boolean" },
  },
} as const;

const surface = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "order", "root"],
  properties: {
    id,
    title: shortText,
    shortTitle: shortText,
    icon: { enum: ["spark", "market", "calendar", "basket", "plus", "pulse"] },
    order: { type: "integer", minimum: 0, maximum: 99 },
    root: ref("component"),
    policy: ref("policy"),
  },
} as const;

const interaction = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "source", "target"],
  properties: {
    id,
    label: shortText,
    enabled: { type: "boolean" },
    source: {
      type: "object", additionalProperties: false, required: ["componentId", "type", "payload"],
      properties: { componentId: id, type: dragType, payload: ref("expressionMap") },
    },
    target: {
      type: "object", additionalProperties: false, required: ["componentId", "accepts", "action"],
      properties: { componentId: id, accepts: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: dragType }, action: ref("action") },
    },
  },
} as const;

const patch = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["op", "targetId"], properties: { op: { const: "hide" }, targetId: id } },
    { type: "object", additionalProperties: false, required: ["op", "surfaceId", "order"], properties: { op: { const: "move_surface" }, surfaceId: id, order: { type: "integer", minimum: 0, maximum: 99 } } },
    { type: "object", additionalProperties: false, required: ["op", "slotId", "node"], properties: { op: { const: "insert" }, slotId: id, node: ref("component"), position: { type: "integer", minimum: 0, maximum: 99 } } },
  ],
} as const;

/** Every shared shape in the bounded composition grammar, referenced by id from the schemas below. */
export const grammarSchema = {
  $id: "yourweb-composition",
  $defs: { expression, expressionMap, policy, action, query, component, field, collection, surface, interaction, patch },
} as const;

export const userLayerSchema = {
  $id: "yourweb-user-layer",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "capabilityVersion", "baseId", "revision", "patches", "surfaces", "collections", "interactions"],
  properties: {
    schemaVersion: { const: 2 },
    capabilityVersion: { const: CAPABILITY_VERSION },
    baseId: { enum: ["simple", "dense"] },
    revision: { type: "integer", minimum: 1 },
    patches: { type: "array", maxItems: LIMITS.patches, items: ref("patch") },
    surfaces: { type: "array", maxItems: LIMITS.userSurfaces, items: ref("surface") },
    collections: { type: "array", maxItems: LIMITS.collections, items: ref("collection") },
    interactions: { type: "array", maxItems: LIMITS.interactions, items: ref("interaction") },
  },
} as const;

export const operationBatchSchema = {
  $id: "yourweb-ui-operation-batch",
  type: "array",
  minItems: 1,
  maxItems: LIMITS.operationsPerPreview,
  items: {
    oneOf: [
      { type: "object", additionalProperties: false, required: ["op", "surface"], properties: { op: { const: "upsert_surface" }, surface: ref("surface") } },
      { type: "object", additionalProperties: false, required: ["op", "surfaceId"], properties: { op: { const: "remove_surface" }, surfaceId: id } },
      { type: "object", additionalProperties: false, required: ["op", "targetId"], properties: { op: { const: "hide_element" }, targetId: id } },
      { type: "object", additionalProperties: false, required: ["op", "targetId"], properties: { op: { const: "show_element" }, targetId: id } },
      { type: "object", additionalProperties: false, required: ["op", "surfaceId", "order"], properties: { op: { const: "move_surface" }, surfaceId: id, order: { type: "integer", minimum: 0, maximum: 99 } } },
      { type: "object", additionalProperties: false, required: ["op", "slotId", "node"], properties: { op: { const: "insert_into_slot" }, slotId: id, node: ref("component"), position: { type: "integer", minimum: 0, maximum: 99 } } },
      { type: "object", additionalProperties: false, required: ["op", "nodeId"], properties: { op: { const: "remove_inserted" }, nodeId: id } },
      { type: "object", additionalProperties: false, required: ["op", "collection"], properties: { op: { const: "upsert_collection" }, collection: ref("collection") } },
      { type: "object", additionalProperties: false, required: ["op", "collectionId"], properties: { op: { const: "remove_collection" }, collectionId: id } },
      { type: "object", additionalProperties: false, required: ["op", "interaction"], properties: { op: { const: "bind_interaction" }, interaction: ref("interaction") } },
      { type: "object", additionalProperties: false, required: ["op", "interactionId"], properties: { op: { const: "unbind_interaction" }, interactionId: id } },
    ],
  },
} as const;
