import { describe, expect, it } from "vitest";
import { compositionFixture } from "../test/fixtures";
import { getBase } from "./base";
import { createUserLayer, resolveConfiguration } from "./layer";
import { applyOperations } from "./operations";
import type { BaseDefinition, UIChangeOperation, UserLayer } from "./types";
import { validateUserLayer } from "./validate";

const personalise = (operations: UIChangeOperation[] = compositionFixture, from = createUserLayer()) => {
  const result = applyOperations(from, operations);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.layer;
};

describe("developer base and user layer", () => {
  it("resolves the shipped base on its own", () => {
    const { configuration, index } = resolveConfiguration(createUserLayer());
    expect(configuration.surfaces.map((surface) => surface.id)).toEqual(["discover", "week"]);
    expect(configuration.surfaces.every((surface) => surface.owner === "developer")).toBe(true);
    expect(index.get("week-calendar")?.owner).toBe("developer");
    expect(validateUserLayer(createUserLayer()).ok).toBe(true);
  });

  it("grants only the policy the developer declared", () => {
    const { index } = resolveConfiguration(createUserLayer());
    expect(index.get("discover")?.policy).toMatchObject({ movable: true, hideable: true, removable: false, extendable: false });
    expect(index.get("week-root")?.policy.extendable).toBe(true);
    expect(index.get("discover-meals")?.policy).toEqual({ hideable: false, movable: false, extendable: false, removable: false });
    expect(index.get("week-metrics")?.policy.hideable).toBe(true);
  });

  it("refuses to remove, replace or hide a protected base element", () => {
    const layer = createUserLayer();
    expect(applyOperations(layer, [{ op: "remove_surface", surfaceId: "discover" }])).toMatchObject({ ok: false, code: "protected_element" });
    expect(applyOperations(layer, [{ op: "hide_element", targetId: "discover-meals" }])).toMatchObject({ ok: false, code: "protected_element" });
    expect(applyOperations(layer, [{ op: "insert_into_slot", slotId: "week-metrics", node: { id: "sneak", kind: "text", text: "no" } }])).toMatchObject({ ok: false, code: "protected_element" });

    const replace = applyOperations(layer, [
      { op: "upsert_surface", surface: { id: "discover", title: "Mine", order: 0, root: { id: "mine-root", kind: "text", text: "hi" } } },
    ]);
    expect(replace).toMatchObject({ ok: false, code: "protected_element" });
  });

  it("allows exactly what the policy opens: hide, move and extend", () => {
    const layer = personalise([
      { op: "hide_element", targetId: "week-metrics" },
      { op: "move_surface", surfaceId: "week", order: 0 },
      { op: "insert_into_slot", slotId: "week-root", node: { id: "week-note", kind: "text", text: "Shop on Sunday.", variant: "caption" } },
    ]);
    const { configuration, index } = resolveConfiguration(layer);
    expect(index.get("week-metrics")?.hidden).toBe(true);
    expect(index.get("week-note")).toMatchObject({ owner: "user", insertedIntoSlot: "week-root" });
    expect(configuration.surfaces.find((surface) => surface.id === "week")?.order).toBe(0);
    const week = configuration.surfaces.find((surface) => surface.id === "week")!;
    expect(week.root.kind === "section" && week.root.children.at(-1)?.id).toBe("week-note");
    expect(validateUserLayer(layer).ok).toBe(true);
  });

  it("hides a container's descendants without deleting them", () => {
    const { index } = resolveConfiguration(personalise([{ op: "hide_element", targetId: "week-metrics" }]));
    expect(index.get("week-planned-count")?.hidden).toBe(true);
    expect(index.get("week-planned-count")?.owner).toBe("developer");
  });

  it("keeps every personalisation when the developer ships a new base revision", () => {
    const layer = personalise();
    const before = resolveConfiguration(layer).configuration;
    expect(before.surfaces.some((surface) => surface.id === "today")).toBe(true);

    // Stand in for a future release: the base gains a screen and rewords an existing one.
    const shipped = getBase("simple");
    const updated: BaseDefinition = {
      ...structuredClone(shipped),
      revision: shipped.revision + 1,
      surfaces: [
        ...structuredClone(shipped.surfaces).map((surface) =>
          surface.id === "discover" ? { ...surface, title: "Browse recipes" } : surface,
        ),
        { id: "pantry", title: "Pantry", icon: "basket", order: 5, policy: { movable: true }, root: { id: "pantry-root", kind: "text", text: "New in this release." } },
      ],
    };

    const rebased = resolveConfiguration({ ...layer } as UserLayer, updated).configuration;
    expect(rebased.surfaces.find((surface) => surface.id === "discover")?.title).toBe("Browse recipes");
    expect(rebased.surfaces.some((surface) => surface.id === "pantry")).toBe(true);
    expect(rebased.surfaces.some((surface) => surface.id === "today")).toBe(true);
    expect(rebased.interactions.map((interaction) => interaction.id)).toEqual(["plan-by-dragging", "log-by-dragging"]);
    expect(rebased.surfaces.find((surface) => surface.id === "week")?.order).toBe(1);
  });

  it("keeps a patch inert rather than failing when its target leaves the base", () => {
    const layer = personalise([{ op: "hide_element", targetId: "week-metrics" }]);
    const shipped = getBase("simple");
    const withoutMetrics: BaseDefinition = {
      ...structuredClone(shipped),
      revision: shipped.revision + 1,
      surfaces: structuredClone(shipped.surfaces).map((surface) =>
        surface.id === "week" && surface.root.kind === "section"
          ? { ...surface, root: { ...surface.root, children: surface.root.children.filter((child) => child.id !== "week-metrics") } }
          : surface,
      ),
    };
    const result = resolveConfiguration(layer, withoutMetrics);
    expect(result.inertPatches).toEqual([{ op: "hide", targetId: "week-metrics" }]);
    expect(result.configuration.surfaces.some((surface) => surface.id === "week")).toBe(true);
    expect(layer.patches).toHaveLength(1);
  });

  it("carries the layer across a base switch", () => {
    const layer = personalise();
    const moved = resolveConfiguration({ ...layer, baseId: "dense" }).configuration;
    expect(moved.surfaces.some((surface) => surface.id === "overview")).toBe(true);
    expect(moved.surfaces.some((surface) => surface.id === "today")).toBe(true);
    expect(moved.collections.some((collection) => collection.id === "intake-log")).toBe(true);
  });
});
