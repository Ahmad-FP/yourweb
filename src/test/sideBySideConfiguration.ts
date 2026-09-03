import type { UIChangeOperation } from "../composition/types";

const todaysEntries = {
  op: "filter",
  source: { op: "resource", id: "intake-log" },
  where: { op: "eq", left: { op: "field", name: "date" }, right: { op: "today" } },
} as const;

const caloriesToday = {
  op: "sum",
  source: todaysEntries,
  value: { op: "multiply", left: { op: "mealField", mealRefField: "meal", field: "calories" }, right: { op: "field", name: "servings" } },
} as const;

/**
 * A second, more opinionated configuration, kept as an exported bundle rather than shipped.
 *
 * It collapses the two built-in screens into one workspace where the week and the catalogue sit
 * side by side, and puts a calorie tracker on the second tab. Neither built-in screen is deleted:
 * both are hidden, so showing them again restores them exactly.
 */
export const sideBySideOperations: UIChangeOperation[] = [
  {
    op: "upsert_collection",
    collection: {
      id: "intake-log",
      name: "Intake log",
      description: "What I actually ate, with servings.",
      exposeTools: true,
      fields: [
        { id: "date", label: "Date", type: "date", required: true },
        { id: "meal", label: "Meal", type: "mealRef", required: true },
        { id: "servings", label: "Servings", type: "number", required: true, min: 0.25, max: 12, default: 1 },
      ],
    },
  },
  {
    op: "upsert_surface",
    surface: {
      id: "kitchen",
      title: "Kitchen",
      icon: "calendar",
      order: 0,
      root: {
        id: "kitchen-root",
        kind: "section",
        eyebrow: "Your setup",
        title: "Your kitchen",
        description: "The week and the catalogue in one place. Drag a meal from the right onto any day.",
        children: [
          {
            id: "kitchen-split",
            kind: "grid",
            columns: "split",
            children: [
              {
                id: "kitchen-calendar",
                kind: "calendar",
                title: "This week",
                slots: ["breakfast", "lunch", "dinner"],
                emptyText: "Nothing planned yet. Drag something over from the catalogue.",
              },
              {
                id: "kitchen-market",
                kind: "collection",
                title: "Catalogue",
                query: { source: "meals", limit: 18 },
                variant: "cards",
                emptyText: "No meals match this search yet.",
              },
            ],
          },
          {
            id: "kitchen-groceries",
            kind: "collection",
            title: "Groceries",
            query: { source: "grocery-list" },
            variant: "list",
            emptyText: "Groceries appear as soon as the week fills up.",
          },
        ],
      },
    },
  },
  {
    op: "upsert_surface",
    surface: {
      id: "calories",
      title: "Calories",
      icon: "pulse",
      order: 1,
      root: {
        id: "calories-root",
        kind: "section",
        eyebrow: "Your setup",
        title: "Calories",
        description: "What you have eaten today, and how it lands against your target.",
        children: [
          {
            id: "calories-metrics",
            kind: "grid",
            columns: 3,
            density: "compact",
            children: [
              { id: "calories-total", kind: "metric", label: "Eaten today", unit: "kcal", value: caloriesToday },
              {
                id: "calories-protein",
                kind: "metric",
                label: "Protein today",
                unit: "g",
                value: {
                  op: "sum",
                  source: todaysEntries,
                  value: { op: "multiply", left: { op: "mealField", mealRefField: "meal", field: "protein" }, right: { op: "field", name: "servings" } },
                },
              },
              { id: "calories-count", kind: "metric", label: "Meals logged", unit: "today", value: { op: "count", source: todaysEntries } },
            ],
          },
          { id: "calories-progress", kind: "progress", label: "Toward 2,000 kcal", unit: "kcal", max: { op: "literal", value: 2000 }, value: caloriesToday },
          {
            id: "calories-split",
            kind: "grid",
            columns: "split",
            children: [
              {
                id: "calories-entries",
                kind: "collection",
                title: "Logged today",
                query: { source: "intake-log", where: { op: "eq", left: { op: "field", name: "date" }, right: { op: "today" } } },
                variant: "table",
                fields: ["date", "meal", "servings"],
                emptyText: "Nothing logged yet. Drag a meal in from the right, or use the form below.",
              },
              {
                id: "calories-market",
                kind: "collection",
                title: "Log by dragging",
                query: { source: "meals", limit: 18 },
                variant: "cards",
                emptyText: "No meals match this search yet.",
              },
            ],
          },
          { id: "calories-form", kind: "form", collectionId: "intake-log", title: "Or log it by hand", fields: ["date", "meal", "servings"], submitLabel: "Log meal" },
        ],
      },
    },
  },
  {
    op: "bind_interaction",
    interaction: {
      id: "plan-by-dragging",
      label: "Drag a meal onto a day",
      source: {
        componentId: "kitchen-market",
        type: "meal",
        payload: { mealId: { op: "field", name: "id" }, mealName: { op: "field", name: "name" } },
      },
      target: {
        componentId: "kitchen-calendar",
        accepts: ["meal"],
        action: {
          id: "add_meal_to_plan",
          args: {
            mealId: { op: "dragged", name: "mealId" },
            date: { op: "cell", name: "date" },
            slot: { op: "cell", name: "slot" },
            servings: { op: "literal", value: 1 },
          },
        },
      },
    },
  },
  {
    op: "bind_interaction",
    interaction: {
      id: "log-by-dragging",
      label: "Drag a meal into today's log",
      source: {
        componentId: "calories-market",
        type: "meal",
        payload: { mealId: { op: "field", name: "id" }, mealName: { op: "field", name: "name" } },
      },
      target: {
        componentId: "calories-entries",
        accepts: ["meal"],
        action: {
          id: "log_record",
          args: {
            collectionId: { op: "literal", value: "intake-log" },
            values: { date: { op: "today" }, meal: { op: "dragged", name: "mealId" }, servings: { op: "literal", value: 1 } },
          },
        },
      },
    },
  },
  { op: "hide_element", targetId: "discover" },
  { op: "hide_element", targetId: "week" },
];

export const SIDE_BY_SIDE_EXPORT_PATH = "artifacts/side-by-side.yourweb.json";
