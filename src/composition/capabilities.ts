import { CAPABILITY_VERSION, LIMITS } from "./limits";

export const capabilityCatalog = {
  version: CAPABILITY_VERSION,
  model: "resources → expressions → views → surfaces → interactions",
  invariant: "All configuration is inert JSON interpreted by a trusted renderer. HTML, CSS, JavaScript, URLs, fetches, loops, recursion, and user-defined functions are unavailable.",
  resources: {
    meals: ["id", "name", "summary", "creator", "tags", "cuisine", "mealType", "prepMinutes", "servings", "calories", "protein", "carbs", "fat", "fiber"],
    "meal-plan": ["id", "date", "slot", "mealId", "servings", "author", "updatedAt"],
    "grocery-list": ["key", "name", "quantity", "unit", "aisle", "mealIds"],
    custom: "A preview may upsert collections with text, number, boolean, date, and mealRef fields.",
  },
  components: {
    section: "Optional eyebrow/title/description plus children.",
    grid: "1-4 or auto columns plus children; comfortable or compact density.",
    text: "Plain bounded text; body, caption, lead, or display.",
    metric: "Label plus numeric expression and optional unit.",
    progress: "Label, numeric value expression, numeric max expression.",
    collection: "Bounded query rendered as cards, list, or table.",
    recipe: "Trusted full recipe view for a meal ID expression.",
    form: "Create records in one active custom collection; fields come from its schema.",
    button: "Invoke one typed allow-listed action.",
  },
  expressions: ["literal", "resource", "field", "mealField", "today", "currentWeek", "add", "subtract", "multiply", "divide", "eq", "gt", "gte", "lt", "lte", "filter", "sum", "count"],
  actions: ["navigate", "add_meal_to_plan", "remove_meal_from_plan", "favorite_meal"],
  operations: ["upsert_surface", "remove_surface", "upsert_collection", "remove_collection"],
  limits: LIMITS,
  examples: {
    metric: { id: "meal-count", kind: "metric", label: "Meals planned", value: { op: "count", source: { op: "resource", id: "mealPlan" } } },
    customForm: { id: "intake-form", kind: "form", collectionId: "calorie-entries", fields: ["date", "meal", "servings"], submitLabel: "Log meal" },
  },
  workflow: ["Call get_ui_outline.", "Call preview_ui_changes with one atomic operation batch.", "Ask the user to approve the visible preview.", "Call apply_ui_preview with the returned previewId."],
} as const;
