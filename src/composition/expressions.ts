import { mealById } from "../catalog/meals";
import { LIMITS } from "./limits";
import type { Expression, Scalar } from "./types";

export interface EvaluationContext {
  resources: Record<string, readonly Record<string, unknown>[]>;
  record?: Record<string, unknown>;
  now?: Date;
}

export type EvaluationResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

class EvaluationFault extends Error {}

interface EvaluationState {
  work: number;
  now: Date;
}

const dateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const startOfWeekString = (date = new Date()) => {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  return dateString(copy);
};

const asNumber = (value: unknown, label: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new EvaluationFault(`${label} must resolve to a finite number.`);
  }
  return value;
};

const evaluate = (
  expression: Expression,
  context: EvaluationContext,
  state: EvaluationState,
  depth: number,
  record = context.record,
): unknown => {
  state.work += 1;
  if (state.work > LIMITS.expressionWork) throw new EvaluationFault("Expression work limit exceeded.");
  if (depth > LIMITS.expressionDepth) throw new EvaluationFault("Expression depth limit exceeded.");

  switch (expression.op) {
    case "literal":
      return expression.value;
    case "resource": {
      const resource = context.resources[expression.id];
      if (!resource) throw new EvaluationFault(`Unknown resource '${expression.id}'.`);
      return resource;
    }
    case "field":
      return record?.[expression.name] ?? null;
    case "mealField": {
      const mealId = record?.[expression.mealRefField];
      if (typeof mealId !== "string") return null;
      return mealById.get(mealId)?.[expression.field] ?? null;
    }
    case "today":
      return dateString(state.now);
    case "currentWeek":
      return startOfWeekString(state.now);
    case "add":
      return asNumber(evaluate(expression.left, context, state, depth + 1, record), "Left operand") + asNumber(evaluate(expression.right, context, state, depth + 1, record), "Right operand");
    case "subtract":
      return asNumber(evaluate(expression.left, context, state, depth + 1, record), "Left operand") - asNumber(evaluate(expression.right, context, state, depth + 1, record), "Right operand");
    case "multiply":
      return asNumber(evaluate(expression.left, context, state, depth + 1, record), "Left operand") * asNumber(evaluate(expression.right, context, state, depth + 1, record), "Right operand");
    case "divide": {
      const divisor = asNumber(evaluate(expression.right, context, state, depth + 1, record), "Divisor");
      if (divisor === 0) throw new EvaluationFault("Division by zero is not allowed.");
      return asNumber(evaluate(expression.left, context, state, depth + 1, record), "Dividend") / divisor;
    }
    case "eq":
      return evaluate(expression.left, context, state, depth + 1, record) === evaluate(expression.right, context, state, depth + 1, record);
    case "gt":
      return asNumber(evaluate(expression.left, context, state, depth + 1, record), "Left operand") > asNumber(evaluate(expression.right, context, state, depth + 1, record), "Right operand");
    case "gte":
      return asNumber(evaluate(expression.left, context, state, depth + 1, record), "Left operand") >= asNumber(evaluate(expression.right, context, state, depth + 1, record), "Right operand");
    case "lt":
      return asNumber(evaluate(expression.left, context, state, depth + 1, record), "Left operand") < asNumber(evaluate(expression.right, context, state, depth + 1, record), "Right operand");
    case "lte":
      return asNumber(evaluate(expression.left, context, state, depth + 1, record), "Left operand") <= asNumber(evaluate(expression.right, context, state, depth + 1, record), "Right operand");
    case "filter": {
      const source = evaluate(expression.source, context, state, depth + 1, record);
      if (!Array.isArray(source)) throw new EvaluationFault("Filter source must resolve to a collection.");
      return source.filter((item) => {
        state.work += 1;
        if (state.work > LIMITS.expressionWork) throw new EvaluationFault("Expression work limit exceeded.");
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        return Boolean(evaluate(expression.where, context, state, depth + 1, item as Record<string, unknown>));
      });
    }
    case "sum": {
      const source = evaluate(expression.source, context, state, depth + 1, record);
      if (!Array.isArray(source)) throw new EvaluationFault("Sum source must resolve to a collection.");
      return source.reduce((total, item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return total;
        const value = evaluate(expression.value, context, state, depth + 1, item as Record<string, unknown>);
        return total + asNumber(value, "Sum value");
      }, 0);
    }
    case "count": {
      const source = evaluate(expression.source, context, state, depth + 1, record);
      if (!Array.isArray(source)) throw new EvaluationFault("Count source must resolve to a collection.");
      return source.length;
    }
  }
};

export const evaluateExpression = (expression: Expression, context: EvaluationContext): EvaluationResult => {
  try {
    return {
      ok: true,
      value: evaluate(expression, context, { work: 0, now: context.now ?? new Date() }, 0),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Expression evaluation failed.",
    };
  }
};

export const coerceScalar = (value: unknown): Scalar => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new EvaluationFault("Value is not a supported scalar.");
};
