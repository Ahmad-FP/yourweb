import type { ActionId, ComponentNode, CustomCollectionSchema, ElementOwner, ElementPolicy } from "./types";

/**
 * Drag-and-drop is part of the developer-owned grammar, not something an assistant can invent.
 * A component only becomes a drag source or a drop target if the registry below says its kind
 * can be one, and an interaction may only carry the payload keys and bind the actions listed here.
 */

export interface DragCapability {
  /** Tag a matching drop target must accept. */
  type: string;
  /** Record fields an interaction payload may read off the dragged item. */
  fields: string[];
  /** Human-readable note for the capability catalog. */
  note: string;
}

export interface DropCapability {
  /** Values the trusted renderer supplies for each cell, readable through the cell expression. */
  cellFields: string[];
  /** Actions a drop may be bound to. */
  actions: ActionId[];
  note: string;
}

const MEAL_DRAG_FIELDS = ["id", "name", "summary", "cuisine", "mealType", "prepMinutes", "servings", "calories", "protein", "carbs", "fat", "fiber"];

/** Base elements are locked down unless their own policy opens a door. User elements are theirs. */
export const USER_ELEMENT_POLICY: Required<ElementPolicy> = { hideable: true, movable: true, extendable: true, removable: true };

export const effectivePolicy = (owner: ElementOwner, declared: ElementPolicy | undefined): Required<ElementPolicy> =>
  owner === "user"
    ? USER_ELEMENT_POLICY
    : {
        hideable: declared?.hideable ?? false,
        movable: declared?.movable ?? false,
        extendable: declared?.extendable ?? false,
        removable: declared?.removable ?? false,
      };

const activeCollection = (collections: readonly CustomCollectionSchema[], id: string) =>
  collections.find((collection) => collection.id === id && !collection.archived);

export const dragCapabilityFor = (
  node: ComponentNode,
  collections: readonly CustomCollectionSchema[],
): DragCapability | null => {
  if (node.kind !== "collection") return null;
  if (node.query.source === "meals") {
    return { type: "meal", fields: MEAL_DRAG_FIELDS, note: "Each meal card can be picked up." };
  }
  const collection = activeCollection(collections, node.query.source);
  if (collection) {
    return {
      type: `record:${collection.id}`,
      fields: ["id", ...collection.fields.map((field) => field.id)],
      note: `Each ${collection.name} row can be picked up.`,
    };
  }
  return null;
};

export const dropCapabilityFor = (
  node: ComponentNode,
  collections: readonly CustomCollectionSchema[],
): DropCapability | null => {
  if (node.kind === "calendar") {
    return {
      cellFields: ["date", "slot"],
      actions: ["add_meal_to_plan", "remove_meal_from_plan"],
      note: "Every day-and-slot cell in the week grid is a drop target.",
    };
  }
  if (node.kind === "collection") {
    const collection = activeCollection(collections, node.query.source);
    if (collection) {
      return {
        cellFields: ["collectionId"],
        actions: ["log_record"],
        note: `Dropping onto ${collection.name} writes one record.`,
      };
    }
  }
  return null;
};

export const describeCapabilities = (node: ComponentNode, collections: readonly CustomCollectionSchema[]) => {
  const drag = dragCapabilityFor(node, collections);
  const drop = dropCapabilityFor(node, collections);
  return {
    ...(drag ? { dragProvides: { type: drag.type, fields: drag.fields } } : {}),
    ...(drop ? { dropAccepts: { cellFields: drop.cellFields, actions: drop.actions } } : {}),
  };
};
