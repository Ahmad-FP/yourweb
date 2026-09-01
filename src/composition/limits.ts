export const LIMITS = {
  surfaces: 8,
  components: 60,
  componentDepth: 6,
  collections: 8,
  fieldsPerCollection: 12,
  recordsPerCollection: 500,
  history: 100,
  activity: 100,
  textLength: 200,
  operationsPerPreview: 64,
  manifestBytes: 128 * 1024,
  expressionDepth: 10,
  expressionWork: 10_000,
  searchResults: 18,
  previewLifetimeMs: 10 * 60 * 1000,
  confirmationLifetimeMs: 5 * 60 * 1000,
} as const;

export const CAPABILITY_VERSION = 1 as const;

export const SAFE_ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;
