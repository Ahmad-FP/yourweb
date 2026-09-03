import type { UIChangeOperation } from "../composition/types";

/**
 * A representative personalisation, written exactly as an assistant would send it: one atomic
 * batch of operations that adds a record type, a screen, a drag source and two interactions, then
 * hides and reorders part of the base. Shared by the suites that exercise the composition kernel.
 */
export const compositionFixture: UIChangeOperation[] = [
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
      id: "today",
      title: "Today",
      icon: "pulse",
      order: 0,
      root: {
        id: "today-root",
        kind: "section",
        eyebrow: "Added for you",
        title: "Today",
        description: "What you have eaten so far, and how it lands against your target.",
        children: [
          {
            id: "today-metrics",
            kind: "grid",
            columns: 2,
            children: [
              {
                id: "today-calories",
                kind: "metric",
                label: "Calories today",
                unit: "kcal",
                value: {
                  op: "sum",
                  source: { op: "filter", source: { op: "resource", id: "intake-log" }, where: { op: "eq", left: { op: "field", name: "date" }, right: { op: "today" } } },
                  value: { op: "multiply", left: { op: "mealField", mealRefField: "meal", field: "calories" }, right: { op: "field", name: "servings" } },
                },
              },
              {
                id: "today-protein",
                kind: "metric",
                label: "Protein today",
                unit: "g",
                value: {
                  op: "sum",
                  source: { op: "filter", source: { op: "resource", id: "intake-log" }, where: { op: "eq", left: { op: "field", name: "date" }, right: { op: "today" } } },
                  value: { op: "multiply", left: { op: "mealField", mealRefField: "meal", field: "protein" }, right: { op: "field", name: "servings" } },
                },
              },
            ],
          },
          {
            id: "today-progress",
            kind: "progress",
            label: "Toward 2,000 kcal",
            unit: "kcal",
            max: { op: "literal", value: 2000 },
            value: {
              op: "sum",
              source: { op: "filter", source: { op: "resource", id: "intake-log" }, where: { op: "eq", left: { op: "field", name: "date" }, right: { op: "today" } } },
              value: { op: "multiply", left: { op: "mealField", mealRefField: "meal", field: "calories" }, right: { op: "field", name: "servings" } },
            },
          },
          { id: "today-form", kind: "form", collectionId: "intake-log", title: "Log a meal", fields: ["date", "meal", "servings"], submitLabel: "Log meal" },
          { id: "today-picker", kind: "collection", title: "Pick from the catalog", query: { source: "meals", limit: 6 }, variant: "cards", emptyText: "No meals match this search yet." },
          {
            id: "today-entries",
            kind: "collection",
            title: "Logged today",
            query: { source: "intake-log", where: { op: "eq", left: { op: "field", name: "date" }, right: { op: "today" } } },
            variant: "table",
            fields: ["date", "meal", "servings"],
            emptyText: "Nothing logged yet. Drag a meal in, or use the form.",
          },
        ],
      },
    },
  },
  {
    // The developer opened the week screen's root section for extension, so a meal list can sit
    // beside the calendar. A drag never crosses screens, which is why the pair must share one.
    op: "insert_into_slot",
    slotId: "week-root",
    position: 0,
    node: {
      id: "week-picker",
      kind: "collection",
      title: "Drag a meal into your week",
      query: { source: "meals", limit: 6 },
      variant: "cards",
      emptyText: "No meals match this search yet.",
    },
  },
  {
    op: "bind_interaction",
    interaction: {
      id: "plan-by-dragging",
      label: "Drag a meal onto a day",
      source: {
        componentId: "week-picker",
        type: "meal",
        payload: { mealId: { op: "field", name: "id" }, mealName: { op: "field", name: "name" } },
      },
      target: {
        componentId: "week-calendar",
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
        componentId: "today-picker",
        type: "meal",
        payload: { mealId: { op: "field", name: "id" }, mealName: { op: "field", name: "name" } },
      },
      target: {
        componentId: "today-entries",
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
  { op: "hide_element", targetId: "week-metrics" },
  { op: "move_surface", surfaceId: "week", order: 1 },
];
