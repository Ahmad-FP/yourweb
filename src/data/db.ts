import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import { baseElementIds, isBaseId } from "../composition/base";
import { createUserLayer } from "../composition/layer";
import { LIMITS } from "../composition/limits";
import type { ActivityEntry, CustomRecord, LayerHistoryEntry, UserLayer } from "../composition/types";
import type { PlanEntry } from "../domain/types";
import type { AppSnapshot } from "./types";

interface AppMeta {
  key: "app";
  layer: UserLayer;
  activeSurfaceId: string;
  planRevision: number;
  favorites: string[];
}

interface YourWebDatabase extends DBSchema {
  meta: { key: "app"; value: AppMeta };
  plan: { key: string; value: PlanEntry; indexes: { "by-date": string } };
  records: { key: string; value: CustomRecord; indexes: { "by-collection": string } };
  history: { key: string; value: LayerHistoryEntry; indexes: { "by-time": string } };
  activity: { key: string; value: ActivityEntry; indexes: { "by-time": string } };
}

const DB_NAME = "yourweb";
const DB_VERSION = 2;
let databasePromise: Promise<IDBPDatabase<YourWebDatabase>> | null = null;

const getDatabase = () => {
  databasePromise ??= openDB<YourWebDatabase>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        database.createObjectStore("meta", { keyPath: "key" });
        const plan = database.createObjectStore("plan", { keyPath: "id" });
        plan.createIndex("by-date", "date");
        const records = database.createObjectStore("records", { keyPath: "id" });
        records.createIndex("by-collection", "collectionId");
        const history = database.createObjectStore("history", { keyPath: "id" });
        history.createIndex("by-time", "timestamp");
        const activity = database.createObjectStore("activity", { keyPath: "id" });
        activity.createIndex("by-time", "timestamp");
      }
      if (oldVersion === 1) {
        // Undo history stored whole v1 configurations, which no longer have a meaning.
        // Everything else (plan, records, activity) survives; meta is migrated on load.
        transaction.objectStore("history").clear();
      }
    },
  });
  return databasePromise;
};

/**
 * A v1 record held one flat configuration. Rebuild a v2 layer from it: keep the base choice and
 * anything the assistant added, and let the shipped base supply the rest again.
 */
const migrateLegacyMeta = (meta: Record<string, unknown>): UserLayer => {
  const legacy = meta.configuration as Record<string, unknown> | undefined;
  const presetBase = legacy?.presetBase;
  const layer = createUserLayer(isBaseId(presetBase) ? presetBase : presetBase === "minimal" ? "simple" : "simple");
  const surfaces = Array.isArray(legacy?.surfaces) ? legacy.surfaces : [];
  const collections = Array.isArray(legacy?.collections) ? legacy.collections : [];
  layer.surfaces = surfaces.filter((surface): surface is UserLayer["surfaces"][number] =>
    Boolean(surface) && typeof surface === "object" && typeof (surface as { id?: unknown }).id === "string" && !baseElementIds.has((surface as { id: string }).id),
  );
  layer.collections = collections.filter((collection): collection is UserLayer["collections"][number] =>
    Boolean(collection) && typeof collection === "object" && typeof (collection as { id?: unknown }).id === "string",
  );
  return layer;
};

export const createInitialSnapshot = (): AppSnapshot => ({
  layer: createUserLayer(),
  activeSurfaceId: "discover",
  planRevision: 0,
  planEntries: [],
  favorites: [],
  customRecords: [],
  history: [],
  activity: [],
});

export interface LoadResult {
  snapshot: AppSnapshot;
  migrated: boolean;
}

export const loadSnapshot = async (): Promise<LoadResult> => {
  const database = await getDatabase();
  const [meta, planEntries, customRecords, history, activity] = await Promise.all([
    database.get("meta", "app"),
    database.getAll("plan"),
    database.getAll("records"),
    database.getAllFromIndex("history", "by-time"),
    database.getAllFromIndex("activity", "by-time"),
  ]);
  if (!meta) return { snapshot: createInitialSnapshot(), migrated: false };

  const raw = meta as unknown as Record<string, unknown>;
  const migrated = !raw.layer && Boolean(raw.configuration);
  const layer = migrated ? migrateLegacyMeta(raw) : (raw.layer as UserLayer);

  return {
    snapshot: {
      layer,
      activeSurfaceId: typeof raw.activeSurfaceId === "string" ? raw.activeSurfaceId : "discover",
      planRevision: typeof raw.planRevision === "number" ? raw.planRevision : 0,
      planEntries,
      favorites: Array.isArray(raw.favorites) ? (raw.favorites as string[]) : [],
      customRecords,
      history: migrated ? [] : history.slice(-LIMITS.history),
      activity: activity.slice(-LIMITS.activity),
    },
    migrated,
  };
};

const putAll = async <T>(store: { put(value: T): Promise<unknown> }, values: readonly T[]) => {
  for (const value of values) await store.put(value);
};

export const persistSnapshot = async (snapshot: AppSnapshot) => {
  const database = await getDatabase();
  const transaction = database.transaction(["meta", "plan", "records", "history", "activity"], "readwrite");
  const { layer, activeSurfaceId, planRevision, favorites } = snapshot;
  await transaction.objectStore("meta").put({ key: "app", layer, activeSurfaceId, planRevision, favorites });

  const planStore = transaction.objectStore("plan");
  const recordStore = transaction.objectStore("records");
  const historyStore = transaction.objectStore("history");
  const activityStore = transaction.objectStore("activity");
  await Promise.all([planStore.clear(), recordStore.clear(), historyStore.clear(), activityStore.clear()]);
  await putAll(planStore, snapshot.planEntries);
  await putAll(recordStore, snapshot.customRecords);
  await putAll(historyStore, snapshot.history.slice(-LIMITS.history));
  await putAll(activityStore, snapshot.activity.slice(-LIMITS.activity));
  await transaction.done;
};

export const resetDatabaseForTests = async () => {
  const database = await databasePromise;
  database?.close();
  databasePromise = null;
  await deleteDB(DB_NAME);
};
