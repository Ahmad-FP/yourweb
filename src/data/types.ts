import type { ActivityEntry, ConfigurationHistoryEntry, CustomRecord, UIConfiguration } from "../composition/types";
import type { PlanEntry } from "../domain/types";

export interface AppSnapshot {
  configuration: UIConfiguration;
  activeSurfaceId: string;
  planRevision: number;
  planEntries: PlanEntry[];
  favorites: string[];
  customRecords: CustomRecord[];
  history: ConfigurationHistoryEntry[];
  activity: ActivityEntry[];
}

export interface AppRuntimeState extends AppSnapshot {
  ready: boolean;
  storageMode: "indexeddb" | "memory";
}
