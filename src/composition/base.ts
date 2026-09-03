import { BASE_REVISION } from "./limits";
import type { BaseDefinition, BaseId } from "./types";

/**
 * The developer-owned half of the interface.
 *
 * Everything here ships in the bundle and is never written to IndexedDB, so shipping a new
 * revision of a base replaces this structure outright while the saved user layer, which only
 * ever holds patches keyed by these ids plus its own elements, is re-applied on top.
 *
 * Each element declares the policy the developer is willing to grant. Anything not granted is
 * refused by the composition kernel no matter what the assistant proposes.
 */

const simple: BaseDefinition = {
  id: "simple",
  name: "Simple",
  tagline: "Recipes first, with the week one tap away.",
  revision: BASE_REVISION,
  collections: [],
  surfaces: [
    {
      id: "discover",
      title: "Discover",
      shortTitle: "Meals",
      icon: "market",
      order: 0,
      policy: { movable: true },
      root: {
        id: "discover-root",
        kind: "section",
        title: "What do you want to cook?",
        description: "Search recipes by ingredient or dietary need, then add the ones you like to your week.",
        policy: { extendable: true },
        children: [
          {
            id: "discover-meals",
            kind: "collection",
            query: { source: "meals", limit: 12 },
            variant: "cards",
            emptyText: "No meals match this search yet.",
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
      policy: { movable: true },
      root: {
        id: "week-root",
        kind: "section",
        title: "Plan your week",
        description: "See every meal in one place and build the grocery list as you go.",
        policy: { extendable: true },
        children: [
          {
            id: "week-metrics",
            kind: "grid",
            columns: 2,
            policy: { hideable: true },
            children: [
              { id: "week-planned-count", kind: "metric", label: "Meals planned", value: { op: "count", source: { op: "resource", id: "meal-plan" } } },
              { id: "week-grocery-count", kind: "metric", label: "Grocery items", value: { op: "count", source: { op: "resource", id: "grocery-list" } } },
            ],
          },
          {
            id: "week-calendar",
            kind: "calendar",
            title: "Plan",
            slots: ["breakfast", "lunch", "dinner"],
            emptyText: "Your week is open. Add a meal from Discover.",
          },
          {
            id: "week-groceries",
            kind: "collection",
            title: "Groceries",
            query: { source: "grocery-list" },
            variant: "list",
            policy: { hideable: true },
            emptyText: "Groceries appear when the plan does.",
          },
        ],
      },
    },
  ],
};

const dense: BaseDefinition = {
  id: "dense",
  name: "Dense",
  tagline: "Plan, groceries and nutrition on one screen.",
  revision: BASE_REVISION,
  collections: [],
  surfaces: [
    {
      id: "overview",
      title: "Overview",
      icon: "spark",
      order: 0,
      policy: { movable: true },
      root: {
        id: "overview-root",
        kind: "section",
        title: "This week",
        description: "Your current plan and grocery list in one place.",
        policy: { extendable: true },
        children: [
          {
            id: "overview-metrics",
            kind: "grid",
            columns: 3,
            density: "compact",
            policy: { hideable: true },
            children: [
              { id: "dense-plan-count", kind: "metric", label: "Planned", value: { op: "count", source: { op: "resource", id: "meal-plan" } }, unit: "meals" },
              { id: "dense-grocery-count", kind: "metric", label: "Groceries", value: { op: "count", source: { op: "resource", id: "grocery-list" } }, unit: "items" },
              { id: "dense-market-count", kind: "metric", label: "Available", value: { op: "count", source: { op: "resource", id: "meals" } }, unit: "recipes" },
            ],
          },
          {
            id: "overview-calendar",
            kind: "calendar",
            title: "Week",
            slots: ["breakfast", "lunch", "dinner"],
            emptyText: "Nothing planned yet.",
          },
          {
            id: "overview-groceries",
            kind: "collection",
            title: "Grocery list",
            query: { source: "grocery-list", limit: 18 },
            variant: "table",
            policy: { hideable: true },
            emptyText: "Groceries appear when the plan does.",
          },
        ],
      },
    },
    {
      id: "catalog",
      title: "Catalog",
      shortTitle: "Meals",
      icon: "market",
      order: 1,
      policy: { movable: true },
      root: {
        id: "catalog-root",
        kind: "section",
        title: "All recipes",
        description: "Compare time and nutrition, then open a recipe for the full method.",
        policy: { extendable: true },
        children: [
          {
            id: "catalog-meals",
            kind: "collection",
            query: { source: "meals" },
            variant: "table",
            fields: ["name", "mealType", "prepMinutes", "calories", "protein", "fiber"],
            emptyText: "No meals match this search yet.",
          },
        ],
      },
    },
  ],
};

export const bases: Record<BaseId, BaseDefinition> = { simple, dense };

export const DEFAULT_BASE_ID: BaseId = "simple";

export const getBase = (id: BaseId): BaseDefinition => bases[id] ?? bases[DEFAULT_BASE_ID];

export const isBaseId = (value: unknown): value is BaseId => value === "simple" || value === "dense";

/** Every element id the developer owns, across every shipped base. */
export const baseElementIds = (() => {
  const ids = new Set<string>();
  const walk = (node: { id: string; children?: { id: string }[] }) => {
    ids.add(node.id);
    for (const child of (node as { children?: never[] }).children ?? []) walk(child);
  };
  for (const base of Object.values(bases)) {
    for (const surface of base.surfaces) {
      ids.add(surface.id);
      walk(surface.root as never);
    }
    for (const collection of base.collections) ids.add(collection.id);
  }
  return ids;
})();
