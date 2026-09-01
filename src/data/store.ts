import { mealById, meals } from "../catalog/meals";
import { LIMITS } from "../composition/limits";
import { consumeConfigurationPreview } from "../composition/operations";
import { PRESET_REVISION, createPresetFork, presets, refreshPresetContent } from "../composition/presets";
import type { ActivityEntry, ConfigurationHistoryEntry, CustomCollectionSchema, CustomRecord, Scalar, UIConfiguration } from "../composition/types";
import { validateConfiguration } from "../composition/validate";
import { deriveGroceryList, updateMealPlan, type PlanUpdateResult } from "../domain/mealPlan";
import type { PlanChange } from "../domain/types";
import { createExportBundle, type YourWebBundle, validateImportBundle } from "./export";
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

const runtimeFromSnapshot = (snapshot: AppSnapshot, storageMode: AppRuntimeState["storageMode"]): AppRuntimeState => ({
  ...snapshot,
  ready: true,
  storageMode,
});

const snapshotFromRuntime = (state: AppRuntimeState): AppSnapshot => ({
  configuration: state.configuration,
  activeSurfaceId: state.activeSurfaceId,
  planRevision: state.planRevision,
  planEntries: state.planEntries,
  favorites: state.favorites,
  customRecords: state.customRecords,
  history: state.history,
  activity: state.activity,
});

const trimState = (state: AppRuntimeState): AppRuntimeState => ({
  ...state,
  history: state.history.slice(-LIMITS.history),
  activity: state.activity.slice(-LIMITS.activity),
});

const historyEntry = (configuration: UIConfiguration, author: ConfigurationHistoryEntry["author"], summary: string): ConfigurationHistoryEntry => ({
  id: crypto.randomUUID(),
  timestamp: now(),
  author,
  summary,
  configuration: structuredClone(configuration),
});

const schemaFor = (state: AppRuntimeState, collectionId: string) => state.configuration.collections.find((collection) => collection.id === collectionId && !collection.archived);

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
  private state: AppRuntimeState = { ...createInitialSnapshot(), ready: false, storageMode: "indexeddb" };
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

  private queueMutation(mutator: (current: AppRuntimeState) => AppRuntimeState | Promise<AppRuntimeState>) {
    this.writeQueue = this.writeQueue.then(async () => {
      const candidate = trimState(await mutator(this.state));
      this.state = await this.persist(candidate);
      this.emit();
    });
    return this.writeQueue;
  }

  async initialize() {
    try {
      const loaded = await loadSnapshot();
      const validation = validateConfiguration(loaded.configuration);
      if (validation.ok) {
        const stale = validation.value.presetRevision !== PRESET_REVISION;
        const configuration = stale
          ? { ...refreshPresetContent(validation.value), version: validation.value.version + 1 }
          : validation.value;
        const validSurface = configuration.surfaces.some((surface) => surface.id === loaded.activeSurfaceId);
        const snapshot = {
          ...loaded,
          configuration,
          activeSurfaceId: validSurface ? loaded.activeSurfaceId : configuration.surfaces[0]!.id,
          history: stale ? [...loaded.history, historyEntry(validation.value, "system", "Before applying updated built-in layouts")] : loaded.history,
          activity: stale
            ? [...loaded.activity, activity("system", "Built-in layouts updated", "The shipped Meals and Week screens were refreshed. Your plan, saved entries and any assistant-created screens were kept.")]
            : loaded.activity,
        };
        this.state = runtimeFromSnapshot(snapshot, "indexeddb");
        if (stale) await persistSnapshot(snapshot);
      } else {
        const fallback = createInitialSnapshot();
        fallback.customRecords = loaded.customRecords;
        fallback.planEntries = loaded.planEntries;
        fallback.planRevision = loaded.planRevision;
        fallback.activity = [...loaded.activity, activity("system", "Configuration recovered", "An invalid saved configuration was replaced with Minimal. Personal records and meal history were preserved.", "warning")];
        this.state = runtimeFromSnapshot(fallback, "indexeddb");
        await persistSnapshot(fallback);
      }
    } catch (error) {
      const fallback = createInitialSnapshot();
      fallback.activity.push(activity("system", "Local storage unavailable", error instanceof Error ? error.message : "The app started in memory-only mode.", "warning"));
      this.state = runtimeFromSnapshot(fallback, "memory");
    }
    this.emit();
  }

  setActiveSurface(surfaceId: string) {
    if (!this.state.configuration.surfaces.some((surface) => surface.id === surfaceId)) return Promise.resolve();
    return this.queueMutation((state) => ({ ...state, activeSurfaceId: surfaceId }));
  }

  switchPreset(preset: keyof typeof presets) {
    return this.queueMutation((state) => {
      const configuration = createPresetFork(preset);
      configuration.version = state.configuration.version + 1;
      return {
        ...state,
        configuration,
        activeSurfaceId: configuration.surfaces[0]!.id,
        history: [...state.history, historyEntry(state.configuration, "human", `Before switching to ${configuration.name}`)],
        activity: [...state.activity, activity("human", `${configuration.name} activated`, "The layout changed; meal plans and custom records stayed in place.")],
      };
    });
  }

  applyPlanChanges(changes: PlanChange[], author: "human" | "agent", options: { expectedRevision?: number; confirmationToken?: string } = {}): Promise<PlanUpdateResult> {
    const result = updateMealPlan({ revision: this.state.planRevision, entries: this.state.planEntries }, changes, author, options);
    if (!result.ok) return Promise.resolve(result);
    return this.queueMutation((state) => ({
      ...state,
      planRevision: result.plan.revision,
      planEntries: result.plan.entries,
      activity: [...state.activity, activity(author, "Week updated", `${result.changed.length} meal(s) set and ${result.removed.length} removed.`)],
    })).then(() => result);
  }

  toggleFavorite(mealId: string, source: "human" | "agent" = "human") {
    if (!mealById.has(mealId)) return Promise.resolve(false);
    const enabled = !this.state.favorites.includes(mealId);
    return this.queueMutation((state) => ({
      ...state,
      favorites: enabled ? [...state.favorites, mealId] : state.favorites.filter((id) => id !== mealId),
      activity: [...state.activity, activity(source, enabled ? "Meal saved" : "Meal unsaved", mealById.get(mealId)!.name)],
    })).then(() => enabled);
  }

  addCustomRecord(collectionId: string, values: Record<string, unknown>) {
    const schema = schemaFor(this.state, collectionId);
    if (!schema) return Promise.resolve({ ok: false as const, issues: [{ path: "/collectionId", message: `Unknown active collection '${collectionId}'.` }] });
    const existing = this.state.customRecords.filter((record) => record.collectionId === collectionId);
    if (existing.length >= LIMITS.recordsPerCollection) return Promise.resolve({ ok: false as const, issues: [{ path: "/collectionId", message: `Collection '${collectionId}' has reached its record limit.` }] });
    const validation = validateRecordValues(schema, values);
    if (!validation.ok) return Promise.resolve(validation);
    const timestamp = now();
    const record: CustomRecord = { id: crypto.randomUUID(), collectionId, values: validation.values, createdAt: timestamp, updatedAt: timestamp };
    return this.queueMutation((state) => ({
      ...state,
      customRecords: [...state.customRecords, record],
      activity: [...state.activity, activity("human", `${schema.name} updated`, "A local record was added.")],
    })).then(() => ({ ok: true as const, record }));
  }

  removeCustomRecord(recordId: string) {
    const record = this.state.customRecords.find((candidate) => candidate.id === recordId);
    if (!record) return Promise.resolve(false);
    return this.queueMutation((state) => ({ ...state, customRecords: state.customRecords.filter((candidate) => candidate.id !== recordId) })).then(() => true);
  }

  applyPreview(previewId: string, author: "human" | "agent" = "agent") {
    const result = consumeConfigurationPreview(previewId, this.state.configuration.version);
    if (!result.ok) return Promise.resolve(result);
    return this.queueMutation((state) => {
      const nextSurface = result.preview.diff.addedSurfaces[0] ?? state.activeSurfaceId;
      return {
        ...state,
        configuration: result.preview.configuration,
        activeSurfaceId: result.preview.configuration.surfaces.some((surface) => surface.id === nextSurface) ? nextSurface : result.preview.configuration.surfaces[0]!.id,
        history: [...state.history, historyEntry(state.configuration, author, result.preview.diff.summary)],
        activity: [...state.activity, activity(author, "Interface recomposed", result.preview.diff.summary)],
      };
    }).then(() => result);
  }

  undoConfiguration(source: "human" | "agent" = "human") {
    const previous = this.state.history.at(-1);
    if (!previous) return Promise.resolve(false);
    return this.queueMutation((state) => {
      const restored = structuredClone(previous.configuration);
      restored.version = state.configuration.version + 1;
      return {
        ...state,
        configuration: restored,
        activeSurfaceId: restored.surfaces.some((surface) => surface.id === state.activeSurfaceId) ? state.activeSurfaceId : restored.surfaces[0]!.id,
        history: state.history.slice(0, -1),
        activity: [...state.activity, activity(source, "Interface change undone", previous.summary)],
      };
    }).then(() => true);
  }

  resetConfiguration() {
    return this.switchPreset(this.state.configuration.presetBase);
  }

  exportBundle(includeRecords: boolean) {
    return createExportBundle(snapshotFromRuntime(this.state), includeRecords);
  }

  importBundle(input: unknown) {
    const validation = validateImportBundle(input);
    if (!validation.ok) return Promise.resolve(validation);
    return this.queueMutation((state) => {
      const configuration = structuredClone(validation.bundle.configuration);
      configuration.version = state.configuration.version + 1;
      return {
        ...state,
        configuration,
        activeSurfaceId: configuration.surfaces[0]!.id,
        customRecords: validation.bundle.customRecords ?? state.customRecords,
        history: [...state.history, historyEntry(state.configuration, "import", "Before importing a configuration bundle")],
        activity: [...state.activity, activity("human", "Configuration imported", validation.bundle.customRecords ? "Configuration and local records were imported." : "Configuration imported; existing local records were preserved.")],
      };
    }).then(() => validation);
  }

  addActivity(entry: Omit<ActivityEntry, "id" | "timestamp">) {
    return this.queueMutation((state) => ({ ...state, activity: [...state.activity, { ...entry, id: crypto.randomUUID(), timestamp: now() }] }));
  }

  getResources() {
    const groceryList = deriveGroceryList(this.state.planEntries);
    const custom = Object.fromEntries(
      this.state.configuration.collections
        .filter((collection) => !collection.archived)
        .map((collection) => [collection.id, this.state.customRecords.filter((record) => record.collectionId === collection.id).map((record) => ({ id: record.id, ...record.values }))]),
    );
    return {
      meals,
      "meal-plan": this.state.planEntries,
      "grocery-list": groceryList,
      ...custom,
    };
  }
}

export const appStore = new YourWebStore();
