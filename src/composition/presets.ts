import type { UIConfiguration } from "./types";

const minimal: UIConfiguration = {
  id: "minimal",
  name: "Minimal",
  version: 1,
  capabilityVersion: 1,
  presetBase: "minimal",
  collections: [],
  surfaces: [
    {
      id: "discover",
      title: "Discover",
      shortTitle: "Meals",
      icon: "market",
      order: 0,
      root: {
        id: "discover-root",
        kind: "section",
        title: "What do you want to cook?",
        description: "Search recipes by ingredient or dietary need, then add the ones you like to your week.",
        children: [
          {
            id: "discover-meals",
            kind: "collection",
            query: { source: "meals", limit: 6 },
            variant: "cards",
            emptyText: "No meals match this table yet.",
          },
        ],
      },
    },
    {
      id: "week",
      title: "My week",
      shortTitle: "Week",
      icon: "calendar",
      order: 1,
      root: {
        id: "week-root",
        kind: "section",
        title: "Plan your week",
        description: "See every meal in one place and build the grocery list as you go.",
        children: [
          {
            id: "week-overview",
            kind: "grid",
            columns: 2,
            children: [
              { id: "planned-count", kind: "metric", label: "Meals planned", value: { op: "count", source: { op: "resource", id: "meal-plan" } } },
              { id: "grocery-count", kind: "metric", label: "Grocery items", value: { op: "count", source: { op: "resource", id: "grocery-list" } } },
            ],
          },
          { id: "week-plan", kind: "collection", title: "Plan", query: { source: "meal-plan" }, variant: "table", emptyText: "Your week is open. Add a meal from Discover." },
          { id: "week-groceries", kind: "collection", title: "Groceries", query: { source: "grocery-list" }, variant: "list", emptyText: "Groceries appear when the plan does." },
        ],
      },
    },
  ],
};

const dense: UIConfiguration = {
  id: "dense",
  name: "Dense",
  version: 1,
  capabilityVersion: 1,
  presetBase: "dense",
  collections: [],
  surfaces: [
    {
      id: "overview",
      title: "Overview",
      icon: "spark",
      order: 0,
      root: {
        id: "overview-root",
        kind: "section",
        title: "This week",
        description: "Your current plan and grocery list in one place.",
        children: [
          {
            id: "overview-metrics",
            kind: "grid",
            columns: 3,
            density: "compact",
            children: [
              { id: "dense-plan-count", kind: "metric", label: "Planned", value: { op: "count", source: { op: "resource", id: "meal-plan" } }, unit: "meals" },
              { id: "dense-grocery-count", kind: "metric", label: "Groceries", value: { op: "count", source: { op: "resource", id: "grocery-list" } }, unit: "items" },
              { id: "dense-market-count", kind: "metric", label: "Available", value: { op: "count", source: { op: "resource", id: "meals" } }, unit: "recipes" },
            ],
          },
          { id: "dense-plan", kind: "collection", title: "Week", query: { source: "meal-plan" }, variant: "table", fields: ["date", "slot", "mealId", "servings", "author"] },
          { id: "dense-groceries", kind: "collection", title: "Grocery list", query: { source: "grocery-list", limit: 18 }, variant: "table", fields: ["name", "quantity", "unit", "aisle"] },
        ],
      },
    },
    {
      id: "market",
      title: "Market",
      icon: "market",
      order: 1,
      root: {
        id: "market-root",
        kind: "section",
        title: "All recipes",
        description: "Compare time and nutrition, then open a recipe for the full method.",
        children: [
          { id: "dense-meals", kind: "collection", query: { source: "meals" }, variant: "table", fields: ["name", "mealType", "prepMinutes", "calories", "protein", "fiber"] },
        ],
      },
    },
  ],
};

export const presets = {
  minimal,
  dense,
} as const;

export const createPresetFork = (preset: keyof typeof presets): UIConfiguration => {
  const source = structuredClone(presets[preset]);
  return {
    ...source,
    id: `active-${preset}`,
    name: source.name,
  };
};
