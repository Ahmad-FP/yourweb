import { CAPABILITY_VERSION, LIMITS } from "../composition/limits";
import type { CustomRecord, UserLayer, ValidationIssue } from "../composition/types";
import { validateUserLayer } from "../composition/validate";
import type { AppSnapshot } from "./types";

export interface YourWebBundle {
  format: "yourweb-bundle";
  formatVersion: 2;
  capabilityVersion: typeof CAPABILITY_VERSION;
  exportedAt: string;
  /** Only the user half travels. The developer base ships with the app. */
  layer: UserLayer;
  customRecords?: CustomRecord[];
}

export const createExportBundle = (snapshot: AppSnapshot, includeRecords: boolean): YourWebBundle => ({
  format: "yourweb-bundle",
  formatVersion: 2,
  capabilityVersion: CAPABILITY_VERSION,
  exportedAt: new Date().toISOString(),
  layer: structuredClone(snapshot.layer),
  ...(includeRecords ? { customRecords: structuredClone(snapshot.customRecords) } : {}),
});

export type ImportValidation =
  | { ok: true; bundle: YourWebBundle }
  | { ok: false; issues: ValidationIssue[] };

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

export const validateImportBundle = (input: unknown): ImportValidation => {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) return { ok: false, issues: [{ path: "/", message: "Import must be a JSON object." }] };
  if (input.format !== "yourweb-bundle" || input.formatVersion !== 2 || input.capabilityVersion !== CAPABILITY_VERSION) {
    issues.push({ path: "/format", message: "Unsupported YourWeb bundle format or version." });
  }
  const layer = validateUserLayer(input.layer);
  if (!layer.ok) issues.push(...layer.issues.map((issue) => ({ ...issue, path: `/layer${issue.path}` })));

  const records: CustomRecord[] = [];
  if (input.customRecords !== undefined) {
    if (!Array.isArray(input.customRecords)) issues.push({ path: "/customRecords", message: "customRecords must be an array when present." });
    else {
      const perCollection = new Map<string, number>();
      input.customRecords.forEach((record, index) => {
        if (!isRecord(record) || typeof record.id !== "string" || typeof record.collectionId !== "string" || !isRecord(record.values) || typeof record.createdAt !== "string" || typeof record.updatedAt !== "string") {
          issues.push({ path: `/customRecords/${index}`, message: "Record shape is invalid." });
          return;
        }
        const nextCount = (perCollection.get(record.collectionId) ?? 0) + 1;
        perCollection.set(record.collectionId, nextCount);
        if (nextCount > LIMITS.recordsPerCollection) issues.push({ path: `/customRecords/${index}`, message: `Collection '${record.collectionId}' exceeds ${LIMITS.recordsPerCollection} records.` });
        if (Object.values(record.values).some((value) => value !== null && !["string", "number", "boolean"].includes(typeof value))) issues.push({ path: `/customRecords/${index}/values`, message: "Record values must be scalar." });
        records.push(record as unknown as CustomRecord);
      });
    }
  }

  if (issues.length || !layer.ok) return { ok: false, issues };
  return {
    ok: true,
    bundle: {
      format: "yourweb-bundle",
      formatVersion: 2,
      capabilityVersion: CAPABILITY_VERSION,
      exportedAt: typeof input.exportedAt === "string" ? input.exportedAt : new Date().toISOString(),
      layer: layer.value,
      ...(input.customRecords ? { customRecords: records } : {}),
    },
  };
};
