import { createContext, useCallback, useContext, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  DRAG_MIME,
  buildDragPayload,
  dragInteractionsFor,
  matchingDropInteraction,
  performDrop,
  readDragPayload,
  type DragPayload,
} from "../composition/interactions";
import type { ResolvedConfiguration, Scalar } from "../composition/types";
import { appStore } from "../data/store";

interface DragContextValue {
  /** Component ids that at least one saved interaction can be dragged from. */
  sources: Set<string>;
  /** Component ids that at least one saved interaction can drop onto. */
  targets: Set<string>;
  active: DragPayload | null;
  status: string;
  beginDrag: (componentId: string, record: Record<string, unknown>, label: string, event: DragEvent) => void;
  endDrag: () => void;
  /** True when the item currently in hand has a binding that this component accepts. */
  accepts: (componentId: string) => boolean;
  drop: (componentId: string, cell: Record<string, Scalar>, event: DragEvent) => void;
}

const noopContext: DragContextValue = {
  sources: new Set(),
  targets: new Set(),
  active: null,
  status: "",
  beginDrag: () => {},
  endDrag: () => {},
  accepts: () => false,
  drop: () => {},
};

const DragContext = createContext<DragContextValue>(noopContext);

export const useDragBindings = () => useContext(DragContext);

/**
 * Turns saved interactions into live drag-and-drop. The payload that crosses the boundary is
 * plain JSON built from the interaction's own expressions, and the drop re-reads the bound action
 * from the persisted definition, so nothing executable ever travels with the pointer.
 */
export function DragBindingProvider({
  configuration,
  resources,
  children,
}: {
  configuration: ResolvedConfiguration;
  resources: Record<string, readonly Record<string, unknown>[]>;
  children: ReactNode;
}) {
  const [active, setActive] = useState<DragPayload | null>(null);
  const [status, setStatus] = useState("");
  const resourcesRef = useRef(resources);
  resourcesRef.current = resources;

  const { sources, targets } = useMemo(() => {
    const sourceIds = new Set<string>();
    const targetIds = new Set<string>();
    for (const interaction of configuration.interactions) {
      if (interaction.enabled === false) continue;
      sourceIds.add(interaction.source.componentId);
      targetIds.add(interaction.target.componentId);
    }
    return { sources: sourceIds, targets: targetIds };
  }, [configuration.interactions]);

  const beginDrag = useCallback(
    (componentId: string, record: Record<string, unknown>, label: string, event: DragEvent) => {
      const interaction = dragInteractionsFor(configuration, componentId)[0];
      if (!interaction) return;
      const payload = buildDragPayload(interaction, record, resourcesRef.current, label);
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
      event.dataTransfer.setData("text/plain", label);
      setActive(payload);
      setStatus("");
    },
    [configuration],
  );

  const endDrag = useCallback(() => setActive(null), []);

  const accepts = useCallback(
    (componentId: string) => Boolean(active && matchingDropInteraction(configuration, componentId, active)),
    [active, configuration],
  );

  const drop = useCallback(
    (componentId: string, cell: Record<string, Scalar>, event: DragEvent) => {
      event.preventDefault();
      // React state is the fast path; the transfer is re-read so a drop still resolves if the
      // source unmounted mid-drag, and either way the payload is validated before it is trusted.
      const payload = active ?? readDragPayload(event.dataTransfer);
      setActive(null);
      if (!payload) return;
      const interaction = matchingDropInteraction(configuration, componentId, payload);
      if (!interaction) return;
      void performDrop(interaction, payload, cell, resourcesRef.current, appStore).then((result) => {
        setStatus(result.message);
        window.setTimeout(() => setStatus((current) => (current === result.message ? "" : current)), 4000);
      });
    },
    [active, configuration],
  );

  const value = useMemo<DragContextValue>(
    () => ({ sources, targets, active, status, beginDrag, endDrag, accepts, drop }),
    [sources, targets, active, status, beginDrag, endDrag, accepts, drop],
  );

  return (
    <DragContext.Provider value={value}>
      {children}
      <p className="drag-status" role="status" aria-live="polite">{status}</p>
    </DragContext.Provider>
  );
}

