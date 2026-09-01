import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { Meal } from "../catalog/types";
import { approveConfigurationPreview, clearConfigurationPreviews } from "../composition/operations";
import { appStore } from "../data/store";
import { SurfaceRenderer } from "../components/Renderer";
import { RecipeSheet } from "../components/MealViews";
import { Activity, Import, LayoutGrid, RotateCcw, Settings2, Sparkles, Undo2, Utensils, X, surfaceIcons } from "../components/icons";
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
  const surfaces = useMemo(() => [...state.configuration.surfaces].sort((left, right) => left.order - right.order), [state.configuration.surfaces]);
  const activeSurface = surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? surfaces[0];
  const toolsReady = Boolean(document.modelContext && window.__YOURWEB_WEBMCP__?.registered);

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

  const switchPreset = (preset: "minimal" | "dense") => {
    if (state.configuration.presetBase === preset && state.configuration.id === `active-${preset}`) return;
    void transition(() => appStore.switchPreset(preset));
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
    <div className={`app-shell preset-${state.configuration.presetBase}`}>
      <header className="top-shell">
        <button type="button" className="brand" onClick={() => navigate(surfaces[0]!.id)} aria-label="YourWeb home">
          <span className="brand-mark"><Utensils size={20} /></span>
          <span><b>YourWeb</b><small>Meal planner</small></span>
        </button>

        <nav className="surface-nav" aria-label="Sections">
          {surfaces.map((surface) => {
            const Icon = surfaceIcons[surface.icon ?? "spark"] ?? Sparkles;
            return <button type="button" key={surface.id} className={surface.id === activeSurface.id ? "is-active" : ""} onClick={() => navigate(surface.id)} aria-current={surface.id === activeSurface.id ? "page" : undefined}><Icon size={17} /><span>{surface.shortTitle ?? surface.title}</span></button>;
          })}
        </nav>

        <div className="shell-actions">
          <button type="button" className={`tool-status ${toolsReady ? "is-ready" : ""}`} onClick={() => setActivityOpen((open) => !open)} aria-expanded={activityOpen}>
            <i /><span>{toolsReady ? "Site Tools ready" : "Site Tools waiting"}</span><Activity size={16} />
          </button>
          <button type="button" className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Open settings"><Settings2 /></button>
        </div>
      </header>

      <main className="surface-canvas" id="main-content">
        <SurfaceRenderer surface={activeSurface} state={state} onSelectMeal={setSelectedMeal} onNavigate={navigate} />
      </main>

      <footer className="site-footer">
        <span>YourWeb · OpenAI WebMCP Challenge prototype</span>
        <span>Community profiles, meals and comments are synthetic showcase content.</span>
        <span>{state.storageMode === "indexeddb" ? "Saved in this browser" : "Memory-only session"}</span>
      </footer>

      {selectedMeal ? <RecipeSheet meal={selectedMeal} onClose={() => setSelectedMeal(null)} /> : null}

      {preview ? (
        <aside className={`preview-dock ${preview.approvedAt ? "is-approved" : ""}`} aria-label="Proposed changes">
          <div className="preview-icon"><LayoutGrid /></div>
          <div><span>{preview.approvedAt ? "Approved and ready to apply" : "Review changes from your assistant"}</span><h2>{preview.diff.summary}</h2>
            <div className="diff-pills">{preview.diff.addedSurfaces.map((id) => <b key={`surface-${id}`}>+ surface: {id}</b>)}{preview.diff.addedCollections.map((id) => <b key={`collection-${id}`}>+ collection: {id}</b>)}{preview.diff.removedSurfaces.map((id) => <b className="is-remove" key={`remove-${id}`}>− surface: {id}</b>)}</div>
          </div>
          <div className="preview-actions">
            {preview.approvedAt ? <span>Return to ChatGPT to apply preview <code>{preview.id.slice(0, 8)}</code></span> : <button type="button" className="primary-button" onClick={() => { approveConfigurationPreview(preview.id); }}>Approve preview</button>}
            <button type="button" className="icon-button" aria-label="Dismiss preview" onClick={clearConfigurationPreviews}><X /></button>
          </div>
        </aside>
      ) : null}

      {activityOpen ? (
        <aside className="activity-panel">
          <header><div><span>Activity</span><h2>Recent changes</h2></div><button type="button" className="icon-button" aria-label="Close activity" onClick={() => setActivityOpen(false)}><X /></button></header>
          <div className="activity-list">{state.activity.length ? [...state.activity].reverse().map((entry) => <article key={entry.id} className={`status-${entry.status}`}><i /><div><b>{entry.title}</b><p>{entry.detail}</p></div><small>{entry.source} · {formatActivityTime(entry.timestamp)}</small></article>) : <div className="activity-empty"><Activity /><p>Changes you or your assistant make will show up here.</p></div>}</div>
        </aside>
      ) : null}

      {settingsOpen ? (
        <aside className="settings-panel" aria-label="Settings">
          <button type="button" className="settings-scrim" aria-label="Close settings" onClick={() => setSettingsOpen(false)} />
          <div className="settings-sheet">
            <header><div><span>Preferences</span><h2>Display and data</h2></div><button type="button" className="icon-button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X /></button></header>
            <section>
              <h3>Choose a layout</h3>
              <p>Switch how much meal-planning information you see at once.</p>
              <div className="preset-switch"><button type="button" className={state.configuration.presetBase === "minimal" ? "is-active" : ""} onClick={() => switchPreset("minimal")}><span>Minimal</span><small>Recipes and essentials</small></button><button type="button" className={state.configuration.presetBase === "dense" ? "is-active" : ""} onClick={() => switchPreset("dense")}><span>Dense</span><small>Plan, groceries and nutrition</small></button></div>
            </section>
            <section>
              <h3>Undo and reset</h3>
              <div className="settings-action-list">
                <button type="button" onClick={() => void transition(async () => { await appStore.undoConfiguration(); })} disabled={!state.history.length}><Undo2 /><span><b>Undo the last layout change</b><small>{state.history.length ? `${state.history.length} earlier version${state.history.length === 1 ? "" : "s"} saved` : "No earlier versions"}</small></span></button>
                <button type="button" onClick={() => void transition(() => appStore.resetConfiguration())}><RotateCcw /><span><b>Reset to the default layout</b><small>Your meals and saved entries stay untouched</small></span></button>
              </div>
            </section>
            <section>
              <h3>Move your setup</h3>
              <label className="include-data"><input type="checkbox" checked={includeRecords} onChange={(event) => setIncludeRecords(event.target.checked)} /><span><b>Include my saved entries</b><small>Off by default.</small></span></label>
              <div className="export-actions"><button type="button" className="secondary-button" onClick={() => downloadJson(`yourweb-${state.configuration.name.toLocaleLowerCase()}-${Date.now()}.json`, appStore.exportBundle(includeRecords))}><LayoutGrid size={17} />Export JSON</button><button type="button" className="secondary-button" onClick={() => importInput.current?.click()}><Import size={17} />Import JSON</button></div>
              <input ref={importInput} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void importBundle(event)} />
            </section>
            <div className="local-note"><Sparkles /><p><b>Stored on this device.</b> Your layout, history and custom records stay in this browser.</p></div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
