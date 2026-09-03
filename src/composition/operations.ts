import { baseElementIds } from "./base";
import { cloneLayer, collectComponents, resolveConfiguration } from "./layer";
import { LIMITS } from "./limits";
import type { ElementInfo, LayerPatch, UIChangeOperation, UserLayer, ValidationIssue } from "./types";
import { validateOperations, validateUserLayer } from "./validate";

export interface ConfigurationDiff {
  summary: string;
  addedSurfaces: string[];
  updatedSurfaces: string[];
  removedSurfaces: string[];
  hiddenElements: string[];
  shownElements: string[];
  movedSurfaces: string[];
  insertedNodes: string[];
  removedNodes: string[];
  addedCollections: string[];
  updatedCollections: string[];
  archivedCollections: string[];
  addedInteractions: string[];
  removedInteractions: string[];
  warnings: string[];
}

export interface ConfigurationPreview {
  id: string;
  baseRevision: number;
  expiresAt: number;
  layer: UserLayer;
  diff: ConfigurationDiff;
  approvedAt?: number;
}

export type PreviewResult =
  | { ok: true; preview: ConfigurationPreview }
  | { ok: false; code: string; message: string; issues?: ValidationIssue[] };

export type OperationResult =
  | { ok: true; layer: UserLayer }
  | { ok: false; code: string; message: string; issues?: ValidationIssue[] };

const previews = new Map<string, ConfigurationPreview>();
const previewListeners = new Set<() => void>();
let latestPreviewId: string | null = null;

const emitPreviewChange = () => {
  for (const listener of previewListeners) listener();
};

export const subscribeToPreviews = (listener: () => void) => {
  previewListeners.add(listener);
  return () => previewListeners.delete(listener);
};

export const getLatestConfigurationPreview = () => {
  removeExpiredPreviews();
  return latestPreviewId ? previews.get(latestPreviewId) ?? null : null;
};

const insertedNodeIds = (layer: UserLayer) =>
  layer.patches.flatMap((patch) => (patch.op === "insert" ? [patch.node.id] : []));

const hiddenIds = (layer: UserLayer) =>
  layer.patches.flatMap((patch) => (patch.op === "hide" ? [patch.targetId] : []));

const movedIds = (layer: UserLayer) =>
  layer.patches.flatMap((patch) => (patch.op === "move_surface" ? [`${patch.surfaceId}:${patch.order}`] : []));

const changedList = (before: string[], after: string[]) => after.filter((id) => !before.includes(id));

const buildDiff = (before: UserLayer, after: UserLayer): ConfigurationDiff => {
  const beforeSurfaces = new Map(before.surfaces.map((surface) => [surface.id, surface]));
  const afterSurfaces = new Map(after.surfaces.map((surface) => [surface.id, surface]));
  const beforeCollections = new Map(before.collections.map((collection) => [collection.id, collection]));
  const afterCollections = new Map(after.collections.map((collection) => [collection.id, collection]));

  const addedSurfaces = [...afterSurfaces.keys()].filter((id) => !beforeSurfaces.has(id));
  const removedSurfaces = [...beforeSurfaces.keys()].filter((id) => !afterSurfaces.has(id));
  const updatedSurfaces = [...afterSurfaces.keys()].filter((id) => beforeSurfaces.has(id) && JSON.stringify(beforeSurfaces.get(id)) !== JSON.stringify(afterSurfaces.get(id)));
  const addedCollections = [...afterCollections.keys()].filter((id) => !beforeCollections.has(id));
  const updatedCollections = [...afterCollections.keys()].filter((id) => beforeCollections.has(id) && JSON.stringify(beforeCollections.get(id)) !== JSON.stringify(afterCollections.get(id)));
  const archivedCollections = [...afterCollections.values()].filter((collection) => collection.archived && !beforeCollections.get(collection.id)?.archived).map((collection) => collection.id);

  const hiddenElements = changedList(hiddenIds(before), hiddenIds(after));
  const shownElements = changedList(hiddenIds(after), hiddenIds(before));
  const insertedNodes = changedList(insertedNodeIds(before), insertedNodeIds(after));
  const removedNodes = changedList(insertedNodeIds(after), insertedNodeIds(before));
  const movedSurfaces = changedList(movedIds(before), movedIds(after)).map((entry) => entry.split(":")[0]!);

  const beforeInteractions = before.interactions.map((interaction) => interaction.id);
  const afterInteractions = after.interactions.map((interaction) => interaction.id);
  const addedInteractions = changedList(beforeInteractions, afterInteractions);
  const removedInteractions = changedList(afterInteractions, beforeInteractions);

  const parts: string[] = [];
  const add = (count: number, singular: string, plural = `${singular}s`) => {
    if (count) parts.push(`${count} ${count === 1 ? singular : plural}`);
  };
  add(addedSurfaces.length, "new screen");
  add(updatedSurfaces.length, "updated screen");
  add(removedSurfaces.length, "removed screen");
  add(insertedNodes.length, "added block");
  add(removedNodes.length, "removed block");
  add(hiddenElements.length, "hidden element");
  add(shownElements.length, "restored element");
  add(movedSurfaces.length, "reordered screen");
  add(addedCollections.length, "new record type");
  add(updatedCollections.length, "updated record type");
  add(archivedCollections.length, "archived record type");
  add(addedInteractions.length, "new drag-and-drop interaction", "new drag-and-drop interactions");
  add(removedInteractions.length, "removed interaction");

  const warnings: string[] = [];
  if (archivedCollections.length) warnings.push("Archiving a record type keeps every record. Re-adding the same id restores access to them.");
  if (addedInteractions.length) warnings.push("A new interaction changes how dragging behaves across the whole site.");

  return {
    summary: parts.length ? parts.join(", ") : "No structural change",
    addedSurfaces,
    updatedSurfaces,
    removedSurfaces,
    hiddenElements,
    shownElements,
    movedSurfaces,
    insertedNodes,
    removedNodes,
    addedCollections,
    updatedCollections,
    archivedCollections,
    addedInteractions,
    removedInteractions,
    warnings,
  };
};

const protectedFailure = (info: ElementInfo | undefined, id: string, verb: string): OperationResult => {
  if (!info) return { ok: false, code: "unknown_element", message: `No element with id '${id}' exists. Call get_ui_outline for the current ids.` };
  const hint = info.policy.hideable && verb !== "hidden" ? " The developer does allow it to be hidden with hide_element." : "";
  return {
    ok: false,
    code: "protected_element",
    message: `'${id}' is a developer-owned element and cannot be ${verb}.${hint}`,
  };
};

/**
 * Apply an agent's batch to the user layer. Nothing here writes to the developer base: an
 * operation either lands in the user layer or is refused by the element policy.
 */
export const applyOperations = (base: UserLayer, operations: UIChangeOperation[]): OperationResult => {
  let next = cloneLayer(base);
  let index = resolveConfiguration(next).index;
  const reindex = () => {
    index = resolveConfiguration(next).index;
  };

  for (const operation of operations) {
    switch (operation.op) {
      case "upsert_surface": {
        if (baseElementIds.has(operation.surface.id)) return protectedFailure(index.get(operation.surface.id), operation.surface.id, "replaced");
        const at = next.surfaces.findIndex((surface) => surface.id === operation.surface.id);
        if (at === -1) {
          if (next.surfaces.length >= LIMITS.userSurfaces) return { ok: false, code: "limit_reached", message: `A configuration may add at most ${LIMITS.userSurfaces} screens of its own.` };
          next.surfaces.push(operation.surface);
        } else {
          next.surfaces[at] = operation.surface;
        }
        break;
      }
      case "remove_surface": {
        const info = index.get(operation.surfaceId);
        if (!info || info.owner === "developer") return protectedFailure(info, operation.surfaceId, "removed");
        next.surfaces = next.surfaces.filter((surface) => surface.id !== operation.surfaceId);
        next.patches = next.patches.filter((patch) => {
          const target = patch.op === "hide" ? patch.targetId : patch.op === "move_surface" ? patch.surfaceId : patch.slotId;
          return index.get(target)?.surfaceId !== operation.surfaceId;
        });
        next.interactions = next.interactions.filter(
          (interaction) =>
            index.get(interaction.source.componentId)?.surfaceId !== operation.surfaceId &&
            index.get(interaction.target.componentId)?.surfaceId !== operation.surfaceId,
        );
        break;
      }
      case "hide_element": {
        const info = index.get(operation.targetId);
        if (!info || !info.policy.hideable) return protectedFailure(info, operation.targetId, "hidden");
        if (!next.patches.some((patch) => patch.op === "hide" && patch.targetId === operation.targetId)) {
          next.patches.push({ op: "hide", targetId: operation.targetId });
        }
        break;
      }
      case "show_element": {
        next.patches = next.patches.filter((patch) => !(patch.op === "hide" && patch.targetId === operation.targetId));
        break;
      }
      case "move_surface": {
        const info = index.get(operation.surfaceId);
        if (!info || info.kind !== "surface" || !info.policy.movable) return protectedFailure(info, operation.surfaceId, "reordered");
        next.patches = next.patches.filter((patch) => !(patch.op === "move_surface" && patch.surfaceId === operation.surfaceId));
        next.patches.push({ op: "move_surface", surfaceId: operation.surfaceId, order: operation.order });
        break;
      }
      case "insert_into_slot": {
        const info = index.get(operation.slotId);
        if (!info || !info.policy.extendable) return protectedFailure(info, operation.slotId, "extended");
        if (index.has(operation.node.id)) return { ok: false, code: "duplicate_id", message: `Element id '${operation.node.id}' is already in use.` };
        const patch: LayerPatch = { op: "insert", slotId: operation.slotId, node: operation.node, ...(operation.position === undefined ? {} : { position: operation.position }) };
        next.patches.push(patch);
        break;
      }
      case "remove_inserted": {
        const before = next.patches.length;
        next.patches = next.patches.filter((patch) => !(patch.op === "insert" && patch.node.id === operation.nodeId));
        if (next.patches.length === before) return { ok: false, code: "unknown_element", message: `No inserted block with id '${operation.nodeId}' exists. Developer-owned blocks can only be hidden.` };
        break;
      }
      case "upsert_collection": {
        if (baseElementIds.has(operation.collection.id)) return { ok: false, code: "protected_element", message: `'${operation.collection.id}' is a developer-owned record type.` };
        const at = next.collections.findIndex((collection) => collection.id === operation.collection.id);
        const collection = { ...operation.collection, archived: false };
        if (at === -1) {
          if (next.collections.length >= LIMITS.collections) return { ok: false, code: "limit_reached", message: `A configuration may hold at most ${LIMITS.collections} record types.` };
          next.collections.push(collection);
        } else {
          next.collections[at] = collection;
        }
        break;
      }
      case "remove_collection": {
        const collection = next.collections.find((candidate) => candidate.id === operation.collectionId);
        if (!collection) return { ok: false, code: "unknown_element", message: `No record type '${operation.collectionId}' exists.` };
        const users = collectComponents(resolveConfiguration(next).configuration)
          .filter((node) => (node.kind === "form" && node.collectionId === operation.collectionId) || (node.kind === "collection" && node.query.source === operation.collectionId))
          .map((node) => node.id);
        if (users.length) {
          return {
            ok: false,
            code: "record_type_in_use",
            message: `'${operation.collectionId}' is still shown by ${users.join(", ")}. Remove or repoint those blocks in the same batch, then archive the record type.`,
          };
        }
        collection.archived = true;
        next.interactions = next.interactions.filter((interaction) => interaction.source.type !== `record:${operation.collectionId}`);
        break;
      }
      case "bind_interaction": {
        const at = next.interactions.findIndex((interaction) => interaction.id === operation.interaction.id);
        if (at === -1) {
          if (next.interactions.length >= LIMITS.interactions) return { ok: false, code: "limit_reached", message: `A configuration may hold at most ${LIMITS.interactions} interactions.` };
          next.interactions.push(operation.interaction);
        } else {
          next.interactions[at] = operation.interaction;
        }
        break;
      }
      case "unbind_interaction": {
        const before = next.interactions.length;
        next.interactions = next.interactions.filter((interaction) => interaction.id !== operation.interactionId);
        if (next.interactions.length === before) return { ok: false, code: "unknown_element", message: `No interaction '${operation.interactionId}' exists.` };
        break;
      }
    }
    reindex();
  }

  if (next.patches.length > LIMITS.patches) return { ok: false, code: "limit_reached", message: `A configuration may hold at most ${LIMITS.patches} adjustments to the base.` };
  next.revision = base.revision + 1;
  return { ok: true, layer: next };
};

const removeExpiredPreviews = () => {
  const now = Date.now();
  for (const [id, preview] of previews) if (preview.expiresAt <= now) previews.delete(id);
};

export const createConfigurationPreview = (
  base: UserLayer,
  rawOperations: unknown,
  expectedRevision?: number,
): PreviewResult => {
  removeExpiredPreviews();
  if (expectedRevision !== undefined && expectedRevision !== base.revision) {
    return { ok: false, code: "stale_configuration", message: `Expected configuration revision ${expectedRevision}, but the active revision is ${base.revision}. Read the current outline and retry.` };
  }
  const operationResult = validateOperations(rawOperations);
  if (!operationResult.ok) return { ok: false, code: "invalid_operations", message: "The proposed operations do not match the bounded composition grammar.", issues: operationResult.issues };

  const applied = applyOperations(base, operationResult.value);
  if (!applied.ok) return applied;

  const validation = validateUserLayer(applied.layer);
  if (!validation.ok) return { ok: false, code: "invalid_configuration", message: "The proposed change would create an invalid configuration.", issues: validation.issues };

  const id = crypto.randomUUID();
  const preview: ConfigurationPreview = {
    id,
    baseRevision: base.revision,
    expiresAt: Date.now() + LIMITS.previewLifetimeMs,
    layer: validation.value,
    diff: buildDiff(base, validation.value),
  };
  previews.set(id, preview);
  latestPreviewId = id;
  emitPreviewChange();
  return { ok: true, preview };
};

export const readConfigurationPreview = (id: string) => {
  removeExpiredPreviews();
  return previews.get(id) ?? null;
};

export const approveConfigurationPreview = (id: string) => {
  removeExpiredPreviews();
  const preview = previews.get(id);
  if (!preview) return false;
  previews.set(id, { ...preview, approvedAt: Date.now() });
  latestPreviewId = id;
  emitPreviewChange();
  return true;
};

export const consumeConfigurationPreview = (id: string, activeRevision: number): PreviewResult => {
  removeExpiredPreviews();
  const preview = previews.get(id);
  if (!preview) return { ok: false, code: "preview_not_found", message: "The preview is missing or expired. Preview the changes again." };
  if (!preview.approvedAt) return { ok: false, code: "preview_not_approved", message: "The structural preview is waiting for the user to approve it in the YourWeb interface." };
  if (preview.baseRevision !== activeRevision) {
    previews.delete(id);
    return { ok: false, code: "stale_preview", message: "The active configuration changed after this preview. Read the current outline and create a new preview." };
  }
  previews.delete(id);
  if (latestPreviewId === id) latestPreviewId = null;
  emitPreviewChange();
  return { ok: true, preview };
};

export const clearConfigurationPreviews = () => {
  previews.clear();
  latestPreviewId = null;
  emitPreviewChange();
};

export { buildDiff };
