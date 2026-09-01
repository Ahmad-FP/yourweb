export type DietaryTag =
  | "vegetarian"
  | "vegan"
  | "gluten-free"
  | "high-protein"
  | "quick"
  | "dairy-free";

export interface Creator {
  id: string;
  name: string;
  handle: string;
  location: string;
  color: string;
}

export interface Ingredient {
  name: string;
  quantity: number;
  unit: string;
  aisle: "produce" | "pantry" | "protein" | "dairy" | "bakery" | "frozen" | "spices";
}

export interface DiscussionPost {
  id: string;
  author: string;
  body: string;
  timeLabel: string;
}

export interface Meal {
  id: string;
  name: string;
  summary: string;
  image: string;
  imageAlt: string;
  accent: string;
  creator: Creator;
  tags: DietaryTag[];
  cuisine: string;
  mealType: "breakfast" | "lunch" | "dinner";
  prepMinutes: number;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  micros: {
    iron: number;
    calcium: number;
    potassium: number;
    vitaminC: number;
    sodium: number;
  };
  ingredients: Ingredient[];
  instructions: string[];
  discussion: DiscussionPost[];
}
