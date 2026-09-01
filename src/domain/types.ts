export type MealSlot = "breakfast" | "lunch" | "dinner";
export type PlanAuthor = "human" | "agent";

export interface PlanEntry {
  id: string;
  date: string;
  slot: MealSlot;
  mealId: string;
  servings: number;
  author: PlanAuthor;
  updatedAt: string;
}

export interface MealPlanState {
  revision: number;
  entries: PlanEntry[];
}

export interface PlanChange {
  date: string;
  slot: MealSlot;
  mealId: string | null;
  servings?: number;
}

export interface PlanConflict {
  date: string;
  slot: MealSlot;
  existingMealId: string;
  requestedMealId: string | null;
}

export interface GroceryItem {
  key: string;
  name: string;
  quantity: number;
  unit: string;
  aisle: string;
  mealIds: string[];
}
