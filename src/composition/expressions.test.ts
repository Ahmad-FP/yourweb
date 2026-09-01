import { describe, expect, it } from "vitest";
import type { Expression } from "./types";
import { evaluateExpression } from "./expressions";

describe("bounded expression evaluator", () => {
  it("computes today's calories from a custom meal log", () => {
    const expression: Expression = {
      op: "sum",
      source: {
        op: "filter",
        source: { op: "resource", id: "calorie-entries" },
        where: { op: "eq", left: { op: "field", name: "date" }, right: { op: "today" } },
      },
      value: {
        op: "multiply",
        left: { op: "mealField", mealRefField: "meal", field: "calories" },
        right: { op: "field", name: "servings" },
      },
    };
    const result = evaluateExpression(expression, {
      now: new Date("2026-09-01T09:00:00+07:00"),
      resources: {
        "calorie-entries": [
          { date: "2026-09-01", meal: "miso-salmon-rice", servings: 1 },
          { date: "2026-08-31", meal: "green-coconut-dal", servings: 1 },
        ],
      },
    });
    expect(result).toEqual({ ok: true, value: 612 });
  });

  it("rejects division by zero", () => {
    const result = evaluateExpression(
      { op: "divide", left: { op: "literal", value: 4 }, right: { op: "literal", value: 0 } },
      { resources: {} },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Division by zero");
  });
});
