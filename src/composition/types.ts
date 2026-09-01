export type Scalar = string | number | boolean | null;

export type Expression =
  | { op: "literal"; value: Scalar }
  | { op: "resource"; id: string }
  | { op: "field"; name: string }
  | {
      op: "mealField";
      mealRefField: string;
      field: "name" | "calories" | "protein" | "carbs" | "fat" | "fiber";
    }
  | { op: "today" }
  | { op: "currentWeek" }
  | { op: "add" | "subtract" | "multiply" | "divide" | "eq" | "gt" | "gte" | "lt" | "lte"; left: Expression; right: Expression }
  | { op: "filter"; source: Expression; where: Expression }
  | { op: "sum"; source: Expression; value: Expression }
  | { op: "count"; source: Expression };

export interface QuerySpec {
  source: string;
  where?: Expression;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  limit?: number;
}

export type ActionBinding =
  | { id: "navigate"; args: { surfaceId: Expression } }
  | { id: "add_meal_to_plan"; args: { mealId: Expression; date: Expression; slot: Expression; servings?: Expression } }
  | { id: "remove_meal_from_plan"; args: { date: Expression; slot: Expression } }
  | { id: "favorite_meal"; args: { mealId: Expression } };

interface ComponentBase {
  id: string;
  kind: string;
  className?: "quiet" | "accent" | "inset";
}

export interface SectionComponent extends ComponentBase {
  kind: "section";
  eyebrow?: string;
  title?: string;
  description?: string;
  children: ComponentNode[];
}

export interface GridComponent extends ComponentBase {
  kind: "grid";
  columns: 1 | 2 | 3 | 4 | "auto";
  density?: "comfortable" | "compact";
  children: ComponentNode[];
}

export interface TextComponent extends ComponentBase {
  kind: "text";
  text: string;
  variant?: "body" | "caption" | "lead" | "display";
}

export interface MetricComponent extends ComponentBase {
  kind: "metric";
  label: string;
  value: Expression;
  unit?: string;
  format?: "number" | "decimal";
}

export interface ProgressComponent extends ComponentBase {
  kind: "progress";
  label: string;
  value: Expression;
  max: Expression;
  unit?: string;
}

export interface CollectionComponent extends ComponentBase {
  kind: "collection";
  title?: string;
  query: QuerySpec;
  variant: "cards" | "list" | "table";
  fields?: string[];
  emptyText?: string;
}

export interface RecipeComponent extends ComponentBase {
  kind: "recipe";
  mealId: Expression;
}

export interface FormComponent extends ComponentBase {
  kind: "form";
  collectionId: string;
  title?: string;
  fields?: string[];
  submitLabel?: string;
}

export interface ButtonComponent extends ComponentBase {
  kind: "button";
  label: string;
  action: ActionBinding;
  variant?: "primary" | "secondary" | "quiet";
}

export type ComponentNode =
  | SectionComponent
  | GridComponent
  | TextComponent
  | MetricComponent
  | ProgressComponent
  | CollectionComponent
  | RecipeComponent
  | FormComponent
  | ButtonComponent;

export type CustomFieldType = "text" | "number" | "boolean" | "date" | "mealRef";

export interface CustomFieldSchema {
  id: string;
  label: string;
  type: CustomFieldType;
  required?: boolean;
  min?: number;
  max?: number;
  default?: Scalar;
}

export interface CustomCollectionSchema {
  id: string;
  name: string;
  description?: string;
  fields: CustomFieldSchema[];
  archived?: boolean;
}

export interface SurfaceDefinition {
  id: string;
  title: string;
  shortTitle?: string;
  icon?: "spark" | "market" | "calendar" | "basket" | "plus" | "pulse";
  order: number;
  root: ComponentNode;
}

export interface UIConfiguration {
  id: string;
  name: string;
  version: number;
  capabilityVersion: 1;
  presetBase: "minimal" | "dense";
  surfaces: SurfaceDefinition[];
  collections: CustomCollectionSchema[];
}

export type UIChangeOperation =
  | { op: "upsert_surface"; surface: SurfaceDefinition }
  | { op: "remove_surface"; surfaceId: string }
  | { op: "upsert_collection"; collection: CustomCollectionSchema }
  | { op: "remove_collection"; collectionId: string };

export interface CustomRecord {
  id: string;
  collectionId: string;
  values: Record<string, Scalar>;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigurationHistoryEntry {
  id: string;
  timestamp: string;
  author: "human" | "agent" | "import" | "system";
  summary: string;
  configuration: UIConfiguration;
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  source: "human" | "agent" | "system";
  title: string;
  detail: string;
  status: "success" | "warning" | "error" | "pending";
}

export interface PersistedAppState {
  configuration: UIConfiguration;
  activeSurfaceId: string;
  planRevision: number;
  favorites: string[];
  customRecords: CustomRecord[];
  history: ConfigurationHistoryEntry[];
  activity: ActivityEntry[];
}

export interface ValidationIssue {
  path: string;
  message: string;
  suggestion?: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };
