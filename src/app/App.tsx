import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { Meal } from "../catalog/types";
import { bases } from "../composition/base";
import { approveConfigurationPreview, clearConfigurationPreviews } from "../composition/operations";
import type { BaseId } from "../composition/types";
import { appStore } from "../data/store";
import { InteractionSummary, SurfaceRenderer } from "../components/Renderer";
import { RecipeSheet } from "../components/MealViews";
import { Activity, GripVertical, Import, LayoutGrid, RotateCcw, Settings2, Sparkles, Undo2, Utensils, X, surfaceIcons } from "../components/icons";
import { useAppState, useLatestPreview } from "./useStore";

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => { finished: Promise<void> };
};

const transition = (callback: () => void | Promise<void>) => {
  const documentWithTransition = document as ViewTransitionDocument;
  if (documentWithTransition.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return documentWithTransition.startViewTransition(callback).finished;
  }
  return Promise.resolve(callback());
};

const downloadJson = (filename: string, value: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const formatActivityTime = (timestamp: string) => new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));

export function App() {
  const state = useAppState();
  const preview = useLatestPreview();
  const [selectedMeal, setSelectedMeal] = useState<Meal | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [includeRecords, setIncludeRecords] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const hashRestored = useRef(false);
  const surfaces = useMemo(() => state.configuration.surfaces.filter((surface) => !surface.hidden), [state.configuration.surfaces]);
  const activeSurface = surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? surfaces[0];
  const registration = window.__YOURWEB_WEBMCP__;
  const toolsReady = Boolean(document.modelContext && registration?.registered);
  const derivedCount = registration?.derived ?? 0;
  const personalised =
    state.layer.patches.length + state.layer.surfaces.length + state.layer.collections.length + state.layer.interactions.length;

  useEffect(() => {
    if (hashRestored.current) return;
    hashRestored.current = true;
    const hash = window.location.hash.replace(/^#\/?/, "");
    if (hash && surfaces.some((surface) => surface.id === hash) && hash !== state.activeSurfaceId) void appStore.setActiveSurface(hash);
  }, [state.activeSurfaceId, surfaces]);

  useEffect(() => {
    if (activeSurface && window.location.hash !== `#/${activeSurface.id}`) history.replaceState(null, "", `#/${activeSurface.id}`);
  }, [activeSurface]);

  const navigate = (surfaceId: string) => {
    if (surfaceId === state.activeSurfaceId) return;
    void transition(() => appStore.setActiveSurface(surfaceId));
  };

  /**
   * Approving is applying. The click used to only mark the preview approved,
   * leaving the commit to a follow-up call from the assistant -- so a user who
   * approved and walked away never got the change they had just agreed to.
   */
  const approveAndApply = async (previewId: string) => {
    if (!approveConfigurationPreview(previewId)) return;
    await transition(async () => {
      const result = await appStore.applyPreview(previewId, "human");
      if (!result.ok) {
        await appStore.addActivity({ source: "human", title: "Could not apply", detail: result.message, status: "error" });
      }
    });
  };

  const switchBase = (baseId: BaseId) => {
    if (state.layer.baseId === baseId) return;
    void transition(() => appStore.switchBase(baseId));
  };

  const importBundle = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      await appStore.importBundle(parsed);
    } catch {
      await appStore.addActivity({ source: "human", title: "Import failed", detail: "Choose a valid YourWeb JSON bundle.", status: "error" });
    }
  };

  if (!state.ready || !activeSurface) {
    return <main className="boot-screen"><div className="brand-mark"><Utensils /></div><h1>Setting the table…</h1><p>Restoring your saved meals and plan.</p></main>;
  }

  return (
    <div className={`app-shell base-${state.configuration.baseId}`}>
      <header className="top-shell">
        <button type="button" className="brand" onClick={() => navigate(surfaces[0]!.id)} aria-label="YourWeb home">
          <span className="brand-mark"><Utensils size={20} /></span>
          <span><b>YourWeb</b><small>Meal planner</small></span>
        </button>

        <nav className="surface-nav" aria-label="Sections">
          {surfaces.map((surface) => {
            const Icon = surfaceIcons[surface.icon ?? "spark"] ?? Sparkles;
            return (
              <button
                type="button"
                key={surface.id}
                className={`${surface.id === activeSurface.id ? "is-active" : ""} ${surface.owner === "user" ? "is-yours" : ""}`}
                onClick={() => navigate(surface.id)}
                aria-current={surface.id === activeSurface.id ? "page" : undefined}
                title={surface.owner === "user" ? "Added for you" : undefined}
              >
                <Icon size={17} /><span>{surface.shortTitle ?? surface.title}</span>
              </button>
            );
          })}
        </nav>

        <div className="shell-actions">
          <button type="button" className={`tool-status ${toolsReady ? "is-ready" : ""}`} onClick={() => setActivityOpen((open) => !open)} aria-expanded={activityOpen}>
            <i />
            <span>{toolsReady ? (derivedCount ? `Site Tools ready · +${derivedCount} yours` : "Site Tools ready") : "Site Tools waiting"}</span>
            <Activity size={16} />
          </button>
          <button type="button" className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Open settings"><Settings2 /></button>
        </div>
      </header>

      <main className="surface-canvas" id="main-content">
        <SurfaceRenderer surface={activeSurface} state={state} onSelectMeal={setSelectedMeal} onNavigate={navigate} />
      </main>

      <footer className="site-footer">
        <span>YourWeb · WebMCP composition prototype</span>
        <span>Community profiles, meals and comments are synthetic showcase content.</span>
        <span>{state.storageMode === "indexeddb" ? "Saved in this browser" : "Memory-only session"}</span>
      </footer>

      {selectedMeal ? <RecipeSheet meal={selectedMeal} onClose={() => setSelectedMeal(null)} /> : null}

      {preview ? (
        <aside className={`preview-dock ${preview.approvedAt ? "is-approved" : ""}`} aria-label="Proposed changes">
          <div className="preview-icon"><LayoutGrid /></div>
          <div>
            <span>{preview.approvedAt ? "Approved and ready to apply" : "Review changes from your assistant"}</span>
            <h2>{preview.diff.summary}</h2>
            <div className="diff-pills">
              {preview.diff.addedSurfaces.map((id) => <b key={`surface-${id}`}>+ screen: {id}</b>)}
              {preview.diff.addedCollections.map((id) => <b key={`collection-${id}`}>+ records: {id}</b>)}
              {preview.diff.addedInteractions.map((id) => <b className="is-drag" key={`interaction-${id}`}>+ drag: {id}</b>)}
              {preview.diff.insertedNodes.map((id) => <b key={`node-${id}`}>+ block: {id}</b>)}
              {preview.diff.hiddenElements.map((id) => <b className="is-hide" key={`hide-${id}`}>hide: {id}</b>)}
              {preview.diff.shownElements.map((id) => <b key={`show-${id}`}>show: {id}</b>)}
              {preview.diff.removedSurfaces.map((id) => <b className="is-remove" key={`remove-${id}`}>− screen: {id}</b>)}
            </div>
            {preview.diff.warnings.length ? <p className="preview-warning">{preview.diff.warnings.join(" ")}</p> : null}
          </div>
          <div className="preview-actions">
            {preview.approvedAt
              ? <span>Applying…</span>
              : <button type="button" className="primary-button" onClick={() => { void approveAndApply(preview.id); }}>Approve preview</button>}
            <button type="button" className="icon-button" aria-label="Dismiss preview" onClick={clearConfigurationPreviews}><X /></button>
          </div>
        </aside>
      ) : null}

      {activityOpen ? (
        <aside className="activity-panel">
          <header><div><span>Activity</span><h2>Recent changes</h2></div><button type="button" className="icon-button" aria-label="Close activity" onClick={() => setActivityOpen(false)}><X /></button></header>
          <div className="activity-list">
            {state.activity.length
              ? [...state.activity].reverse().map((entry) => (
                  <article key={entry.id} className={`status-${entry.status}`}>
                    <i /><div><b>{entry.title}</b><p>{entry.detail}</p></div><small>{entry.source} · {formatActivityTime(entry.timestamp)}</small>
                  </article>
                ))
              : <div className="activity-empty"><Activity /><p>Changes you or your assistant make will show up here.</p></div>}
          </div>
        </aside>
      ) : null}

      {settingsOpen ? (
        <aside className="settings-panel" aria-label="Settings">
          <button type="button" className="settings-scrim" aria-label="Close settings" onClick={() => setSettingsOpen(false)} />
          <div className="settings-sheet">
            <header><div><span>Preferences</span><h2>Display and data</h2></div><button type="button" className="icon-button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X /></button></header>

            <section>
              <h3>Choose a layout</h3>
              <p>The built-in screens come from YourWeb. Switching between them keeps everything you have added.</p>
              <div className="preset-switch">
                {(Object.values(bases)).map((base) => (
                  <button type="button" key={base.id} className={state.layer.baseId === base.id ? "is-active" : ""} onClick={() => switchBase(base.id)}>
                    <span>{base.name}</span><small>{base.tagline}</small>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3>What you have added</h3>
              {personalised ? (
                <>
                  <ul className="layer-summary">
                    {state.layer.surfaces.length ? <li><b>{state.layer.surfaces.length}</b> screen{state.layer.surfaces.length === 1 ? "" : "s"} of your own</li> : null}
                    {state.layer.collections.length ? <li><b>{state.layer.collections.length}</b> record type{state.layer.collections.length === 1 ? "" : "s"}</li> : null}
                    {state.layer.patches.length ? <li><b>{state.layer.patches.length}</b> adjustment{state.layer.patches.length === 1 ? "" : "s"} to the built-in screens</li> : null}
                    {state.layer.interactions.length ? <li><GripVertical size={14} /><b>{state.layer.interactions.length}</b> drag-and-drop interaction{state.layer.interactions.length === 1 ? "" : "s"}</li> : null}
                  </ul>
                  <InteractionSummary configuration={state.configuration} />
                  <p className="settings-note">These sit on top of the built-in screens rather than replacing them, so a YourWeb update keeps them.</p>
                </>
              ) : (
                <p className="settings-note">Nothing yet. Ask your assistant to add a screen, a record type or a new drag-and-drop interaction.</p>
              )}
            </section>

            <section>
              <h3>Undo and reset</h3>
              <div className="settings-action-list">
                <button type="button" onClick={() => void transition(async () => { await appStore.undoConfiguration(); })} disabled={!state.history.length}>
                  <Undo2 /><span><b>Undo the last change</b><small>{state.history.length ? `${state.history.length} earlier version${state.history.length === 1 ? "" : "s"} saved` : "No earlier versions"}</small></span>
                </button>
                <button type="button" onClick={() => void transition(() => appStore.resetConfiguration())} disabled={!personalised}>
                  <RotateCcw /><span><b>Clear everything you have added</b><small>Your meals, plan and saved entries stay untouched</small></span>
                </button>
              </div>
            </section>

            <section>
              <h3>Move your setup</h3>
              <label className="include-data"><input type="checkbox" checked={includeRecords} onChange={(event) => setIncludeRecords(event.target.checked)} /><span><b>Include my saved entries</b><small>Off by default.</small></span></label>
              <div className="export-actions">
                <button type="button" className="secondary-button" onClick={() => downloadJson(`yourweb-${state.configuration.baseId}-${Date.now()}.json`, appStore.exportBundle(includeRecords))}><LayoutGrid size={17} />Export JSON</button>
                <button type="button" className="secondary-button" onClick={() => importInput.current?.click()}><Import size={17} />Import JSON</button>
              </div>
              <input ref={importInput} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void importBundle(event)} />
            </section>

            <div className="local-note"><Sparkles /><p><b>Stored on this device.</b> Your layout, history and saved entries stay in this browser.</p></div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
