import { LIMITS } from "./limits";
import type { UIChangeOperation, UIConfiguration, ValidationIssue } from "./types";
import { validateConfiguration, validateOperations } from "./validate";

export interface ConfigurationDiff {
  summary: string;
  addedSurfaces: string[];
  updatedSurfaces: string[];
  removedSurfaces: string[];
  addedCollections: string[];
  updatedCollections: string[];
  archivedCollections: string[];
  warnings: string[];
}

export interface ConfigurationPreview {
  id: string;
  baseVersion: number;
  expiresAt: number;
  configuration: UIConfiguration;
  diff: ConfigurationDiff;
  approvedAt?: number;
}

export type PreviewResult =
  | { ok: true; preview: ConfigurationPreview }
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

export const cloneConfiguration = (configuration: UIConfiguration): UIConfiguration => structuredClone(configuration);

const buildDiff = (before: UIConfiguration, after: UIConfiguration): ConfigurationDiff => {
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
  const changes = addedSurfaces.length + removedSurfaces.length + updatedSurfaces.length + addedCollections.length + updatedCollections.length + archivedCollections.length;

  return {
    summary: `${changes} structural ${changes === 1 ? "change" : "changes"}: ${addedSurfaces.length} surface(s) added, ${updatedSurfaces.length} updated, ${removedSurfaces.length} removed; ${addedCollections.length} collection(s) added, ${updatedCollections.length} updated, ${archivedCollections.length} archived.`,
    addedSurfaces,
    updatedSurfaces,
    removedSurfaces,
    addedCollections,
    updatedCollections,
    archivedCollections,
    warnings: archivedCollections.length ? ["Archiving a collection preserves its records. Re-adding the same collection ID restores access."] : [],
  };
};

export const applyOperations = (base: UIConfiguration, operations: UIChangeOperation[]) => {
  const next = cloneConfiguration(base);

  for (const operation of operations) {
    switch (operation.op) {
      case "upsert_collection": {
        const index = next.collections.findIndex((collection) => collection.id === operation.collection.id);
        const collection = { ...operation.collection, archived: false };
        if (index === -1) next.collections.push(collection);
        else next.collections[index] = collection;
        break;
      }
      case "remove_collection": {
        const collection = next.collections.find((candidate) => candidate.id === operation.collectionId);
        if (collection) collection.archived = true;
        break;
      }
      case "upsert_surface": {
        const index = next.surfaces.findIndex((surface) => surface.id === operation.surface.id);
        if (index === -1) next.surfaces.push(operation.surface);
        else next.surfaces[index] = operation.surface;
        break;
      }
      case "remove_surface":
        next.surfaces = next.surfaces.filter((surface) => surface.id !== operation.surfaceId);
        break;
    }
  }

  next.surfaces.sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));
  next.version = base.version + 1;
  return next;
};

const removeExpiredPreviews = () => {
  const now = Date.now();
  for (const [id, preview] of previews) if (preview.expiresAt <= now) previews.delete(id);
};

export const createConfigurationPreview = (
  base: UIConfiguration,
  rawOperations: unknown,
  expectedVersion?: number,
): PreviewResult => {
  removeExpiredPreviews();
  if (expectedVersion !== undefined && expectedVersion !== base.version) {
    return { ok: false, code: "stale_configuration", message: `Expected configuration version ${expectedVersion}, but the active version is ${base.version}. Read the current outline and retry.` };
  }
  const operationResult = validateOperations(rawOperations);
  if (!operationResult.ok) return { ok: false, code: "invalid_operations", message: "The proposed operations do not match the bounded composition grammar.", issues: operationResult.issues };

  const configuration = applyOperations(base, operationResult.value);
  const validation = validateConfiguration(configuration);
  if (!validation.ok) return { ok: false, code: "invalid_configuration", message: "The proposed change would create an invalid configuration.", issues: validation.issues };

  const id = crypto.randomUUID();
  const preview: ConfigurationPreview = {
    id,
    baseVersion: base.version,
    expiresAt: Date.now() + LIMITS.previewLifetimeMs,
    configuration: validation.value,
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

export const consumeConfigurationPreview = (id: string, activeVersion: number): PreviewResult => {
  removeExpiredPreviews();
  const preview = previews.get(id);
  if (!preview) return { ok: false, code: "preview_not_found", message: "The preview is missing or expired. Preview the changes again." };
  if (!preview.approvedAt) return { ok: false, code: "preview_not_approved", message: "The structural preview is waiting for the user to approve it in the YourWeb interface." };
  if (preview.baseVersion !== activeVersion) {
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
