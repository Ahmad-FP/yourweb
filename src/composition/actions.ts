import { mealById } from "../catalog/meals";
import type { MealSlot } from "../domain/types";
import { evaluateExpression, type EvaluationContext } from "./expressions";
import type { ActionBinding, Expression, Scalar } from "./types";

export type ResolvedAction =
  | { id: "navigate"; surfaceId: string }
  | { id: "add_meal_to_plan"; mealId: string; date: string; slot: MealSlot; servings: number }
  | { id: "remove_meal_from_plan"; date: string; slot: MealSlot }
  | { id: "favorite_meal"; mealId: string }
  | { id: "log_record"; collectionId: string; values: Record<string, Scalar> };

export type ActionResolution =
  | { ok: true; action: ResolvedAction }
  | { ok: false; message: string };

/** The one place a bound action stops being data and becomes typed arguments. */
export interface ActionHost {
  applyPlanChanges(
    changes: { date: string; slot: MealSlot; mealId: string | null; servings?: number }[],
    author: "human" | "agent",
  ): Promise<{ ok: boolean; message?: string }>;
  toggleFavorite(mealId: string, source?: "human" | "agent"): Promise<boolean>;
  addCustomRecord(collectionId: string, values: Record<string, unknown>): Promise<{ ok: boolean; issues?: { message: string }[] }>;
}

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const value = (expression: Expression, context: EvaluationContext) => {
  const result = evaluateExpression(expression, context);
  return result.ok ? result.value : null;
};

const asText = (input: unknown) => (typeof input === "string" ? input : null);
const asSlot = (input: unknown): MealSlot | null => (SLOTS.includes(input as MealSlot) ? (input as MealSlot) : null);
const asScalar = (input: unknown): Scalar => {
  if (input === null || typeof input === "string" || typeof input === "boolean") return input;
  if (typeof input === "number" && Number.isFinite(input)) return input;
  return null;
};

export const resolveAction = (action: ActionBinding, context: EvaluationContext): ActionResolution => {
  switch (action.id) {
    case "navigate": {
      const surfaceId = asText(value(action.args.surfaceId, context));
      return surfaceId ? { ok: true, action: { id: "navigate", surfaceId } } : { ok: false, message: "The navigation target did not resolve to a surface id." };
    }
    case "favorite_meal": {
      const mealId = asText(value(action.args.mealId, context));
      if (!mealId || !mealById.has(mealId)) return { ok: false, message: "That meal id is not in the catalog." };
      return { ok: true, action: { id: "favorite_meal", mealId } };
    }
    case "remove_meal_from_plan": {
      const date = asText(value(action.args.date, context));
      const slot = asSlot(value(action.args.slot, context));
      if (!date || !ISO_DATE.test(date) || !slot) return { ok: false, message: "The slot to clear did not resolve to a date and a meal slot." };
      return { ok: true, action: { id: "remove_meal_from_plan", date, slot } };
    }
    case "add_meal_to_plan": {
      const mealId = asText(value(action.args.mealId, context));
      const date = asText(value(action.args.date, context));
      const slot = asSlot(value(action.args.slot, context));
      const raw = action.args.servings ? value(action.args.servings, context) : 1;
      const servings = typeof raw === "number" && Number.isFinite(raw) && raw > 0 && raw <= 12 ? raw : 1;
      if (!mealId || !mealById.has(mealId)) return { ok: false, message: "That meal id is not in the catalog." };
      if (!date || !ISO_DATE.test(date) || !slot) return { ok: false, message: "The destination did not resolve to a date and a meal slot." };
      return { ok: true, action: { id: "add_meal_to_plan", mealId, date, slot, servings } };
    }
    case "log_record": {
      const collectionId = asText(value(action.args.collectionId, context));
      if (!collectionId) return { ok: false, message: "The record type did not resolve." };
      const values: Record<string, Scalar> = {};
      for (const [name, expression] of Object.entries(action.args.values)) values[name] = asScalar(value(expression, context));
      return { ok: true, action: { id: "log_record", collectionId, values } };
    }
  }
};

export const performAction = async (
  action: ResolvedAction,
  host: ActionHost,
  navigate?: (surfaceId: string) => void,
): Promise<{ ok: boolean; message: string }> => {
  switch (action.id) {
    case "navigate":
      navigate?.(action.surfaceId);
      return { ok: true, message: `Opened ${action.surfaceId}.` };
    case "favorite_meal": {
      const saved = await host.toggleFavorite(action.mealId, "human");
      return { ok: true, message: saved ? "Saved to your meals." : "Removed from your meals." };
    }
    case "remove_meal_from_plan": {
      const result = await host.applyPlanChanges([{ date: action.date, slot: action.slot, mealId: null }], "human");
      return { ok: result.ok, message: result.ok ? `Cleared ${action.slot} on ${action.date}.` : result.message ?? "That slot could not be cleared." };
    }
    case "add_meal_to_plan": {
      const result = await host.applyPlanChanges([{ date: action.date, slot: action.slot, mealId: action.mealId, servings: action.servings }], "human");
      const name = mealById.get(action.mealId)?.name ?? action.mealId;
      return { ok: result.ok, message: result.ok ? `${name} planned for ${action.slot} on ${action.date}.` : result.message ?? "That meal could not be planned." };
    }
    case "log_record": {
      const result = await host.addCustomRecord(action.collectionId, action.values);
      return { ok: result.ok, message: result.ok ? "Logged." : result.issues?.map((issue) => issue.message).join(" ") ?? "That record could not be saved." };
    }
  }
};
