import { CAPABILITY_VERSION, LIMITS } from "./limits";
import { configurationSchema, operationBatchSchema } from "./schemas";
import type { ComponentNode, Expression, UIChangeOperation, UIConfiguration, ValidationIssue, ValidationResult } from "./types";

type JsonSchema = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const schemaRecord = (value: unknown): JsonSchema | null => isRecord(value) ? value : null;

const resolveReference = (reference: string, root: JsonSchema): JsonSchema | null => {
  const [documentId, fragment = ""] = reference.split("#", 2);
  let current: unknown = documentId === "yourweb-ui-configuration" ? configurationSchema : root;
  if (!fragment) return schemaRecord(current);
  for (const rawPart of fragment.replace(/^\//, "").split("/")) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isRecord(current) || !(part in current)) return null;
    current = current[part];
  }
  return schemaRecord(current);
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
    return validateSchema(value, resolved, path, schema.$ref.startsWith("yourweb-ui-configuration") ? configurationSchema as JsonSchema : root, issues);
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

  const expectedTypes = typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type) ? schema.type.filter((item): item is string => typeof item === "string") : [];
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
    const itemSchema = schemaRecord(schema.items);
    if (itemSchema) value.forEach((item, index) => validateSchema(item, itemSchema, `${path}/${index}`, root, issues));
  }

  if (isRecord(value)) {
    const properties = schemaRecord(schema.properties) ?? {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !Object.hasOwn(value, key)) issues.push({ path: `${path}/${key}`, message: "Required value is missing." });
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) issues.push({ path: `${path}/${key}`, message: "Unknown field.", suggestion: "Remove fields that are not part of the declared capability schema." });
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

const inspectExpression = (
  expression: Expression,
  path: string,
  resourceIds: Set<string>,
  issues: ValidationIssue[],
  depth = 0,
) => {
  if (depth > LIMITS.expressionDepth) {
    issues.push({ path, message: `Expression exceeds the maximum depth of ${LIMITS.expressionDepth}.` });
    return;
  }
  switch (expression.op) {
    case "resource":
      if (!resourceIds.has(expression.id)) issues.push({ path: `${path}/id`, message: `Unknown resource '${expression.id}'.`, suggestion: "Use a built-in resource or create the collection in the same preview." });
      return;
    case "add":
    case "subtract":
    case "multiply":
    case "divide":
    case "eq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      inspectExpression(expression.left, `${path}/left`, resourceIds, issues, depth + 1);
      inspectExpression(expression.right, `${path}/right`, resourceIds, issues, depth + 1);
      return;
    case "filter":
      inspectExpression(expression.source, `${path}/source`, resourceIds, issues, depth + 1);
      inspectExpression(expression.where, `${path}/where`, resourceIds, issues, depth + 1);
      return;
    case "sum":
      inspectExpression(expression.source, `${path}/source`, resourceIds, issues, depth + 1);
      inspectExpression(expression.value, `${path}/value`, resourceIds, issues, depth + 1);
      return;
    case "count":
      inspectExpression(expression.source, `${path}/source`, resourceIds, issues, depth + 1);
      return;
    case "literal":
    case "field":
    case "mealField":
    case "today":
    case "currentWeek":
      return;
  }
};

const inspectComponent = (
  component: ComponentNode,
  path: string,
  state: {
    count: number;
    ids: Set<string>;
    resourceIds: Set<string>;
    collectionIds: Set<string>;
    surfaceIds: Set<string>;
    issues: ValidationIssue[];
  },
  depth = 1,
) => {
  state.count += 1;
  if (state.count > LIMITS.components) state.issues.push({ path, message: `Configuration exceeds ${LIMITS.components} components.` });
  if (depth > LIMITS.componentDepth) state.issues.push({ path, message: `Component tree exceeds depth ${LIMITS.componentDepth}.` });
  if (state.ids.has(component.id)) state.issues.push({ path: `${path}/id`, message: `Duplicate component id '${component.id}'.` });
  state.ids.add(component.id);

  switch (component.kind) {
    case "section":
    case "grid":
      component.children.forEach((child, index) => inspectComponent(child, `${path}/children/${index}`, state, depth + 1));
      return;
    case "metric":
      inspectExpression(component.value, `${path}/value`, state.resourceIds, state.issues);
      return;
    case "progress":
      inspectExpression(component.value, `${path}/value`, state.resourceIds, state.issues);
      inspectExpression(component.max, `${path}/max`, state.resourceIds, state.issues);
      return;
    case "collection":
      if (!state.resourceIds.has(component.query.source)) state.issues.push({ path: `${path}/query/source`, message: `Unknown resource '${component.query.source}'.` });
      if (component.query.where) inspectExpression(component.query.where, `${path}/query/where`, state.resourceIds, state.issues);
      return;
    case "recipe":
      inspectExpression(component.mealId, `${path}/mealId`, state.resourceIds, state.issues);
      return;
    case "form":
      if (!state.collectionIds.has(component.collectionId)) state.issues.push({ path: `${path}/collectionId`, message: `Form requires active custom collection '${component.collectionId}'.`, suggestion: "Upsert the collection in the same preview before the surface." });
      return;
    case "button":
      for (const [name, value] of Object.entries(component.action.args)) {
        if (value) inspectExpression(value, `${path}/action/args/${name}`, state.resourceIds, state.issues);
      }
      if (component.action.id === "navigate") {
        const target = component.action.args.surfaceId;
        if (target.op === "literal" && typeof target.value === "string" && !state.surfaceIds.has(target.value)) {
          state.issues.push({ path: `${path}/action/args/surfaceId`, message: `Unknown surface '${target.value}'.` });
        }
      }
      return;
    case "text":
      return;
  }
};

export const validateConfiguration = (input: unknown): ValidationResult<UIConfiguration> => {
  if (serializedSize(input) > LIMITS.manifestBytes) {
    return { ok: false, issues: [{ path: "/", message: `Configuration exceeds ${LIMITS.manifestBytes} bytes.` }] };
  }
  const shapeIssues = validateShape(input, configurationSchema as JsonSchema);
  if (shapeIssues.length) return { ok: false, issues: shapeIssues };

  const configuration = input as UIConfiguration;
  const issues: ValidationIssue[] = [];
  if (configuration.capabilityVersion !== CAPABILITY_VERSION) {
    issues.push({ path: "/capabilityVersion", message: `Unsupported capability version ${configuration.capabilityVersion}.` });
  }

  const surfaceIds = new Set<string>();
  for (const [index, surface] of configuration.surfaces.entries()) {
    if (surfaceIds.has(surface.id)) issues.push({ path: `/surfaces/${index}/id`, message: `Duplicate surface id '${surface.id}'.` });
    surfaceIds.add(surface.id);
  }

  const collectionIds = new Set<string>();
  for (const [collectionIndex, collection] of configuration.collections.entries()) {
    if (collectionIds.has(collection.id)) issues.push({ path: `/collections/${collectionIndex}/id`, message: `Duplicate collection id '${collection.id}'.` });
    collectionIds.add(collection.id);
    const fieldIds = new Set<string>();
    for (const [fieldIndex, field] of collection.fields.entries()) {
      if (fieldIds.has(field.id)) issues.push({ path: `/collections/${collectionIndex}/fields/${fieldIndex}/id`, message: `Duplicate field id '${field.id}'.` });
      fieldIds.add(field.id);
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) issues.push({ path: `/collections/${collectionIndex}/fields/${fieldIndex}`, message: "Field minimum cannot exceed maximum." });
    }
  }

  const activeCollectionIds = new Set(configuration.collections.filter((collection) => !collection.archived).map((collection) => collection.id));
  const resourceIds = new Set(["meals", "meal-plan", "grocery-list", ...activeCollectionIds]);
  const componentState = { count: 0, ids: new Set<string>(), resourceIds, collectionIds: activeCollectionIds, surfaceIds, issues };
  configuration.surfaces.forEach((surface, index) => inspectComponent(surface.root, `/surfaces/${index}/root`, componentState));

  return issues.length ? { ok: false, issues } : { ok: true, value: configuration };
};

export const validateOperations = (input: unknown): ValidationResult<UIChangeOperation[]> => {
  if (serializedSize(input) > LIMITS.manifestBytes) {
    return { ok: false, issues: [{ path: "/", message: `Operation batch exceeds ${LIMITS.manifestBytes} bytes.` }] };
  }
  const shapeIssues = validateShape(input, operationBatchSchema as JsonSchema);
  if (shapeIssues.length) return { ok: false, issues: shapeIssues };
  return { ok: true, value: input as UIChangeOperation[] };
};
