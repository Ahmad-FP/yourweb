import { performAction, resolveAction, type ActionHost } from "./actions";
import { evaluateExpression } from "./expressions";
import type { InteractionDefinition, ResolvedConfiguration, Scalar } from "./types";

/** What the browser hands between a drag source and a drop target. Plain data, never a function. */
export interface DragPayload {
  interactionId: string;
  type: string;
  values: Record<string, Scalar>;
  label: string;
}

export const DRAG_MIME = "application/x-yourweb-drag";

const isEnabled = (interaction: InteractionDefinition) => interaction.enabled !== false;

export const dragInteractionsFor = (configuration: ResolvedConfiguration, componentId: string) =>
  configuration.interactions.filter((interaction) => isEnabled(interaction) && interaction.source.componentId === componentId);

export const dropInteractionsFor = (configuration: ResolvedConfiguration, componentId: string) =>
  configuration.interactions.filter((interaction) => isEnabled(interaction) && interaction.target.componentId === componentId);

const scalar = (value: unknown): Scalar => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
};

export const buildDragPayload = (
  interaction: InteractionDefinition,
  record: Record<string, unknown>,
  resources: Record<string, readonly Record<string, unknown>[]>,
  label: string,
): DragPayload => {
  const values: Record<string, Scalar> = {};
  for (const [name, expression] of Object.entries(interaction.source.payload)) {
    const result = evaluateExpression(expression, { resources, record });
    values[name] = result.ok ? scalar(result.value) : null;
  }
  return { interactionId: interaction.id, type: interaction.source.type, values, label };
};

export const readDragPayload = (transfer: DataTransfer | null): DragPayload | null => {
  const raw = transfer?.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<DragPayload>;
    if (typeof candidate.interactionId !== "string" || typeof candidate.type !== "string" || typeof candidate.values !== "object" || candidate.values === null) return null;
    return { interactionId: candidate.interactionId, type: candidate.type, values: candidate.values as Record<string, Scalar>, label: typeof candidate.label === "string" ? candidate.label : "" };
  } catch {
    return null;
  }
};

export const matchingDropInteraction = (
  configuration: ResolvedConfiguration,
  targetComponentId: string,
  payload: DragPayload,
) =>
  dropInteractionsFor(configuration, targetComponentId).find(
    (interaction) => interaction.id === payload.interactionId && interaction.target.accepts.includes(payload.type),
  ) ?? null;

/**
 * Run one drop. The action was allow-listed at bind time and is re-resolved from the persisted
 * definition here, so nothing executable ever crosses the drag boundary.
 */
export const performDrop = async (
  interaction: InteractionDefinition,
  payload: DragPayload,
  cell: Record<string, Scalar>,
  resources: Record<string, readonly Record<string, unknown>[]>,
  host: ActionHost,
  navigate?: (surfaceId: string) => void,
) => {
  const resolution = resolveAction(interaction.target.action, { resources, dragged: payload.values, cell });
  if (!resolution.ok) return { ok: false, message: resolution.message };
  return performAction(resolution.action, host, navigate);
};

export const describeInteraction = (interaction: InteractionDefinition) =>
  `${interaction.label}: drag from ${interaction.source.componentId} onto ${interaction.target.componentId} to run ${interaction.target.action.id}.`;
