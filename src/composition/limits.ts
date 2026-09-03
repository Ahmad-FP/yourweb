export const LIMITS = {
  surfaces: 10,
  userSurfaces: 6,
  components: 60,
  componentDepth: 6,
  collections: 8,
  fieldsPerCollection: 12,
  recordsPerCollection: 500,
  interactions: 8,
  payloadKeys: 8,
  patches: 64,
  history: 100,
  activity: 100,
  textLength: 200,
  operationsPerPreview: 64,
  manifestBytes: 128 * 1024,
  expressionDepth: 10,
  expressionWork: 10_000,
  searchResults: 18,
  derivedTools: 20,
  previewLifetimeMs: 10 * 60 * 1000,
  confirmationLifetimeMs: 5 * 60 * 1000,
} as const;

/** Bumped whenever the composition grammar itself changes shape. */
export const CAPABILITY_VERSION = 2 as const;

/** Bumped whenever the developer ships new base structure. Saved user layers survive it. */
export const BASE_REVISION = 2 as const;

