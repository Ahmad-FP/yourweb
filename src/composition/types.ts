export type Scalar = string | number | boolean | null;

export type MealSlot = "breakfast" | "lunch" | "dinner";

export type Expression =
  | { op: "literal"; value: Scalar }
  | { op: "resource"; id: string }
  | { op: "field"; name: string }
  /** A value carried by the item currently being dragged. Only valid inside an interaction. */
  | { op: "dragged"; name: string }
  /** A value describing the drop cell under the pointer. Only valid inside an interaction. */
  | { op: "cell"; name: string }
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

export type ActionId =
  | "navigate"
  | "add_meal_to_plan"
  | "remove_meal_from_plan"
  | "favorite_meal"
  | "log_record";

export type ActionBinding =
  | { id: "navigate"; args: { surfaceId: Expression } }
  | { id: "add_meal_to_plan"; args: { mealId: Expression; date: Expression; slot: Expression; servings?: Expression } }
  | { id: "remove_meal_from_plan"; args: { date: Expression; slot: Expression } }
  | { id: "favorite_meal"; args: { mealId: Expression } }
  | { id: "log_record"; args: { collectionId: Expression; values: Record<string, Expression> } };

/**
 * What the developer permits a user layer to do to one base element. Everything is denied
 * unless the base opts in, so a shipped element is protected by default.
 */
export interface ElementPolicy {
  /** The element can be hidden from view. It is never deleted and can always be shown again. */
  hideable?: boolean;
  /** A surface can be reordered in the navigation. */
  movable?: boolean;
  /** A container accepts user-composed children appended after its own. */
  extendable?: boolean;
  /** The element can be removed outright. Base elements leave this off. */
  removable?: boolean;
}

interface ComponentBase {
  id: string;
  kind: string;
  className?: "quiet" | "accent" | "inset";
  /** Only meaningful on developer-owned nodes; ignored on user-composed nodes. */
  policy?: ElementPolicy;
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
  columns: 1 | 2 | 3 | 4 | "auto" | "split";
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

/** A week grid of day-by-slot cells. Every cell is addressable as a drop target. */
export interface CalendarComponent extends ComponentBase {
  kind: "calendar";
  title?: string;
  slots: MealSlot[];
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
  | CalendarComponent
  | RecipeComponent
  | FormComponent
  | ButtonComponent;

export type ComponentKind = ComponentNode["kind"];

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
  /** Derive read/write WebMCP tools from this schema so the assistant can use what it built. */
  exposeTools?: boolean;
}

export interface SurfaceDefinition {
  id: string;
  title: string;
  shortTitle?: string;
  icon?: "spark" | "market" | "calendar" | "basket" | "plus" | "pulse";
  order: number;
  root: ComponentNode;
  policy?: ElementPolicy;
}

/**
 * A drag-and-drop behaviour composed on top of two existing components. Interactions live in the
 * user layer, so one can be attached to developer-owned components without editing them.
 */
export interface InteractionDefinition {
  id: string;
  label: string;
  source: {
    componentId: string;
    /** A tag both halves agree on, such as "meal". */
    type: string;
    /** Values lifted off the dragged record. Expressions may read field and mealField. */
    payload: Record<string, Expression>;
  };
  target: {
    componentId: string;
    accepts: string[];
    /** Runs on drop. Its expressions may read dragged and cell. */
    action: ActionBinding;
  };
  enabled?: boolean;
}

export type BaseId = "simple" | "dense";

/** The developer-owned half. Shipped in code, never written by a user or an agent. */
export interface BaseDefinition {
  id: BaseId;
  name: string;
  tagline: string;
  revision: number;
  surfaces: SurfaceDefinition[];
  collections: CustomCollectionSchema[];
}

export type LayerPatch =
  | { op: "hide"; targetId: string }
  | { op: "move_surface"; surfaceId: string; order: number }
  | { op: "insert"; slotId: string; node: ComponentNode; position?: number };

/** The user-owned half. This is what persists, and the only thing an agent can change. */
export interface UserLayer {
  schemaVersion: 2;
  capabilityVersion: 2;
  baseId: BaseId;
  /** Increments on every committed change; used for optimistic concurrency. */
  revision: number;
  patches: LayerPatch[];
  surfaces: SurfaceDefinition[];
  collections: CustomCollectionSchema[];
  interactions: InteractionDefinition[];
}

export type ElementOwner = "developer" | "user";

export interface ResolvedSurface extends SurfaceDefinition {
  owner: ElementOwner;
  hidden: boolean;
}

export interface ResolvedConfiguration {
  baseId: BaseId;
  baseName: string;
  baseRevision: number;
  revision: number;
  surfaces: ResolvedSurface[];
  collections: CustomCollectionSchema[];
  interactions: InteractionDefinition[];
}

export interface ElementInfo {
  id: string;
  kind: ComponentKind | "surface";
  owner: ElementOwner;
  surfaceId: string;
  policy: ElementPolicy;
  hidden: boolean;
  /** Set when the node came from an insert patch rather than from the base or a user surface. */
  insertedIntoSlot?: string;
}

export type UIChangeOperation =
  | { op: "upsert_surface"; surface: SurfaceDefinition }
  | { op: "remove_surface"; surfaceId: string }
  | { op: "hide_element"; targetId: string }
  | { op: "show_element"; targetId: string }
  | { op: "move_surface"; surfaceId: string; order: number }
  | { op: "insert_into_slot"; slotId: string; node: ComponentNode; position?: number }
  | { op: "remove_inserted"; nodeId: string }
  | { op: "upsert_collection"; collection: CustomCollectionSchema }
  | { op: "remove_collection"; collectionId: string }
  | { op: "bind_interaction"; interaction: InteractionDefinition }
  | { op: "unbind_interaction"; interactionId: string };

export interface CustomRecord {
  id: string;
  collectionId: string;
  values: Record<string, Scalar>;
  createdAt: string;
  updatedAt: string;
}

export interface LayerHistoryEntry {
  id: string;
  timestamp: string;
  author: "human" | "agent" | "import" | "system";
  summary: string;
  layer: UserLayer;
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  source: "human" | "agent" | "system";
  title: string;
  detail: string;
  status: "success" | "warning" | "error" | "pending";
}

export interface ValidationIssue {
  path: string;
  message: string;
  suggestion?: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };
