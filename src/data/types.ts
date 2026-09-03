import type { ActivityEntry, CustomRecord, ElementInfo, LayerHistoryEntry, ResolvedConfiguration, UserLayer } from "../composition/types";
import type { PlanEntry } from "../domain/types";

export interface AppSnapshot {
  layer: UserLayer;
  activeSurfaceId: string;
  planRevision: number;
  planEntries: PlanEntry[];
  favorites: string[];
  customRecords: CustomRecord[];
  history: LayerHistoryEntry[];
  activity: ActivityEntry[];
}

export interface AppRuntimeState extends AppSnapshot {
  ready: boolean;
  storageMode: "indexeddb" | "memory";
  /** The developer base folded together with the saved layer. Derived, never persisted. */
  configuration: ResolvedConfiguration;
  /** Ownership, policy and visibility for every addressable element id. */
  elements: Map<string, ElementInfo>;
}
