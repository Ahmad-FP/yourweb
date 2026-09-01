import { beforeEach, describe, expect, it } from "vitest";
import { clearPlanConfirmationTokens, deriveGroceryList, updateMealPlan } from "./mealPlan";

describe("meal plan commands", () => {
  beforeEach(clearPlanConfirmationTokens);

  it("returns an are-you-sure response for human-authored conflicts and permits a confirmed retry", () => {
    const current = {
      revision: 4,
      entries: [{ id: "2026-09-01:dinner", date: "2026-09-01", slot: "dinner" as const, mealId: "green-coconut-dal", servings: 1, author: "human" as const, updatedAt: "2026-09-01T00:00:00.000Z" }],
    };
    const changes = [{ date: "2026-09-01", slot: "dinner" as const, mealId: "miso-salmon-rice", servings: 1 }];
    const first = updateMealPlan(current, changes, "agent", { expectedRevision: 4 });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.code).toBe("confirmation_required");
    if (first.code !== "confirmation_required" || !("confirmation" in first)) return;
    expect(first.message).toContain("Are you sure?");
    const confirmed = updateMealPlan(current, changes, "agent", { expectedRevision: 4, confirmationToken: first.confirmation.token });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.plan.entries[0]?.author).toBe("agent");
  });

  it("derives groceries with scaled quantities", () => {
    const groceries = deriveGroceryList([{ id: "2026-09-01:dinner", date: "2026-09-01", slot: "dinner", mealId: "miso-salmon-rice", servings: 1, author: "human", updatedAt: "2026-09-01T00:00:00.000Z" }]);
    expect(groceries.find((item) => item.name === "salmon fillet")?.quantity).toBe(160);
  });
});
