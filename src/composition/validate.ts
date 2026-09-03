import { baseElementIds, isBaseId } from "./base";
import { resolveConfiguration } from "./layer";
import { CAPABILITY_VERSION, LIMITS } from "./limits";
import { dragCapabilityFor, dropCapabilityFor } from "./policy";
import { grammarSchema, operationBatchSchema, userLayerSchema } from "./schemas";
import type {
  ActionBinding,
  ComponentNode,
  CustomCollectionSchema,
  Expression,
  InteractionDefinition,
  UIChangeOperation,
  UserLayer,
  ValidationIssue,
  ValidationResult,
} from "./types";

type JsonSchema = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const schemaRecord = (value: unknown): JsonSchema | null => (isRecord(value) ? value : null);

const namedSchemas: Record<string, JsonSchema> = {
  "yourweb-composition": grammarSchema as unknown as JsonSchema,
  "yourweb-user-layer": userLayerSchema as unknown as JsonSchema,
  "yourweb-ui-operation-batch": operationBatchSchema as unknown as JsonSchema,
};

const resolveReference = (reference: string, root: JsonSchema): { schema: JsonSchema; root: JsonSchema } | null => {
  const [documentId, fragment = ""] = reference.split("#", 2);
  const nextRoot = documentId && namedSchemas[documentId] ? namedSchemas[documentId]! : root;
  let current: unknown = nextRoot;
  if (!fragment) return schemaRecord(current) ? { schema: current as JsonSchema, root: nextRoot } : null;
  for (const rawPart of fragment.replace(/^\//, "").split("/")) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isRecord(current) || !(part in current)) return null;
    current = current[part];
  }
  const schema = schemaRecord(current);
  return schema ? { schema, root: nextRoot } : null;
};

const matchesType = (value: unknown, expected: string) => {
  switch (expected) {
    case "null": return value === null;
    case "array": return Array.isArray(value);
    case "object": return isRecord(value);
    case "integer": return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    default: return false;
  }
};

const validateSchema = (
  value: unknown,
  schema: JsonSchema,
  path: string,
  root: JsonSchema,
  issues: ValidationIssue[],
): boolean => {
  const issueStart = issues.length;
  if (typeof schema.$ref === "string") {
    const resolved = resolveReference(schema.$ref, root);
    if (!resolved) {
      issues.push({ path, message: `Internal schema reference '${schema.$ref}' could not be resolved.` });
      return false;
    }
    return validateSchema(value, resolved.schema, path, resolved.root, issues);
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => {
      const branch = schemaRecord(candidate);
      if (!branch) return false;
      const branchIssues: ValidationIssue[] = [];
      validateSchema(value, branch, path, root, branchIssues);
      return branchIssues.length === 0;
    });
    if (matches.length !== 1) issues.push({ path, message: "Value does not match exactly one allowed shape." });
    return matches.length === 1;
  }

  if ("const" in schema && !Object.is(value, schema.const)) issues.push({ path, message: `Value must be ${JSON.stringify(schema.const)}.` });
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    issues.push({ path, message: `Value must be one of ${schema.enum.map((candidate) => JSON.stringify(candidate)).join(", ")}.` });
  }

  const expectedTypes = typeof schema.type === "string"
    ? [schema.type]
    : Array.isArray(schema.type) ? schema.type.filter((item): item is string => typeof item === "string") : [];
  if (expectedTypes.length && !expectedTypes.some((expected) => matchesType(value, expected))) {
    issues.push({ path, message: `Expected ${expectedTypes.join(" or ")}.` });
    return false;
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) issues.push({ path, message: `Text must contain at least ${schema.minLength} character.` });
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) issues.push({ path, message: `Text exceeds ${schema.maxLength} characters.` });
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) issues.push({ path, message: "Text does not match the required safe identifier format." });
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (typeof schema.minimum === "number" && value < schema.minimum) issues.push({ path, message: `Number must be at least ${schema.minimum}.` });
    if (typeof schema.maximum === "number" && value > schema.maximum) issues.push({ path, message: `Number must be at most ${schema.maximum}.` });
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) issues.push({ path, message: `Number must be greater than ${schema.exclusiveMinimum}.` });
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) issues.push({ path, message: `List requires at least ${schema.minItems} item.` });
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) issues.push({ path, message: `List exceeds ${schema.maxItems} items.` });
    if (schema.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) issues.push({ path, message: "List entries must be unique." });
    const itemSchema = schemaRecord(schema.items);
    if (itemSchema) value.forEach((item, index) => validateSchema(item, itemSchema, `${path}/${index}`, root, issues));
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) issues.push({ path, message: `Object requires at least ${schema.minProperties} entr${schema.minProperties === 1 ? "y" : "ies"}.` });
    if (typeof schema.maxProperties === "number" && keys.length > schema.maxProperties) issues.push({ path, message: `Object exceeds ${schema.maxProperties} entries.` });

    const propertyNames = schemaRecord(schema.propertyNames);
    if (propertyNames) for (const key of keys) validateSchema(key, propertyNames, `${path}/${key}`, root, issues);

    const properties = schemaRecord(schema.properties) ?? {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !Object.hasOwn(value, key)) issues.push({ path: `${path}/${key}`, message: "Required value is missing." });
      }
    }
    const extraSchema = schemaRecord(schema.additionalProperties);
    if (schema.additionalProperties === false) {
      for (const key of keys) {
        if (!Object.hasOwn(properties, key)) issues.push({ path: `${path}/${key}`, message: "Unknown field.", suggestion: "Remove fields that are not part of the declared capability schema." });
      }
    } else if (extraSchema) {
      for (const key of keys) {
        if (!Object.hasOwn(properties, key)) validateSchema(value[key], extraSchema, `${path}/${key}`, root, issues);
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      const childSchema = schemaRecord(propertySchema);
      if (childSchema && Object.hasOwn(value, key)) validateSchema(value[key], childSchema, `${path}/${key}`, root, issues);
    }
  }

  return issues.length === issueStart;
};

const validateShape = (input: unknown, schema: JsonSchema) => {
  const issues: ValidationIssue[] = [];
  validateSchema(input, schema, "", schema, issues);
  return issues;
};

const serializedSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Names an expression may legitimately read in the scope it appears in. */
interface ExpressionScope {
  resourceIds: Set<string>;
  draggedNames?: Set<string>;
  cellNames?: Set<string>;
}

const inspectExpression = (
  expression: Expression,
  path: string,
  scope: ExpressionScope,
  issues: ValidationIssue[],
  depth = 0,
) => {
  if (depth > LIMITS.expressionDepth) {
    issues.push({ path, message: `Expression exceeds the maximum depth of ${LIMITS.expressionDepth}.` });
    return;
  }
  switch (expression.op) {
    case "resource":
      if (!scope.resourceIds.has(expression.id)) {
        issues.push({ path: `${path}/id`, message: `Unknown resource '${expression.id}'.`, suggestion: "Use a built-in resource or create the collection in the same preview." });
      }
      return;
    case "dragged":
      if (!scope.draggedNames) issues.push({ path, message: "The dragged expression is only available inside an interaction drop action." });
      else if (!scope.draggedNames.has(expression.name)) issues.push({ path: `${path}/name`, message: `The drag payload does not carry '${expression.name}'.`, suggestion: `Available: ${[...scope.draggedNames].join(", ") || "none"}.` });
      return;
    case "cell":
      if (!scope.cellNames) issues.push({ path, message: "The cell expression is only available inside an interaction drop action." });
      else if (!scope.cellNames.has(expression.name)) issues.push({ path: `${path}/name`, message: `The drop target does not expose a cell value named '${expression.name}'.`, suggestion: `Available: ${[...scope.cellNames].join(", ") || "none"}.` });
      return;
    case "add": case "subtract": case "multiply": case "divide":
    case "eq": case "gt": case "gte": case "lt": case "lte":
      inspectExpression(expression.left, `${path}/left`, scope, issues, depth + 1);
      inspectExpression(expression.right, `${path}/right`, scope, issues, depth + 1);
      return;
    case "filter":
      inspectExpression(expression.source, `${path}/source`, scope, issues, depth + 1);
      inspectExpression(expression.where, `${path}/where`, scope, issues, depth + 1);
      return;
    case "sum":
      inspectExpression(expression.source, `${path}/source`, scope, issues, depth + 1);
      inspectExpression(expression.value, `${path}/value`, scope, issues, depth + 1);
      return;
    case "count":
      inspectExpression(expression.source, `${path}/source`, scope, issues, depth + 1);
      return;
    case "literal": case "field": case "mealField": case "today": case "currentWeek":
      return;
  }
};

const inspectAction = (
  action: ActionBinding,
  path: string,
  scope: ExpressionScope,
  surfaceIds: Set<string>,
  collections: readonly CustomCollectionSchema[],
  issues: ValidationIssue[],
) => {
  if (action.id === "log_record") {
    inspectExpression(action.args.collectionId, `${path}/args/collectionId`, scope, issues);
    const target = action.args.collectionId;
    const schema = target.op === "literal" && typeof target.value === "string"
      ? collections.find((collection) => collection.id === target.value && !collection.archived)
      : undefined;
    if (target.op === "literal" && typeof target.value === "string" && !schema) {
      issues.push({ path: `${path}/args/collectionId`, message: `Unknown active record type '${target.value}'.` });
    }
    const fieldIds = new Set(schema?.fields.map((field) => field.id) ?? []);
    for (const [name, value] of Object.entries(action.args.values)) {
      inspectExpression(value, `${path}/args/values/${name}`, scope, issues);
      if (schema && !fieldIds.has(name)) {
        issues.push({ path: `${path}/args/values/${name}`, message: `'${schema.id}' has no field '${name}'.`, suggestion: `Fields: ${[...fieldIds].join(", ")}.` });
      }
    }
    for (const field of schema?.fields ?? []) {
      if (field.required && !(field.id in action.args.values)) {
        issues.push({ path: `${path}/args/values`, message: `'${field.id}' is required by ${schema!.id} and must be supplied by the action.` });
      }
    }
    return;
  }
  for (const [name, value] of Object.entries(action.args)) {
    if (value) inspectExpression(value as Expression, `${path}/args/${name}`, scope, issues);
  }
  if (action.id === "navigate") {
    const target = action.args.surfaceId;
    if (target.op === "literal" && typeof target.value === "string" && !surfaceIds.has(target.value)) {
      issues.push({ path: `${path}/args/surfaceId`, message: `Unknown surface '${target.value}'.` });
    }
  }
};

interface ComponentScanState {
  count: number;
  ids: Map<string, string>;
  resourceIds: Set<string>;
  collectionIds: Set<string>;
  collections: readonly CustomCollectionSchema[];
  surfaceIds: Set<string>;
  issues: ValidationIssue[];
}

const inspectComponent = (component: ComponentNode, path: string, state: ComponentScanState, depth = 1) => {
  state.count += 1;
  if (state.count > LIMITS.components) state.issues.push({ path, message: `Configuration exceeds ${LIMITS.components} components.` });
  if (depth > LIMITS.componentDepth) state.issues.push({ path, message: `Component tree exceeds depth ${LIMITS.componentDepth}.` });
  const previous = state.ids.get(component.id);
  if (previous) state.issues.push({ path: `${path}/id`, message: `Element id '${component.id}' is already used by ${previous}.`, suggestion: "Pick an id that does not exist yet; get_ui_outline lists every id in use." });
  state.ids.set(component.id, path);

  const scope: ExpressionScope = { resourceIds: state.resourceIds };
  switch (component.kind) {
    case "section":
    case "grid":
      component.children.forEach((child, index) => inspectComponent(child, `${path}/children/${index}`, state, depth + 1));
      return;
    case "metric":
      inspectExpression(component.value, `${path}/value`, scope, state.issues);
      return;
    case "progress":
      inspectExpression(component.value, `${path}/value`, scope, state.issues);
      inspectExpression(component.max, `${path}/max`, scope, state.issues);
      return;
    case "collection":
      if (!state.resourceIds.has(component.query.source)) state.issues.push({ path: `${path}/query/source`, message: `Unknown resource '${component.query.source}'.` });
      if (component.query.where) inspectExpression(component.query.where, `${path}/query/where`, scope, state.issues);
      return;
    case "recipe":
      inspectExpression(component.mealId, `${path}/mealId`, scope, state.issues);
      return;
    case "form":
      if (!state.collectionIds.has(component.collectionId)) {
        state.issues.push({ path: `${path}/collectionId`, message: `Form requires active custom collection '${component.collectionId}'.`, suggestion: "Upsert the collection in the same preview, before the surface that uses it." });
      }
      return;
    case "button":
      inspectAction(component.action, `${path}/action`, scope, state.surfaceIds, state.collections, state.issues);
      return;
    case "calendar":
    case "text":
      return;
  }
};

const inspectInteraction = (
  interaction: InteractionDefinition,
  path: string,
  context: {
    componentsById: Map<string, ComponentNode>;
    collections: CustomCollectionSchema[];
    resourceIds: Set<string>;

    surfaceIds: Set<string>;
    surfaceOf: Map<string, string>;
  },
  issues: ValidationIssue[],
) => {
  const source = context.componentsById.get(interaction.source.componentId);
  const target = context.componentsById.get(interaction.target.componentId);
  if (!source) {
    issues.push({ path: `${path}/source/componentId`, message: `Unknown component '${interaction.source.componentId}'.`, suggestion: "get_ui_outline lists every component id and whether it can be dragged from or dropped onto." });
    return;
  }
  if (!target) {
    issues.push({ path: `${path}/target/componentId`, message: `Unknown component '${interaction.target.componentId}'.` });
    return;
  }

  const sourceSurface = context.surfaceOf.get(interaction.source.componentId);
  const targetSurface = context.surfaceOf.get(interaction.target.componentId);
  if (sourceSurface && targetSurface && sourceSurface !== targetSurface) {
    issues.push({
      path: `${path}/target/componentId`,
      message: `'${source.id}' is on screen '${sourceSurface}' and '${target.id}' is on '${targetSurface}'. A drag cannot cross screens, so this binding would never fire.`,
      suggestion: "Put a drag source on the same screen as the drop target, for example by inserting a meal list into that screen's extendable slot.",
    });
  }

  const drag = dragCapabilityFor(source, context.collections);
  const drop = dropCapabilityFor(target, context.collections);
  if (!drag) {
    issues.push({ path: `${path}/source/componentId`, message: `Component '${source.id}' is not a drag source.`, suggestion: "Only meal and custom-collection lists can be picked up." });
    return;
  }
  if (!drop) {
    issues.push({ path: `${path}/target/componentId`, message: `Component '${target.id}' is not a drop target.`, suggestion: "Only calendars and custom-collection lists accept drops." });
    return;
  }
  if (interaction.source.type !== drag.type) {
    issues.push({ path: `${path}/source/type`, message: `Component '${source.id}' produces drag type '${drag.type}', not '${interaction.source.type}'.` });
  }
  if (!interaction.target.accepts.includes(drag.type)) {
    issues.push({ path: `${path}/target/accepts`, message: `The drop target must accept '${drag.type}' for this binding to ever fire.` });
  }
  if (!drop.actions.includes(interaction.target.action.id)) {
    issues.push({ path: `${path}/target/action/id`, message: `Dropping onto '${target.id}' cannot run '${interaction.target.action.id}'.`, suggestion: `Allowed here: ${drop.actions.join(", ")}.` });
  }

  const dragFields = new Set(drag.fields);
  const payloadNames = new Set(Object.keys(interaction.source.payload));
  for (const [name, expression] of Object.entries(interaction.source.payload)) {
    inspectExpression(expression, `${path}/source/payload/${name}`, { resourceIds: context.resourceIds }, issues);
    if (expression.op === "field" && !dragFields.has(expression.name)) {
      issues.push({ path: `${path}/source/payload/${name}`, message: `Dragged items from '${source.id}' do not carry '${expression.name}'.`, suggestion: `Available: ${drag.fields.join(", ")}.` });
    }
    if (expression.op === "mealField" && !dragFields.has(expression.mealRefField)) {
      issues.push({ path: `${path}/source/payload/${name}`, message: `Dragged items from '${source.id}' do not carry '${expression.mealRefField}'.` });
    }
  }

  inspectAction(
    interaction.target.action,
    `${path}/target/action`,
    { resourceIds: context.resourceIds, draggedNames: payloadNames, cellNames: new Set(drop.cellFields) },
    context.surfaceIds,
    context.collections,
    issues,
  );
};

const collectComponents = (node: ComponentNode, into: Map<string, ComponentNode>) => {
  into.set(node.id, node);
  if (node.kind === "section" || node.kind === "grid") for (const child of node.children) collectComponents(child, into);
};

export const validateUserLayer = (input: unknown): ValidationResult<UserLayer> => {
  if (serializedSize(input) > LIMITS.manifestBytes) {
    return { ok: false, issues: [{ path: "/", message: `Configuration exceeds ${LIMITS.manifestBytes} bytes.` }] };
  }
  const shapeIssues = validateShape(input, userLayerSchema as unknown as JsonSchema);
  if (shapeIssues.length) return { ok: false, issues: shapeIssues };

  const layer = input as UserLayer;
  const issues: ValidationIssue[] = [];
  if (layer.capabilityVersion !== CAPABILITY_VERSION) {
    issues.push({ path: "/capabilityVersion", message: `Unsupported capability version ${layer.capabilityVersion}.` });
  }
  if (!isBaseId(layer.baseId)) {
    return { ok: false, issues: [...issues, { path: "/baseId", message: `Unknown base '${String(layer.baseId)}'.` }] };
  }

  for (const surface of layer.surfaces) {
    if (baseElementIds.has(surface.id)) {
      issues.push({ path: `/surfaces`, message: `Surface id '${surface.id}' belongs to the developer base and cannot be redefined.`, suggestion: "Choose a new id, or hide the base surface if its policy allows it." });
    }
  }

  const resolved = resolveConfiguration(layer);
  const { configuration, index } = resolved;

  for (const patch of layer.patches) {
    if (patch.op === "hide") {
      const info = index.get(patch.targetId);
      if (info && !info.policy.hideable) issues.push({ path: "/patches", message: `Element '${patch.targetId}' is not hideable.`, suggestion: "The developer marks which base elements may be hidden; get_ui_outline reports the policy for each." });
    }
    if (patch.op === "move_surface") {
      const info = index.get(patch.surfaceId);
      if (info && !info.policy.movable) issues.push({ path: "/patches", message: `Surface '${patch.surfaceId}' cannot be reordered.` });
    }
    if (patch.op === "insert") {
      const info = index.get(patch.slotId);
      if (info && !info.policy.extendable) issues.push({ path: "/patches", message: `Element '${patch.slotId}' does not accept inserted content.` });
    }
  }

  const collectionIds = new Set<string>();
  for (const [collectionIndex, collection] of configuration.collections.entries()) {
    if (collectionIds.has(collection.id)) issues.push({ path: `/collections/${collectionIndex}/id`, message: `Duplicate collection id '${collection.id}'.` });
    collectionIds.add(collection.id);
    const fieldIds = new Set<string>();
    for (const [fieldIndex, field] of collection.fields.entries()) {
      if (fieldIds.has(field.id)) issues.push({ path: `/collections/${collectionIndex}/fields/${fieldIndex}/id`, message: `Duplicate field id '${field.id}'.` });
      fieldIds.add(field.id);
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        issues.push({ path: `/collections/${collectionIndex}/fields/${fieldIndex}`, message: "Field minimum cannot exceed maximum." });
      }
    }
  }

  const activeCollectionIds = new Set(configuration.collections.filter((collection) => !collection.archived).map((collection) => collection.id));
  const resourceIds = new Set(["meals", "meal-plan", "grocery-list", ...activeCollectionIds]);
  const surfaceIds = new Set(configuration.surfaces.map((surface) => surface.id));
  if (configuration.surfaces.length > LIMITS.surfaces) issues.push({ path: "/surfaces", message: `The interface exceeds ${LIMITS.surfaces} surfaces.` });
  if (!configuration.surfaces.some((surface) => !surface.hidden)) issues.push({ path: "/surfaces", message: "At least one surface must stay visible." });

  const state: ComponentScanState = { count: 0, ids: new Map(), resourceIds, collectionIds: activeCollectionIds, collections: configuration.collections, surfaceIds, issues };
  for (const [surfaceIndex, surface] of configuration.surfaces.entries()) {
    inspectComponent(surface.root, `/surfaces/${surfaceIndex}/root`, state);
  }

  const surfaceOf = new Map([...index].map(([elementId, info]) => [elementId, info.surfaceId]));
  const componentsById = new Map<string, ComponentNode>();
  for (const surface of configuration.surfaces) collectComponents(surface.root, componentsById);

  const interactionIds = new Set<string>();
  for (const [interactionIndex, interaction] of configuration.interactions.entries()) {
    if (interactionIds.has(interaction.id)) issues.push({ path: `/interactions/${interactionIndex}/id`, message: `Duplicate interaction id '${interaction.id}'.` });
    interactionIds.add(interaction.id);
    inspectInteraction(
      interaction,
      `/interactions/${interactionIndex}`,
      { componentsById, collections: configuration.collections, resourceIds, surfaceIds, surfaceOf },
      issues,
    );
  }

  return issues.length ? { ok: false, issues } : { ok: true, value: layer };
};

export const validateOperations = (input: unknown): ValidationResult<UIChangeOperation[]> => {
  if (serializedSize(input) > LIMITS.manifestBytes) {
    return { ok: false, issues: [{ path: "/", message: `Operation batch exceeds ${LIMITS.manifestBytes} bytes.` }] };
  }
  const shapeIssues = validateShape(input, operationBatchSchema as unknown as JsonSchema);
  if (shapeIssues.length) return { ok: false, issues: shapeIssues };
  return { ok: true, value: input as UIChangeOperation[] };
};
