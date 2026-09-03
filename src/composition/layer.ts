import { DEFAULT_BASE_ID, getBase } from "./base";
import { CAPABILITY_VERSION } from "./limits";
import { effectivePolicy } from "./policy";
import type {
  BaseDefinition,
  BaseId,
  ComponentNode,
  ElementInfo,
  ElementOwner,
  LayerPatch,
  ResolvedConfiguration,
  ResolvedSurface,
  SurfaceDefinition,
  UserLayer,
} from "./types";

export const createUserLayer = (baseId: BaseId = DEFAULT_BASE_ID): UserLayer => ({
  schemaVersion: 2,
  capabilityVersion: CAPABILITY_VERSION,
  baseId,
  revision: 1,
  patches: [],
  surfaces: [],
  collections: [],
  interactions: [],
});

export const cloneLayer = (layer: UserLayer): UserLayer => structuredClone(layer);

const childrenOf = (node: ComponentNode): ComponentNode[] | null =>
  node.kind === "section" || node.kind === "grid" ? node.children : null;

export interface ResolveResult {
  configuration: ResolvedConfiguration;
  /** Every addressable element by id, with the policy and ownership that governs it. */
  index: Map<string, ElementInfo>;
  /** Patches whose target no longer exists in the shipped base. Kept, but not applied. */
  inertPatches: LayerPatch[];
}

/**
 * Fold the user layer onto the developer base. The base is never mutated: it is cloned, patched
 * in memory, and thrown away on the next render. That is what lets a base ship new structure
 * without touching anything the user saved.
 */
export const resolveConfiguration = (layer: UserLayer, override?: BaseDefinition): ResolveResult => {
  const base = override ?? getBase(layer.baseId);
  const index = new Map<string, ElementInfo>();
  const inertPatches: LayerPatch[] = [];

  const hidden = new Set<string>();
  const moves = new Map<string, number>();
  const inserts = new Map<string, { node: ComponentNode; position?: number }[]>();

  for (const patch of layer.patches) {
    switch (patch.op) {
      case "hide":
        hidden.add(patch.targetId);
        break;
      case "move_surface":
        moves.set(patch.surfaceId, patch.order);
        break;
      case "insert": {
        const list = inserts.get(patch.slotId) ?? [];
        list.push({ node: patch.node, position: patch.position });
        inserts.set(patch.slotId, list);
        break;
      }
    }
  }

  const touched = new Set<string>();

  const walk = (
    node: ComponentNode,
    owner: ElementOwner,
    surfaceId: string,
    parentHidden: boolean,
    insertedIntoSlot?: string,
  ): ComponentNode => {
    touched.add(node.id);
    const policy = effectivePolicy(owner, node.policy);
    const isHidden = parentHidden || hidden.has(node.id);
    index.set(node.id, {
      id: node.id,
      kind: node.kind,
      owner,
      surfaceId,
      policy,
      hidden: isHidden,
      ...(insertedIntoSlot ? { insertedIntoSlot } : {}),
    });

    const children = childrenOf(node);
    if (!children) return node;

    const own = children.map((child) => walk(child, owner, surfaceId, isHidden));
    const added = policy.extendable ? inserts.get(node.id) ?? [] : [];
    if (!policy.extendable && inserts.has(node.id)) {
      for (const entry of inserts.get(node.id) ?? []) inertPatches.push({ op: "insert", slotId: node.id, node: entry.node, position: entry.position });
    }

    const merged = [...own];
    for (const entry of added) {
      const resolvedChild = walk(entry.node, "user", surfaceId, isHidden, node.id);
      const at = entry.position === undefined ? merged.length : Math.max(0, Math.min(entry.position, merged.length));
      merged.splice(at, 0, resolvedChild);
    }

    return { ...node, children: merged } as ComponentNode;
  };

  const resolveSurface = (surface: SurfaceDefinition, owner: ElementOwner): ResolvedSurface => {
    touched.add(surface.id);
    const policy = effectivePolicy(owner, surface.policy);
    const isHidden = hidden.has(surface.id);
    const order = policy.movable ? moves.get(surface.id) ?? surface.order : surface.order;
    index.set(surface.id, { id: surface.id, kind: "surface", owner, surfaceId: surface.id, policy, hidden: isHidden });
    return { ...surface, order, owner, hidden: isHidden, root: walk(surface.root, owner, surface.id, isHidden) };
  };

  const surfaces = [
    ...structuredClone(base.surfaces).map((surface) => resolveSurface(surface, "developer")),
    ...structuredClone(layer.surfaces).map((surface) => resolveSurface(surface, "user")),
  ].sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));

  for (const patch of layer.patches) {
    const target = patch.op === "hide" ? patch.targetId : patch.op === "move_surface" ? patch.surfaceId : patch.slotId;
    if (!touched.has(target)) inertPatches.push(patch);
  }

  return {
    configuration: {
      baseId: base.id,
      baseName: base.name,
      baseRevision: base.revision,
      revision: layer.revision,
      surfaces,
      collections: [...structuredClone(base.collections), ...structuredClone(layer.collections)],
      interactions: structuredClone(layer.interactions),
    },
    index,
    inertPatches,
  };
};

export const findComponent = (configuration: ResolvedConfiguration, componentId: string): ComponentNode | null => {
  const search = (node: ComponentNode): ComponentNode | null => {
    if (node.id === componentId) return node;
    for (const child of childrenOf(node) ?? []) {
      const found = search(child);
      if (found) return found;
    }
    return null;
  };
  for (const surface of configuration.surfaces) {
    const found = search(surface.root);
    if (found) return found;
  }
  return null;
};

export const collectComponents = (configuration: ResolvedConfiguration): ComponentNode[] => {
  const out: ComponentNode[] = [];
  const walk = (node: ComponentNode) => {
    out.push(node);
    for (const child of childrenOf(node) ?? []) walk(child);
  };
  for (const surface of configuration.surfaces) walk(surface.root);
  return out;
};
