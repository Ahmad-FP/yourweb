import { useMemo, useState, type CSSProperties } from "react";
import type { DietaryTag, Meal } from "../catalog/types";
import { mealById, meals } from "../catalog/meals";
import { appStore } from "../data/store";
import { searchMeals } from "../domain/mealPlan";
import type { GroceryItem, PlanEntry } from "../domain/types";
import { CalendarDays, ChevronRight, Heart, Plus, Search, ShoppingBasket, X } from "./icons";

const tagLabels: Record<DietaryTag, string> = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  "gluten-free": "Gluten-free",
  "high-protein": "High protein",
  quick: "Under 30 min",
  "dairy-free": "Dairy-free",
};

const currentDate = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${date}`;
};

const displayDate = (date: string, options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric" }) =>
  new Intl.DateTimeFormat("en", options).format(new Date(`${date}T12:00:00`));

const MealArtwork = ({ meal }: { meal: Meal }) => {
  const shared = <><ellipse className="plate" cx="300" cy="202" rx="224" ry="116" /><ellipse className="plate-rim" cx="300" cy="190" rx="190" ry="86" /></>;
  let ingredients;
  switch (meal.id) {
    case "miso-salmon-rice":
      ingredients = <><path className="grain" d="M138 181c38-54 111-70 168-27-26 69-95 101-161 62z" /><path className="main" d="M256 122c89-35 185 6 205 75-65 53-172 46-227-8z" /><path className="mark" d="M286 142c43 5 88 21 127 49M274 163c42 5 83 19 121 44" /><path className="green" d="M371 109c39-39 89-29 108 2-30 31-71 35-108-2zM405 238c34-43 79-42 105-14-23 35-67 48-105 14z" /></>;
      break;
    case "charred-chicken-peaches":
      ingredients = <><circle className="fruit" cx="186" cy="150" r="61" /><circle className="fruit-light" cx="413" cy="238" r="54" /><path className="main" d="M194 230c35-103 170-131 233-57-42 99-153 132-233 57z" /><path className="mark" d="M251 190l85 35m-68-65 91 37m-49-65 83 32" /><path className="green" d="M128 261c50-52 110-32 124 11-45 26-91 22-124-11z" /></>;
      break;
    case "green-coconut-dal":
      ingredients = <><ellipse className="bowl" cx="300" cy="198" rx="172" ry="105" /><ellipse className="soup" cx="300" cy="178" rx="145" ry="77" /><circle className="dot" cx="239" cy="163" r="15" /><circle className="dot" cx="340" cy="203" r="11" /><circle className="dot" cx="377" cy="147" r="8" /><path className="green" d="M183 92c43-36 88-19 92 16-40 24-71 18-92-16zM354 91c46-39 94-13 93 23-42 18-74 8-93-23z" /><path className="lime" d="M410 235a60 60 0 0 1 74-35l-37 55z" /></>;
      break;
    case "crispy-tofu-soba":
      ingredients = <><ellipse className="bowl" cx="300" cy="199" rx="177" ry="108" /><path className="noodle" d="M162 185c52-68 102 68 151 0s96 72 145-1M169 213c54-65 99 65 149 0s91 62 137-1" /><rect className="cube" x="206" y="111" width="72" height="62" rx="9" transform="rotate(-8 206 111)" /><rect className="cube-light" x="340" y="132" width="67" height="58" rx="9" transform="rotate(10 340 132)" /><path className="green" d="M131 121c49-36 93-6 85 32-43 16-71 5-85-32z" /></>;
      break;
    case "tomato-butter-beans":
      ingredients = <><path className="toast" d="M159 110c20-38 83-40 112-8l27 138-141 11z" /><circle className="fruit" cx="368" cy="139" r="51" /><circle className="fruit-light" cx="430" cy="215" r="38" /><ellipse className="bean" cx="266" cy="192" rx="32" ry="20" transform="rotate(22 266 192)" /><ellipse className="bean" cx="334" cy="239" rx="35" ry="21" transform="rotate(-17 334 239)" /><ellipse className="bean" cx="390" cy="180" rx="29" ry="18" transform="rotate(33 390 180)" /><path className="green" d="M279 93c44-38 93-12 90 25-40 19-71 9-90-25z" /></>;
      break;
    case "turmeric-chicken-bowl":
      ingredients = <><ellipse className="bowl" cx="300" cy="200" rx="178" ry="108" /><path className="grain" d="M148 185c46-80 159-97 224-28-40 78-145 104-224 28z" /><path className="main" d="M282 115c77-36 164 6 177 69-65 44-137 36-184-13z" /><path className="onion" d="M206 104c-38 28-40 67-8 89m34-91c-37 34-34 71-2 94" /><path className="green" d="M365 229c44-43 94-22 99 16-39 25-75 20-99-16z" /></>;
      break;
    default:
      ingredients = <><ellipse className="bowl" cx="300" cy="200" rx="178" ry="108" /><circle className="fruit" cx="218" cy="166" r="50" /><path className="main" d="M261 120c84-31 173 16 184 81-68 42-149 30-193-26z" /><path className="green" d="M148 239c46-45 99-25 104 17-42 24-79 18-104-17z" /></>;
  }
  return (
    <div className="food-image" style={{ "--meal-accent": meal.accent } as CSSProperties}>
      <svg viewBox="0 0 600 340" role="img" aria-label={`Illustration of ${meal.name}`}>
        <rect className="art-bg" width="600" height="340" rx="20" />
        <circle className="sun" cx="495" cy="61" r="34" />
        {shared}
        {ingredients}
        <path className="spark" d="M92 83l7 18 18 7-18 7-7 18-7-18-18-7 18-7z" />
      </svg>
    </div>
  );
};

export function MealMarket({ limit, dense, favorites, onSelect }: { limit?: number; dense: boolean; favorites: string[]; onSelect: (meal: Meal) => void }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<DietaryTag | "all">("all");
  const results = useMemo(
    () => searchMeals({ query, dietaryTags: tag === "all" ? undefined : [tag], limit: limit ?? 18 }),
    [limit, query, tag],
  );

  return (
    <div className={`market-view ${dense ? "is-dense" : "is-minimal"}`}>
      <div className="market-controls">
        <label className="search-control">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search recipes</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recipes, cooks, cuisines…" />
          {query ? <button type="button" className="icon-button tiny" onClick={() => setQuery("")} aria-label="Clear search"><X size={16} /></button> : null}
        </label>
        <label className="filter-control">
          <span>Filter</span>
          <select value={tag} onChange={(event) => setTag(event.target.value as DietaryTag | "all")}>
            <option value="all">Everything</option>
            {Object.entries(tagLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <span className="result-count" aria-live="polite">{results.length} of {meals.length}</span>
      </div>

      {results.length ? dense ? (
        <div className="dense-meal-table" role="table" aria-label="Meal catalog">
          <div className="dense-row dense-head" role="row">
            <span role="columnheader">Meal</span><span role="columnheader">Time</span><span role="columnheader">Energy</span><span role="columnheader">Protein</span><span role="columnheader">Fiber</span><span role="columnheader"><span className="sr-only">Open</span></span>
          </div>
          {results.map((meal) => (
            <button type="button" className="dense-row" role="row" key={meal.id} onClick={() => onSelect(meal)}>
              <span role="cell"><i style={{ background: meal.accent }} /> <b>{meal.name}</b><small>{meal.cuisine}</small></span>
              <span role="cell">{meal.prepMinutes} min</span>
              <span role="cell">{meal.calories} kcal</span>
              <span role="cell">{meal.protein}g</span>
              <span role="cell">{meal.fiber}g</span>
              <span role="cell"><ChevronRight size={17} /></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="meal-grid">
          {results.map((meal) => (
            <article className="meal-card" key={meal.id}>
              <button type="button" className="meal-card-main" onClick={() => onSelect(meal)} aria-label={`Open ${meal.name}`}>
                <MealArtwork meal={meal} />
                <div className="meal-card-copy">
                  <div className="meal-card-meta"><span>{meal.mealType}</span><span>{meal.prepMinutes} min</span></div>
                  <h3>{meal.name}</h3>
                  <p>{meal.summary}</p>
                  <div className="macro-line"><span><b>{meal.protein}g</b> protein</span><span><b>{meal.calories}</b> kcal</span><span><b>{meal.fiber}g</b> fiber</span></div>
                </div>
              </button>
              <button type="button" className={`save-meal ${favorites.includes(meal.id) ? "is-saved" : ""}`} aria-label={`${favorites.includes(meal.id) ? "Remove" : "Save"} ${meal.name}`} onClick={() => void appStore.toggleFavorite(meal.id)}>
                <Heart size={17} fill={favorites.includes(meal.id) ? "currentColor" : "none"} />
              </button>
            </article>
          ))}
        </div>
      ) : <div className="empty-state"><Search size={28} /><h3>No meals match</h3><p>Try a broader search or clear the dietary filter.</p></div>}
    </div>
  );
}

export function WeekPlanner({ entries, onSelectMeal }: { entries: PlanEntry[]; onSelectMeal: (meal: Meal) => void }) {
  const days = useMemo(() => {
    const now = new Date();
    const weekday = now.getDay() || 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + 1);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + index);
      const month = String(day.getMonth() + 1).padStart(2, "0");
      const date = String(day.getDate()).padStart(2, "0");
      return `${day.getFullYear()}-${month}-${date}`;
    });
  }, []);

  return (
    <div className="week-planner" aria-label="Weekly meal plan">
      {days.map((date) => {
        const dayEntries = entries.filter((entry) => entry.date === date);
        return (
          <section className={`day-column ${date === currentDate() ? "is-today" : ""}`} key={date}>
            <header><span>{displayDate(date, { weekday: "short" })}</span><b>{displayDate(date, { day: "numeric" })}</b></header>
            <div className="day-slots">
              {(["breakfast", "lunch", "dinner"] as const).map((slot) => {
                const entry = dayEntries.find((candidate) => candidate.slot === slot);
                const meal = entry ? mealById.get(entry.mealId) : null;
                return (
                  <div className={`plan-slot ${entry ? "is-filled" : ""}`} key={slot}>
                    <span>{slot}</span>
                    {entry && meal ? (
                      <>
                        <button type="button" onClick={() => onSelectMeal(meal)}>{meal.name}</button>
                        <small>{entry.author === "agent" ? "Assistant" : "You"}</small>
                        <button type="button" className="remove-slot" aria-label={`Remove ${meal.name} from ${displayDate(date)} ${slot}`} onClick={() => void appStore.applyPlanChanges([{ date, slot, mealId: null }], "human")}><X size={13} /></button>
                      </>
                    ) : <em>Open</em>}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function GroceryList({ items, dense = false }: { items: GroceryItem[]; dense?: boolean }) {
  if (!items.length) return <div className="empty-state compact"><ShoppingBasket size={24} /><h3>Nothing to buy yet</h3><p>Ingredients show up here once you add meals to your week.</p></div>;
  const byAisle = new Map<string, GroceryItem[]>();
  for (const item of items) byAisle.set(item.aisle, [...(byAisle.get(item.aisle) ?? []), item]);
  return (
    <div className={`grocery-groups ${dense ? "is-dense" : ""}`}>
      {[...byAisle.entries()].map(([aisle, aisleItems]) => (
        <section key={aisle}>
          <h3>{aisle}</h3>
          <ul>{aisleItems.map((item) => <li key={item.key}><span>{item.name}</span><b>{item.quantity} {item.unit}</b></li>)}</ul>
        </section>
      ))}
    </div>
  );
}

export function RecipeSheet({ meal, onClose }: { meal: Meal; onClose: () => void }) {
  const [date, setDate] = useState(currentDate());
  const [slot, setSlot] = useState<"breakfast" | "lunch" | "dinner">(meal.mealType);
  const [servings, setServings] = useState(1);
  const [planned, setPlanned] = useState(false);

  const addToPlan = async () => {
    const result = await appStore.applyPlanChanges([{ date, slot, mealId: meal.id, servings }], "human");
    if (result.ok) setPlanned(true);
  };

  return (
    <aside className="recipe-sheet" aria-label={`${meal.name} recipe`}>
      <button type="button" className="sheet-scrim" aria-label="Close recipe" onClick={onClose} />
      <div className="recipe-sheet-panel">
        <button type="button" className="icon-button sheet-close" aria-label="Close recipe" onClick={onClose}><X /></button>
        <MealArtwork meal={meal} />
        <div className="recipe-sheet-copy">
          <div className="recipe-title-line"><div><span>{meal.creator.name} · {meal.creator.location}</span><h2>{meal.name}</h2></div><button type="button" className="icon-button" onClick={() => void appStore.toggleFavorite(meal.id)} aria-label={`Save ${meal.name}`}><Heart /></button></div>
          <p className="recipe-summary">{meal.summary}</p>
          <div className="nutrition-band"><span><b>{meal.calories}</b> kcal</span><span><b>{meal.protein}g</b> protein</span><span><b>{meal.carbs}g</b> carbs</span><span><b>{meal.fat}g</b> fat</span><span><b>{meal.fiber}g</b> fiber</span></div>

          <form className="plan-form" onSubmit={(event) => { event.preventDefault(); void addToPlan(); }}>
            <div><CalendarDays size={21} /><strong>{planned ? "Added to your week" : "Add to your week"}</strong></div>
            <label><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label><span>Slot</span><select value={slot} onChange={(event) => setSlot(event.target.value as typeof slot)}><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option></select></label>
            <label><span>Servings</span><input type="number" min="0.25" max="12" step="0.25" value={servings} onChange={(event) => setServings(Number(event.target.value))} /></label>
            <button className="primary-button" type="submit"><Plus size={17} /> {planned ? "Update plan" : "Add to plan"}</button>
          </form>

          <div className="recipe-columns">
            <section><h3>Ingredients</h3><ul className="ingredient-list">{meal.ingredients.map((ingredient) => <li key={`${ingredient.name}-${ingredient.unit}`}><span>{ingredient.name}</span><b>{ingredient.quantity} {ingredient.unit}</b></li>)}</ul></section>
            <section><h3>Method</h3><ol>{meal.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol></section>
          </div>

          <section className="micro-section"><h3>Micronutrients</h3><div className="micro-bars">{Object.entries(meal.micros).map(([name, value]) => <div key={name}><span>{name.replace(/([A-Z])/g, " $1")}</span><i><b style={{ width: `${Math.min(value, 100)}%` }} /></i><strong>{value}% DV</strong></div>)}</div></section>

          <section className="discussion"><div><h3>Comments</h3><span>Sample content</span></div>{meal.discussion.map((entry) => <article key={entry.id}><b>{entry.author}</b><p>{entry.body}</p><small>{entry.timeLabel}</small></article>)}</section>
        </div>
      </div>
    </aside>
  );
}
