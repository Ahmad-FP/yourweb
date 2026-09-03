import { CAPABILITY_VERSION, LIMITS } from "./limits";

export const capabilityCatalog = {
  version: CAPABILITY_VERSION,
  model: "developer base + user layer -> resolved interface",
  invariant:
    "All configuration is inert JSON interpreted by a trusted renderer. HTML, CSS, JavaScript, URLs, fetches, loops, recursion, and user-defined functions are unavailable.",
  layering: {
    base: "Developer-owned screens shipped in the app bundle. Never written by a user or an assistant, and replaced wholesale when the developer ships an update.",
    layer: "The saved user half: hide/move/insert adjustments keyed by base element id, plus screens, record types and interactions of its own.",
    policy: "Each base element declares whether it may be hidden, moved or extended. Anything not declared is refused. get_ui_outline reports the policy for every element.",
    updates: "Because the layer only stores adjustments and its own elements, a new base revision keeps every personalisation whose target still exists.",
  },
  resources: {
    meals: ["id", "name", "summary", "creator", "tags", "cuisine", "mealType", "prepMinutes", "servings", "calories", "protein", "carbs", "fat", "fiber"],
    "meal-plan": ["id", "date", "slot", "mealId", "servings", "author", "updatedAt"],
    "grocery-list": ["key", "name", "quantity", "unit", "aisle", "mealIds"],
    custom: "A preview may upsert record types with text, number, boolean, date and mealRef fields.",
  },
  components: {
    section: "Optional eyebrow/title/description plus children.",
    grid: "1-4, auto, or split columns plus children; comfortable or compact density. Split is a wide primary column beside a narrow one, and stacks on a phone.",
    text: "Plain bounded text; body, caption, lead or display.",
    metric: "Label plus numeric expression and optional unit.",
    progress: "Label, numeric value expression, numeric max expression.",
    collection: "Bounded query rendered as cards, list or table. Meal and record collections can be drag sources; record collections can be drop targets.",
    calendar: "The week grid. Every day-and-slot cell is addressable as a drop target.",
    recipe: "Trusted full recipe view for a meal id expression.",
    form: "Create records in one active record type; fields come from its schema.",
    button: "Invoke one typed allow-listed action.",
  },
  expressions: ["literal", "resource", "field", "dragged", "cell", "mealField", "today", "currentWeek", "add", "subtract", "multiply", "divide", "eq", "gt", "gte", "lt", "lte", "filter", "sum", "count"],
  actions: ["navigate", "add_meal_to_plan", "remove_meal_from_plan", "favorite_meal", "log_record"],
  operations: [
    "upsert_surface",
    "remove_surface",
    "hide_element",
    "show_element",
    "move_surface",
    "insert_into_slot",
    "remove_inserted",
    "upsert_collection",
    "remove_collection",
    "bind_interaction",
    "unbind_interaction",
  ],
  interactions: {
    shape: "An interaction names a drag source component, the payload lifted off each dragged item, a drop target component, the drag types it accepts, and one allow-listed action to run on drop.",
    payload: "Payload expressions read the dragged record with field and mealField. The drop action reads them back with dragged, and reads the cell under the pointer with cell.",
    sameScreen: "A drag cannot cross screens, so both components must live on one surface. If the drop target is on a screen with no drag source, insert a meals collection into that screen's extendable slot first, in the same batch, and bind from it.",
    discovery: "get_ui_outline marks every component with dragProvides and dropAccepts, which say exactly what a binding between them may carry and run.",
  },
  derivedTools:
    "Setting exposeTools on a record type makes YourWeb derive list/add/remove WebMCP tools from its saved field schema, and each bound interaction derives a tool that runs the same drop. The tools are built by trusted app code from the schema; no generated code is ever executed.",
  limits: LIMITS,
  examples: {
    metric: { id: "meal-count", kind: "metric", label: "Meals planned", value: { op: "count", source: { op: "resource", id: "meal-plan" } } },
    customForm: { id: "intake-form", kind: "form", collectionId: "intake-log", fields: ["date", "meal", "servings"], submitLabel: "Log meal" },
    insertADragSource: {
      op: "insert_into_slot",
      slotId: "week-root",
      position: 0,
      node: { id: "week-picker", kind: "collection", title: "Drag a meal into your week", query: { source: "meals", limit: 6 }, variant: "cards" },
    },
    interaction: {
      id: "drag-meal-to-day",
      label: "Drag a meal onto a day",
      source: { componentId: "week-picker", type: "meal", payload: { mealId: { op: "field", name: "id" } } },
      target: {
        componentId: "week-calendar",
        accepts: ["meal"],
        action: {
          id: "add_meal_to_plan",
          args: { mealId: { op: "dragged", name: "mealId" }, date: { op: "cell", name: "date" }, slot: { op: "cell", name: "slot" } },
        },
      },
    },
  },
  workflow: [
    "Call get_ui_capabilities once to learn the grammar.",
    "Call get_ui_outline to read current ids, policy and drag/drop capability.",
    "Call preview_ui_changes with one atomic operation batch.",
    "Ask the user to approve the visible preview.",
    "Call apply_ui_preview with the returned previewId.",
  ],
} as const;
