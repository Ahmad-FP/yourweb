import { mealById, meals } from "../catalog/meals";
import type { DietaryTag, Meal } from "../catalog/types";
import { LIMITS } from "../composition/limits";
import type { GroceryItem, MealPlanState, PlanChange, PlanConflict, PlanEntry } from "./types";

export interface MealSearchInput {
  query?: string;
  dietaryTags?: DietaryTag[];
  minProtein?: number;
  maxCalories?: number;
  mealType?: Meal["mealType"];
  limit?: number;
}

export const searchMeals = (input: MealSearchInput = {}) => {
  const query = input.query?.trim().toLocaleLowerCase();
  const limit = Math.min(Math.max(input.limit ?? 12, 1), LIMITS.searchResults);
  return meals
    .filter((meal) => {
      if (query && !`${meal.name} ${meal.summary} ${meal.cuisine} ${meal.creator.name} ${meal.tags.join(" ")}`.toLocaleLowerCase().includes(query)) return false;
      if (input.dietaryTags?.some((tag) => !meal.tags.includes(tag))) return false;
      if (input.minProtein !== undefined && meal.protein < input.minProtein) return false;
      if (input.maxCalories !== undefined && meal.calories > input.maxCalories) return false;
      if (input.mealType && meal.mealType !== input.mealType) return false;
      return true;
    })
    .slice(0, limit);
};

const confirmationTokens = new Map<string, { fingerprint: string; expiresAt: number }>();

const fingerprint = (revision: number, changes: PlanChange[]) => JSON.stringify({ revision, changes });

const issueConfirmationToken = (revision: number, changes: PlanChange[]) => {
  const token = crypto.randomUUID();
  confirmationTokens.set(token, { fingerprint: fingerprint(revision, changes), expiresAt: Date.now() + LIMITS.confirmationLifetimeMs });
  return token;
};

const consumeConfirmationToken = (token: string | undefined, revision: number, changes: PlanChange[]) => {
  if (!token) return false;
  const record = confirmationTokens.get(token);
  confirmationTokens.delete(token);
  return Boolean(record && record.expiresAt > Date.now() && record.fingerprint === fingerprint(revision, changes));
};

export type PlanUpdateResult =
  | { ok: true; plan: MealPlanState; changed: PlanEntry[]; removed: string[] }
  | { ok: false; code: string; message: string; issues?: Array<{ path: string; message: string }> }
  | { ok: false; code: "confirmation_required"; message: string; confirmation: { token: string; conflicts: PlanConflict[] } };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const updateMealPlan = (
  current: MealPlanState,
  changes: PlanChange[],
  author: "human" | "agent",
  options: { expectedRevision?: number; confirmationToken?: string } = {},
): PlanUpdateResult => {
  if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
    return { ok: false, code: "stale_plan", message: `Expected plan revision ${options.expectedRevision}, but the current revision is ${current.revision}.` };
  }
  if (!changes.length || changes.length > 21) return { ok: false, code: "invalid_changes", message: "Provide between 1 and 21 plan changes." };

  const issues: Array<{ path: string; message: string }> = [];
  const changeKeys = new Set<string>();
  changes.forEach((change, index) => {
    const key = `${change.date}:${change.slot}`;
    if (!ISO_DATE.test(change.date)) issues.push({ path: `/changes/${index}/date`, message: "Date must use YYYY-MM-DD." });
    if (!(["breakfast", "lunch", "dinner"] as const).includes(change.slot)) issues.push({ path: `/changes/${index}/slot`, message: "Slot must be breakfast, lunch, or dinner." });
    if (change.mealId !== null && !mealById.has(change.mealId)) issues.push({ path: `/changes/${index}/mealId`, message: `Unknown meal '${change.mealId}'.` });
    if (change.servings !== undefined && (!Number.isFinite(change.servings) || change.servings <= 0 || change.servings > 12)) issues.push({ path: `/changes/${index}/servings`, message: "Servings must be greater than 0 and at most 12." });
    if (changeKeys.has(key)) issues.push({ path: `/changes/${index}`, message: `Duplicate change for ${key}.` });
    changeKeys.add(key);
  });
  if (issues.length) return { ok: false, code: "invalid_changes", message: "Some plan changes are invalid.", issues };

  const byKey = new Map(current.entries.map((entry) => [`${entry.date}:${entry.slot}`, entry]));
  const conflicts: PlanConflict[] = [];
  if (author === "agent") {
    for (const change of changes) {
      const existing = byKey.get(`${change.date}:${change.slot}`);
      if (existing?.author === "human" && existing.mealId !== change.mealId) {
        conflicts.push({ date: change.date, slot: change.slot, existingMealId: existing.mealId, requestedMealId: change.mealId });
      }
    }
  }
  if (conflicts.length && !consumeConfirmationToken(options.confirmationToken, current.revision, changes)) {
    return {
      ok: false,
      code: "confirmation_required",
      message: `Are you sure? This would replace or remove ${conflicts.length} human-authored ${conflicts.length === 1 ? "meal" : "meals"}. Ask the user, then retry the exact changes with the confirmation token.`,
      confirmation: { token: issueConfirmationToken(current.revision, changes), conflicts },
    };
  }

  const changed: PlanEntry[] = [];
  const removed: string[] = [];
  const now = new Date().toISOString();
  for (const change of changes) {
    const key = `${change.date}:${change.slot}`;
    if (change.mealId === null) {
      if (byKey.delete(key)) removed.push(key);
      continue;
    }
    const entry: PlanEntry = {
      id: key,
      date: change.date,
      slot: change.slot,
      mealId: change.mealId,
      servings: change.servings ?? byKey.get(key)?.servings ?? 1,
      author,
      updatedAt: now,
    };
    byKey.set(key, entry);
    changed.push(entry);
  }

  return {
    ok: true,
    plan: { revision: current.revision + 1, entries: [...byKey.values()].sort((left, right) => left.id.localeCompare(right.id)) },
    changed,
    removed,
  };
};

export const deriveGroceryList = (entries: readonly PlanEntry[]): GroceryItem[] => {
  const aggregated = new Map<string, GroceryItem>();
  for (const entry of entries) {
    const meal = mealById.get(entry.mealId);
    if (!meal) continue;
    const scale = entry.servings / meal.servings;
    for (const ingredient of meal.ingredients) {
      const key = `${ingredient.name.toLocaleLowerCase()}:${ingredient.unit}`;
      const existing = aggregated.get(key);
      if (existing) {
        existing.quantity += ingredient.quantity * scale;
        if (!existing.mealIds.includes(meal.id)) existing.mealIds.push(meal.id);
      } else {
        aggregated.set(key, {
          key,
          name: ingredient.name,
          quantity: ingredient.quantity * scale,
          unit: ingredient.unit,
          aisle: ingredient.aisle,
          mealIds: [meal.id],
        });
      }
    }
  }
  return [...aggregated.values()]
    .map((item) => ({ ...item, quantity: Math.round(item.quantity * 100) / 100 }))
    .sort((left, right) => left.aisle.localeCompare(right.aisle) || left.name.localeCompare(right.name));
};

export const clearPlanConfirmationTokens = () => confirmationTokens.clear();
