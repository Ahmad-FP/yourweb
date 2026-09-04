import { mealById, meals } from "../catalog/meals";
import { getBase } from "../composition/base";
import { cloneLayer, createUserLayer, resolveConfiguration } from "../composition/layer";
import { LIMITS } from "../composition/limits";
import { consumeConfigurationPreview, recordAppliedPreview } from "../composition/operations";
import type {
  ActivityEntry,
  BaseId,
  CustomCollectionSchema,
  CustomRecord,
  LayerHistoryEntry,
  Scalar,
  UserLayer,
} from "../composition/types";
import { validateUserLayer } from "../composition/validate";
import { deriveGroceryList, updateMealPlan, type PlanUpdateResult } from "../domain/mealPlan";
import type { MealSlot, PlanChange } from "../domain/types";
import { createExportBundle, validateImportBundle } from "./export";
import { createInitialSnapshot, loadSnapshot, persistSnapshot } from "./db";
import type { AppRuntimeState, AppSnapshot } from "./types";

type Listener = () => void;

const now = () => new Date().toISOString();

const activity = (
  source: ActivityEntry["source"],
  title: string,
  detail: string,
  status: ActivityEntry["status"] = "success",
): ActivityEntry => ({ id: crypto.randomUUID(), timestamp: now(), source, title, detail, status });

const historyEntry = (layer: UserLayer, author: LayerHistoryEntry["author"], summary: string): LayerHistoryEntry => ({
  id: crypto.randomUUID(),
  timestamp: now(),
  author,
  summary,
  layer: cloneLayer(layer),
});

const snapshotFromRuntime = (state: AppRuntimeState): AppSnapshot => ({
  layer: state.layer,
  activeSurfaceId: state.activeSurfaceId,
  planRevision: state.planRevision,
  planEntries: state.planEntries,
  favorites: state.favorites,
  customRecords: state.customRecords,
  history: state.history,
  activity: state.activity,
});

/** Fold the base and the saved layer together, then make sure the active surface still exists. */
const runtimeFromSnapshot = (snapshot: AppSnapshot, storageMode: AppRuntimeState["storageMode"]): AppRuntimeState => {
  const { configuration, index } = resolveConfiguration(snapshot.layer);
  const visible = configuration.surfaces.filter((surface) => !surface.hidden);
  const activeSurfaceId = visible.some((surface) => surface.id === snapshot.activeSurfaceId)
    ? snapshot.activeSurfaceId
    : visible[0]?.id ?? configuration.surfaces[0]?.id ?? snapshot.activeSurfaceId;
  return { ...snapshot, activeSurfaceId, ready: true, storageMode, configuration, elements: index };
};

const trimSnapshot = (snapshot: AppSnapshot): AppSnapshot => ({
  ...snapshot,
  history: snapshot.history.slice(-LIMITS.history),
  activity: snapshot.activity.slice(-LIMITS.activity),
});

const schemaFor = (state: AppRuntimeState, collectionId: string) =>
  state.configuration.collections.find((collection) => collection.id === collectionId && !collection.archived);

const validateRecordValues = (schema: CustomCollectionSchema, values: Record<string, unknown>) => {
  const issues: Array<{ path: string; message: string }> = [];
  const allowed = new Set(schema.fields.map((field) => field.id));
  for (const key of Object.keys(values)) if (!allowed.has(key)) issues.push({ path: `/values/${key}`, message: `Unknown field '${key}'.` });
  const coerced: Record<string, Scalar> = {};

  for (const field of schema.fields) {
    const value = values[field.id] ?? field.default ?? null;
    if (field.required && (value === null || value === "")) {
      issues.push({ path: `/values/${field.id}`, message: `${field.label} is required.` });
      continue;
    }
    if (value === null || value === "") {
      coerced[field.id] = null;
      continue;
    }
    if (field.type === "number") {
      const number = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(number)) issues.push({ path: `/values/${field.id}`, message: `${field.label} must be a number.` });
      else if (field.min !== undefined && number < field.min) issues.push({ path: `/values/${field.id}`, message: `${field.label} must be at least ${field.min}.` });
      else if (field.max !== undefined && number > field.max) issues.push({ path: `/values/${field.id}`, message: `${field.label} must be at most ${field.max}.` });
      else coerced[field.id] = number;
      continue;
    }
    if (field.type === "boolean") {
      if (typeof value !== "boolean") issues.push({ path: `/values/${field.id}`, message: `${field.label} must be true or false.` });
      else coerced[field.id] = value;
      continue;
    }
    if (typeof value !== "string") {
      issues.push({ path: `/values/${field.id}`, message: `${field.label} must be text.` });
      continue;
    }
    if (value.length > LIMITS.textLength) issues.push({ path: `/values/${field.id}`, message: `${field.label} exceeds ${LIMITS.textLength} characters.` });
    else if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) issues.push({ path: `/values/${field.id}`, message: `${field.label} must use YYYY-MM-DD.` });
    else if (field.type === "mealRef" && !mealById.has(value)) issues.push({ path: `/values/${field.id}`, message: `Unknown meal '${value}'.` });
    else coerced[field.id] = value;
  }

  return issues.length ? { ok: false as const, issues } : { ok: true as const, values: coerced };
};

export class YourWebStore {
  private state: AppRuntimeState = { ...runtimeFromSnapshot(createInitialSnapshot(), "indexeddb"), ready: false };
  private listeners = new Set<Listener>();
  private writeQueue: Promise<void> = Promise.resolve();

  getSnapshot = () => this.state;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private async persist(next: AppRuntimeState) {
    try {
      await persistSnapshot(snapshotFromRuntime(next));
      return next.storageMode === "indexeddb" ? next : { ...next, storageMode: "indexeddb" as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "IndexedDB is unavailable.";
      return {
        ...next,
        storageMode: "memory" as const,
        activity: [...next.activity, activity("system", "Using memory storage", `${message} Changes will not survive reload.`, "warning")].slice(-LIMITS.activity),
      };
    }
  }

  private queueMutation(mutator: (current: AppRuntimeState) => AppSnapshot | Promise<AppSnapshot>) {
    this.writeQueue = this.writeQueue.then(async () => {
      const snapshot = trimSnapshot(await mutator(this.state));
      this.state = await this.persist(runtimeFromSnapshot(snapshot, this.state.storageMode));
      this.emit();
    });
    return this.writeQueue;
  }

  async initialize() {
    try {
      const { snapshot, migrated } = await loadSnapshot();
      const validation = validateUserLayer(snapshot.layer);
      if (validation.ok) {
        const notes: ActivityEntry[] = [];
        if (migrated) notes.push(activity("system", "Saved setup upgraded", "Your screens, record types and meal history moved to the new layered format."));
        this.state = runtimeFromSnapshot({ ...snapshot, activity: [...snapshot.activity, ...notes] }, "indexeddb");
        if (migrated) await persistSnapshot(snapshotFromRuntime(this.state));
      } else {
        const fallback: AppSnapshot = {
          ...createInitialSnapshot(),
          customRecords: snapshot.customRecords,
          planEntries: snapshot.planEntries,
          planRevision: snapshot.planRevision,
          favorites: snapshot.favorites,
          activity: [
            ...snapshot.activity,
            activity("system", "Setup recovered", "A saved personalisation no longer fits this version of the site and was reset. Your meals, plan and saved entries were kept.", "warning"),
          ],
        };
        this.state = runtimeFromSnapshot(fallback, "indexeddb");
        await persistSnapshot(snapshotFromRuntime(this.state));
      }
    } catch (error) {
      const fallback = createInitialSnapshot();
      fallback.activity.push(activity("system", "Local storage unavailable", error instanceof Error ? error.message : "The app started in memory-only mode.", "warning"));
      this.state = runtimeFromSnapshot(fallback, "memory");
    }
    this.emit();
  }

  setActiveSurface(surfaceId: string) {
    const surface = this.state.configuration.surfaces.find((candidate) => candidate.id === surfaceId);
    if (!surface || surface.hidden) return Promise.resolve();
    return this.queueMutation((state) => ({ ...snapshotFromRuntime(state), activeSurfaceId: surfaceId }));
  }

  /** Swap which developer base the layer sits on. Patches and user screens ride along. */
  switchBase(baseId: BaseId) {
    if (this.state.layer.baseId === baseId) return Promise.resolve();
    return this.queueMutation((state) => {
      const layer = cloneLayer(state.layer);
      layer.baseId = baseId;
      layer.revision += 1;
      const { configuration } = resolveConfiguration(layer);
      return {
        ...snapshotFromRuntime(state),
        layer,
        activeSurfaceId: configuration.surfaces.find((surface) => !surface.hidden)?.id ?? state.activeSurfaceId,
        history: [...state.history, historyEntry(state.layer, "human", `Before switching to ${getBase(baseId).name}`)],
        activity: [...state.activity, activity("human", `${getBase(baseId).name} layout activated`, "The built-in screens changed. Your added screens, record types and interactions came with you.")],
      };
    });
  }

  applyPlanChanges(changes: PlanChange[], author: "human" | "agent", options: { expectedRevision?: number; confirmationToken?: string } = {}): Promise<PlanUpdateResult> {
    const result = updateMealPlan({ revision: this.state.planRevision, entries: this.state.planEntries }, changes, author, options);
    if (!result.ok) return Promise.resolve(result);
    return this.queueMutation((state) => ({
      ...snapshotFromRuntime(state),
      planRevision: result.plan.revision,
      planEntries: result.plan.entries,
      activity: [...state.activity, activity(author, "Week updated", `${result.changed.length} meal(s) set and ${result.removed.length} removed.`)],
    })).then(() => result);
  }

  toggleFavorite(mealId: string, source: "human" | "agent" = "human") {
    if (!mealById.has(mealId)) return Promise.resolve(false);
    const enabled = !this.state.favorites.includes(mealId);
    return this.queueMutation((state) => ({
      ...snapshotFromRuntime(state),
      favorites: enabled ? [...state.favorites, mealId] : state.favorites.filter((id) => id !== mealId),
      activity: [...state.activity, activity(source, enabled ? "Meal saved" : "Meal unsaved", mealById.get(mealId)!.name)],
    })).then(() => enabled);
  }

  addCustomRecord(collectionId: string, values: Record<string, unknown>) {
    const schema = schemaFor(this.state, collectionId);
    if (!schema) return Promise.resolve({ ok: false as const, issues: [{ path: "/collectionId", message: `Unknown active record type '${collectionId}'.` }] });
    const existing = this.state.customRecords.filter((record) => record.collectionId === collectionId);
    if (existing.length >= LIMITS.recordsPerCollection) return Promise.resolve({ ok: false as const, issues: [{ path: "/collectionId", message: `'${collectionId}' has reached its record limit.` }] });
    const validation = validateRecordValues(schema, values);
    if (!validation.ok) return Promise.resolve(validation);
    const timestamp = now();
    const record: CustomRecord = { id: crypto.randomUUID(), collectionId, values: validation.values, createdAt: timestamp, updatedAt: timestamp };
    return this.queueMutation((state) => ({
      ...snapshotFromRuntime(state),
      customRecords: [...state.customRecords, record],
      activity: [...state.activity, activity("human", `${schema.name} updated`, "A local record was added.")],
    })).then(() => ({ ok: true as const, record }));
  }

  removeCustomRecord(recordId: string) {
    const record = this.state.customRecords.find((candidate) => candidate.id === recordId);
    if (!record) return Promise.resolve(false);
    return this.queueMutation((state) => ({ ...snapshotFromRuntime(state), customRecords: state.customRecords.filter((candidate) => candidate.id !== recordId) })).then(() => true);
  }

  applyPreview(previewId: string, author: "human" | "agent" = "agent") {
    const result = consumeConfigurationPreview(previewId, this.state.layer.revision);
    if (!result.ok) return Promise.resolve(result);
    recordAppliedPreview(previewId, result.preview.diff.summary, result.preview.layer.revision);
    return this.queueMutation((state) => {
      const nextSurface = result.preview.diff.addedSurfaces[0] ?? state.activeSurfaceId;
      return {
        ...snapshotFromRuntime(state),
        layer: result.preview.layer,
        activeSurfaceId: nextSurface,
        history: [...state.history, historyEntry(state.layer, author, result.preview.diff.summary)],
        activity: [...state.activity, activity(author, "Interface recomposed", result.preview.diff.summary)],
      };
    }).then(() => result);
  }

  undoConfiguration(source: "human" | "agent" = "human") {
    const previous = this.state.history.at(-1);
    if (!previous) return Promise.resolve(false);
    return this.queueMutation((state) => {
      const restored = cloneLayer(previous.layer);
      restored.revision = state.layer.revision + 1;
      return {
        ...snapshotFromRuntime(state),
        layer: restored,
        history: state.history.slice(0, -1),
        activity: [...state.activity, activity(source, "Interface change undone", previous.summary)],
      };
    }).then(() => true);
  }

  /** Drop every personalisation, keeping the base choice, the meal plan and every record. */
  resetConfiguration() {
    return this.queueMutation((state) => {
      const layer = createUserLayer(state.layer.baseId);
      layer.revision = state.layer.revision + 1;
      return {
        ...snapshotFromRuntime(state),
        layer,
        history: [...state.history, historyEntry(state.layer, "human", "Before resetting to the built-in layout")],
        activity: [...state.activity, activity("human", "Personalisation cleared", "The site is back to its built-in screens. Your meals, plan and saved entries were kept.")],
      };
    });
  }

  exportBundle(includeRecords: boolean) {
    return createExportBundle(snapshotFromRuntime(this.state), includeRecords);
  }

  importBundle(input: unknown) {
    const validation = validateImportBundle(input);
    if (!validation.ok) return Promise.resolve(validation);
    return this.queueMutation((state) => {
      const layer = cloneLayer(validation.bundle.layer);
      layer.revision = state.layer.revision + 1;
      return {
        ...snapshotFromRuntime(state),
        layer,
        customRecords: validation.bundle.customRecords ?? state.customRecords,
        history: [...state.history, historyEntry(state.layer, "import", "Before importing a configuration bundle")],
        activity: [...state.activity, activity("human", "Configuration imported", validation.bundle.customRecords ? "Configuration and local records were imported." : "Configuration imported; existing local records were preserved.")],
      };
    }).then(() => validation);
  }

  addActivity(entry: Omit<ActivityEntry, "id" | "timestamp">) {
    return this.queueMutation((state) => ({
      ...snapshotFromRuntime(state),
      activity: [...state.activity, { ...entry, id: crypto.randomUUID(), timestamp: now() }],
    }));
  }

  recordsFor(collectionId: string) {
    return this.state.customRecords.filter((record) => record.collectionId === collectionId);
  }

  getResources(): Record<string, readonly Record<string, unknown>[]> {
    const custom = Object.fromEntries(
      this.state.configuration.collections
        .filter((collection) => !collection.archived)
        .map((collection) => [collection.id, this.state.customRecords.filter((record) => record.collectionId === collection.id).map((record) => ({ id: record.id, ...record.values }))]),
    );
    return {
      meals: meals as unknown as readonly Record<string, unknown>[],
      "meal-plan": this.state.planEntries as unknown as readonly Record<string, unknown>[],
      "grocery-list": deriveGroceryList(this.state.planEntries) as unknown as readonly Record<string, unknown>[],
      ...custom,
    };
  }
}

export const appStore = new YourWebStore();
