/**
 * Which meal fields a collection may list in `fields`.
 *
 * This lives beside the schema rather than in the view because both sides have
 * to agree: `get_ui_outline` reports this list as what a meal collection can be
 * asked to show, and the meal views render from it. When only the view knew,
 * `fields` was accepted, reported as valid, and then silently ignored.
 */
export const MEAL_VIEW_FIELDS = [
  "mealType", "cuisine", "prepMinutes", "servings",
  "calories", "protein", "carbs", "fat", "fiber",
] as const;

export type MealViewField = (typeof MEAL_VIEW_FIELDS)[number];

/** What a meal collection shows when `fields` is not given. */
export const MEAL_VIEW_FIELDS_DEFAULT: MealViewField[] = [
  "mealType", "prepMinutes", "calories", "protein", "fiber",
];

/**
 * The name is the card and the row, so it is always drawn. The summary is
 * optional and only appears on cards; naming any field at all drops it unless
 * it is named too.
 */
export const MEAL_ALWAYS_SHOWN = "name";
export const MEAL_SUMMARY_FIELD = "summary";

export const isMealViewField = (field: string): field is MealViewField =>
  (MEAL_VIEW_FIELDS as readonly string[]).includes(field);
