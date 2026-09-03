import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approveConfigurationPreview, clearConfigurationPreviews, createConfigurationPreview } from "../composition/operations";
import { resetDatabaseForTests } from "../data/db";
import { appStore } from "../data/store";
import { demoOperations } from "../test/demoConfiguration";
import { SurfaceRenderer } from "./Renderer";

let container: HTMLDivElement;
let root: Root;

const fakeTransfer = () => {
  const store = new Map<string, string>();
  return {
    effectAllowed: "none",
    dropEffect: "none",
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
    types: [...store.keys()],
  };
};

/** jsdom has no DataTransfer, so hand React a native event carrying a stand-in. */
const fireDrag = async (target: Element, type: string, dataTransfer: unknown) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  await act(async () => {
    target.dispatchEvent(event);
  });
};

/** Store writes are queued, so wait for the effect rather than for a fixed delay. */
const waitFor = async (condition: () => boolean, label: string) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Timed out waiting for ${label}.`);
};

const renderActiveSurface = async () => {
  const state = appStore.getSnapshot();
  const surface = state.configuration.surfaces.find((candidate) => candidate.id === "week")!;
  await act(async () => {
    root.render(<SurfaceRenderer surface={surface} state={state} onSelectMeal={() => {}} onNavigate={() => {}} />);
  });
};

describe("rendering a personalised surface", () => {
  beforeEach(async () => {
    clearConfigurationPreviews();
    await resetDatabaseForTests();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await appStore.initialize();

    const layer = appStore.getSnapshot().layer;
    const preview = createConfigurationPreview(layer, demoOperations, layer.revision);
    if (!preview.ok) throw new Error(preview.message);
    approveConfigurationPreview(preview.preview.id);
    await appStore.applyPreview(preview.preview.id, "agent");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders the inserted meal list and the developer's calendar together", async () => {
    await renderActiveSurface();
    expect(container.querySelector('[data-component-id="week-picker"]')).not.toBeNull();
    expect(container.querySelector('[data-component-id="week-calendar"]')).not.toBeNull();
    expect(container.querySelectorAll(".meal-card").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".plan-slot").length).toBe(21);
  });

  it("leaves a hidden developer element out of the DOM entirely", async () => {
    await renderActiveSurface();
    expect(container.querySelector('[data-component-id="week-metrics"]')).toBeNull();
    expect(container.textContent).not.toContain("Meals planned");
    expect(appStore.getSnapshot().elements.get("week-metrics")?.hidden).toBe(true);
  });

  it("marks cards draggable only because an interaction is bound", async () => {
    await renderActiveSurface();
    const card = container.querySelector('[data-component-id="week-picker"] .meal-card')!;
    expect(card.getAttribute("draggable")).toBe("true");
    expect(container.textContent).toContain("Drag a meal onto a day in your week");
  });

  it("plans the dragged meal when it is dropped on a calendar cell", async () => {
    await renderActiveSurface();
    const card = container.querySelector('[data-component-id="week-picker"] .meal-card')!;
    const transfer = fakeTransfer();

    await fireDrag(card, "dragstart", transfer);
    expect(transfer.getData("application/x-yourweb-drag")).toContain("mealId");

    await renderActiveSurface();
    const slot = container.querySelectorAll('[data-component-id="week-calendar"] .plan-slot')[2]!;
    await fireDrag(slot, "dragover", transfer);
    await fireDrag(slot, "drop", transfer);
    await waitFor(() => appStore.getSnapshot().planEntries.length > 0, "the dropped meal to reach the plan");

    const entries = appStore.getSnapshot().planEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ slot: "dinner", author: "human" });
    expect(entries[0]!.mealId).toEqual(expect.any(String));
  });

  it("ignores a drop carrying a payload from no bound interaction", async () => {
    await renderActiveSurface();
    const slot = container.querySelector('[data-component-id="week-calendar"] .plan-slot')!;
    await fireDrag(slot, "drop", fakeTransfer());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(appStore.getSnapshot().planEntries).toEqual([]);
  });
});
