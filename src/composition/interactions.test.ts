import { describe, expect, it } from "vitest";
import { mealById } from "../catalog/meals";
import { demoOperations } from "../test/demoConfiguration";
import { createUserLayer, resolveConfiguration } from "./layer";
import {
  DRAG_MIME,
  buildDragPayload,
  dragInteractionsFor,
  matchingDropInteraction,
  performDrop,
  readDragPayload,
  type DragPayload,
} from "./interactions";
import { applyOperations } from "./operations";
import type { ActionHost } from "./actions";

const personalised = () => {
  const applied = applyOperations(createUserLayer(), demoOperations);
  if (!applied.ok) throw new Error(applied.message);
  return resolveConfiguration(applied.layer).configuration;
};

const recordingHost = () => {
  const plan: unknown[] = [];
  const records: unknown[] = [];
  const host: ActionHost = {
    applyPlanChanges: (changes) => {
      plan.push(...changes);
      return Promise.resolve({ ok: true });
    },
    toggleFavorite: () => Promise.resolve(true),
    addCustomRecord: (collectionId, values) => {
      records.push({ collectionId, values });
      return Promise.resolve({ ok: true });
    },
  };
  return { host, plan, records };
};

const salmon = mealById.get("miso-salmon-rice")!;
const resources = { meals: [salmon as unknown as Record<string, unknown>] };

describe("composed drag-and-drop interactions", () => {
  it("lifts only the declared payload off the dragged item", () => {
    const configuration = personalised();
    const interaction = dragInteractionsFor(configuration, "week-picker")[0]!;
    const payload = buildDragPayload(interaction, salmon as unknown as Record<string, unknown>, resources, salmon.name);
    expect(payload).toEqual({
      interactionId: "plan-by-dragging",
      type: "meal",
      label: salmon.name,
      values: { mealId: salmon.id, mealName: salmon.name },
    });
    expect(Object.values(payload.values).every((value) => value === null || typeof value !== "object")).toBe(true);
  });

  it("plans a meal when a card is dropped on a calendar cell", async () => {
    const configuration = personalised();
    const interaction = dragInteractionsFor(configuration, "week-picker")[0]!;
    const payload = buildDragPayload(interaction, salmon as unknown as Record<string, unknown>, resources, salmon.name);
    const bound = matchingDropInteraction(configuration, "week-calendar", payload);
    expect(bound?.id).toBe("plan-by-dragging");

    const { host, plan } = recordingHost();
    const result = await performDrop(bound!, payload, { date: "2026-09-07", slot: "dinner" }, resources, host);
    expect(result.ok).toBe(true);
    expect(plan).toEqual([{ date: "2026-09-07", slot: "dinner", mealId: salmon.id, servings: 1 }]);
  });

  it("logs a record when the same card is dropped on the intake list", async () => {
    const configuration = personalised();
    const interaction = configuration.interactions.find((candidate) => candidate.id === "log-by-dragging")!;
    const payload = buildDragPayload(interaction, salmon as unknown as Record<string, unknown>, resources, salmon.name);
    const bound = matchingDropInteraction(configuration, "today-entries", payload);
    expect(bound?.id).toBe("log-by-dragging");

    const { host, records } = recordingHost();
    const result = await performDrop(bound!, payload, { collectionId: "intake-log" }, resources, host);
    expect(result.ok).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ collectionId: "intake-log", values: { meal: salmon.id, servings: 1 } });
  });

  it("ignores a drop on a component the interaction was not bound to", () => {
    const configuration = personalised();
    const payload: DragPayload = { interactionId: "plan-by-dragging", type: "meal", values: { mealId: salmon.id }, label: salmon.name };
    expect(matchingDropInteraction(configuration, "today-entries", payload)).toBeNull();
    expect(matchingDropInteraction(configuration, "week-groceries", payload)).toBeNull();
  });

  it("ignores a drag payload whose type the target does not accept", () => {
    const configuration = personalised();
    const payload: DragPayload = { interactionId: "plan-by-dragging", type: "record:intake-log", values: {}, label: "x" };
    expect(matchingDropInteraction(configuration, "week-calendar", payload)).toBeNull();
  });

  it("refuses to read anything but a well-formed payload off the transfer", () => {
    const transfer = (value: string) => ({ getData: (type: string) => (type === DRAG_MIME ? value : "") }) as unknown as DataTransfer;
    expect(readDragPayload(transfer("not json"))).toBeNull();
    expect(readDragPayload(transfer(JSON.stringify({ interactionId: 1 })))).toBeNull();
    expect(readDragPayload(null)).toBeNull();
    expect(readDragPayload(transfer(JSON.stringify({ interactionId: "a", type: "meal", values: {}, label: "b" })))).toEqual({
      interactionId: "a",
      type: "meal",
      values: {},
      label: "b",
    });
  });

  it("fails a drop whose resolved meal id is not in the catalog", async () => {
    const configuration = personalised();
    const bound = configuration.interactions.find((candidate) => candidate.id === "plan-by-dragging")!;
    const payload: DragPayload = { interactionId: bound.id, type: "meal", values: { mealId: "not-a-meal" }, label: "spoofed" };
    const { host, plan } = recordingHost();
    const result = await performDrop(bound, payload, { date: "2026-09-07", slot: "dinner" }, resources, host);
    expect(result.ok).toBe(false);
    expect(plan).toEqual([]);
  });

  it("fails a drop whose cell is not a real date and slot", async () => {
    const configuration = personalised();
    const bound = configuration.interactions.find((candidate) => candidate.id === "plan-by-dragging")!;
    const payload: DragPayload = { interactionId: bound.id, type: "meal", values: { mealId: salmon.id }, label: salmon.name };
    const { host, plan } = recordingHost();
    const result = await performDrop(bound, payload, { date: "whenever", slot: "brunch" }, resources, host);
    expect(result.ok).toBe(false);
    expect(plan).toEqual([]);
  });
});
