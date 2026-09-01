import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import { LIMITS } from "../composition/limits";
import { createPresetFork } from "../composition/presets";
import type { ActivityEntry, ConfigurationHistoryEntry, CustomRecord, UIConfiguration } from "../composition/types";
import type { PlanEntry } from "../domain/types";
import type { AppSnapshot } from "./types";

interface AppMeta {
  key: "app";
  configuration: UIConfiguration;
  activeSurfaceId: string;
  planRevision: number;
  favorites: string[];
}

interface YourWebDatabase extends DBSchema {
  meta: { key: "app"; value: AppMeta };
  plan: { key: string; value: PlanEntry; indexes: { "by-date": string } };
  records: { key: string; value: CustomRecord; indexes: { "by-collection": string } };
  history: { key: string; value: ConfigurationHistoryEntry; indexes: { "by-time": string } };
  activity: { key: string; value: ActivityEntry; indexes: { "by-time": string } };
}

const DB_NAME = "yourweb";
const DB_VERSION = 1;
let databasePromise: Promise<IDBPDatabase<YourWebDatabase>> | null = null;

const getDatabase = () => {
  databasePromise ??= openDB<YourWebDatabase>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore("meta", { keyPath: "key" });
      const plan = database.createObjectStore("plan", { keyPath: "id" });
      plan.createIndex("by-date", "date");
      const records = database.createObjectStore("records", { keyPath: "id" });
      records.createIndex("by-collection", "collectionId");
      const history = database.createObjectStore("history", { keyPath: "id" });
      history.createIndex("by-time", "timestamp");
      const activity = database.createObjectStore("activity", { keyPath: "id" });
      activity.createIndex("by-time", "timestamp");
    },
  });
  return databasePromise;
};

export const createInitialSnapshot = (): AppSnapshot => {
  const configuration = createPresetFork("minimal");
  return {
    configuration,
    activeSurfaceId: configuration.surfaces[0]?.id ?? "discover",
    planRevision: 0,
    planEntries: [],
    favorites: [],
    customRecords: [],
    history: [],
    activity: [],
  };
};

export const loadSnapshot = async (): Promise<AppSnapshot> => {
  const database = await getDatabase();
  const [meta, planEntries, customRecords, history, activity] = await Promise.all([
    database.get("meta", "app"),
    database.getAll("plan"),
    database.getAll("records"),
    database.getAllFromIndex("history", "by-time"),
    database.getAllFromIndex("activity", "by-time"),
  ]);
  if (!meta) return createInitialSnapshot();
  return {
    configuration: meta.configuration,
    activeSurfaceId: meta.activeSurfaceId,
    planRevision: meta.planRevision,
    planEntries,
    favorites: meta.favorites,
    customRecords,
    history: history.slice(-LIMITS.history),
    activity: activity.slice(-LIMITS.activity),
  };
};

const putAll = async <T>(store: { put(value: T): Promise<unknown> }, values: readonly T[]) => {
  for (const value of values) await store.put(value);
};

export const persistSnapshot = async (snapshot: AppSnapshot) => {
  const database = await getDatabase();
  const transaction = database.transaction(["meta", "plan", "records", "history", "activity"], "readwrite");
  const { configuration, activeSurfaceId, planRevision, favorites } = snapshot;
  await transaction.objectStore("meta").put({ key: "app", configuration, activeSurfaceId, planRevision, favorites });

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
