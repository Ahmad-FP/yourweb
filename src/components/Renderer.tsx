import { useMemo, useState, type DragEvent, type FormEvent } from "react";
import { mealById, meals } from "../catalog/meals";
import type { Meal } from "../catalog/types";
import { performAction, resolveAction } from "../composition/actions";
import { evaluateExpression } from "../composition/expressions";
import type {
  ActionBinding,
  ComponentNode,
  CustomCollectionSchema,
  ElementInfo,
  Expression,
  QuerySpec,
  ResolvedConfiguration,
  ResolvedSurface,
} from "../composition/types";
import { appStore } from "../data/store";
import type { AppRuntimeState } from "../data/types";
import { deriveGroceryList } from "../domain/mealPlan";
import { DragBindingProvider, useDragBindings } from "./dragContext";
import { ChevronRight, GripVertical, PackageOpen, Plus } from "./icons";
import { GroceryList, MealMarket, WeekPlanner } from "./MealViews";

type Resources = Record<string, readonly Record<string, unknown>[]>;

interface RendererProps {
  surface: ResolvedSurface;
  state: AppRuntimeState;
  onSelectMeal: (meal: Meal) => void;
  onNavigate: (surfaceId: string) => void;
}

const displayValue = (value: unknown, fieldId?: string) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (fieldId === "meal" || fieldId === "mealId") return typeof value === "string" ? mealById.get(value)?.name ?? value : String(value);
  if (typeof value === "number") return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
  return String(value);
};

const makeResources = (state: AppRuntimeState): Resources => {
  const custom = Object.fromEntries(
    state.configuration.collections
      .filter((collection) => !collection.archived)
      .map((collection) => [collection.id, state.customRecords.filter((record) => record.collectionId === collection.id).map((record) => ({ id: record.id, ...record.values }))]),
  );
  return {
    meals,
    "meal-plan": state.planEntries,
    "grocery-list": deriveGroceryList(state.planEntries),
    ...custom,
  } as unknown as Resources;
};

const queryResource = (query: QuerySpec, resources: Resources) => {
  let records = [...(resources[query.source] ?? [])];
  if (query.where) {
    records = records.filter((record) => {
      const result = evaluateExpression(query.where!, { resources, record });
      return result.ok && Boolean(result.value);
    });
  }
  if (query.sortBy) {
    const direction = query.sortDirection === "desc" ? -1 : 1;
    records.sort((left, right) => String(left[query.sortBy!] ?? "").localeCompare(String(right[query.sortBy!] ?? "")) * direction);
  }
  return records.slice(0, query.limit ?? records.length);
};

const evaluate = (expression: Expression, resources: Resources, record?: Record<string, unknown>) => {
  const result = evaluateExpression(expression, { resources, record });
  return result.ok ? result.value : null;
};

function CustomCollectionView({
  componentId,
  collectionId,
  schema,
  records,
  fields,
  variant,
  emptyText,
  resources,
}: {
  componentId: string;
  collectionId: string;
  schema?: CustomCollectionSchema;
  records: Record<string, unknown>[];
  fields?: string[];
  variant: "cards" | "list" | "table";
  emptyText?: string;
  resources: Resources;
}) {
  const { sources, targets, accepts, beginDrag, endDrag, drop, active } = useDragBindings();
  const [over, setOver] = useState(false);
  const draggable = sources.has(componentId);
  const armed = targets.has(componentId) && accepts(componentId);

  const dropProps = armed
    ? {
        onDragOver: (event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setOver(true);
        },
        onDragLeave: () => setOver(false),
        onDrop: (event: DragEvent<HTMLDivElement>) => {
          setOver(false);
          drop(componentId, { collectionId }, event);
          endDrag();
        },
      }
    : {};

  const dragProps = (record: Record<string, unknown>) =>
    draggable
      ? {
          draggable: true,
          onDragStart: (event: DragEvent<HTMLElement>) => beginDrag(componentId, record, String(record.name ?? schema?.name ?? "record"), event),
          onDragEnd: endDrag,
        }
      : {};

  const wrapperClass = `record-drop ${armed ? "is-target" : ""} ${over ? "is-over" : ""}`;

  if (!records.length) {
    return (
      <div className={wrapperClass} {...dropProps}>
        <div className="empty-state compact">
          <PackageOpen size={24} />
          <h3>Nothing logged yet</h3>
          <p>{armed && active ? `Drop ${active.label} here to log it.` : emptyText ?? "Use the form on this page to add your first entry."}</p>
        </div>
      </div>
    );
  }

  const visibleFields = fields?.length ? fields : schema?.fields.map((field) => field.id) ?? Object.keys(records[0] ?? {}).filter((field) => field !== "id");
  const label = (field: string) => schema?.fields.find((candidate) => candidate.id === field)?.label ?? field;

  return (
    <div className={wrapperClass} {...dropProps}>
      {armed && active ? <p className="drop-banner">Drop {active.label} to log it in {schema?.name ?? collectionId}.</p> : null}
      {variant === "cards" ? (
        <div className="record-card-grid">
          {records.map((record) => (
            <article key={String(record.id)} {...dragProps(record)}>
              {visibleFields.map((field) => <div key={field}><span>{label(field)}</span><b>{displayValue(record[field], field)}</b></div>)}
            </article>
          ))}
        </div>
      ) : variant === "list" ? (
        <ul className="record-list">
          {records.map((record) => (
            <li key={String(record.id)} {...dragProps(record)}>
              {visibleFields.map((field) => <span key={field}>{displayValue(record[field], field)}</span>)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr>{visibleFields.map((field) => <th key={field}>{label(field)}</th>)}<th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {records.map((record) => (
                <tr key={String(record.id)} {...dragProps(record)}>
                  {visibleFields.map((field) => <td key={field}>{displayValue(record[field], field)}</td>)}
                  <td><button type="button" className="text-button danger" onClick={() => void appStore.removeCustomRecord(String(record.id))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CustomRecordForm({ schema, fields, title, submitLabel }: { schema?: CustomCollectionSchema; fields?: string[]; title?: string; submitLabel?: string }) {
  const [status, setStatus] = useState<string>("");
  if (!schema) return <div className="component-error">This form references a missing record type.</div>;
  const visibleFields = fields?.length ? schema.fields.filter((field) => fields.includes(field.id)) : schema.fields;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const values = Object.fromEntries(visibleFields.map((field) => [field.id, field.type === "boolean" ? data.get(field.id) === "on" : data.get(field.id)]));
    const result = await appStore.addCustomRecord(schema.id, values);
    if (result.ok) {
      form.reset();
      setStatus("Saved locally.");
    } else {
      setStatus(result.issues.map((issue) => issue.message).join(" "));
    }
  };

  return (
    <form className="custom-form" onSubmit={(event) => void submit(event)}>
      {title ? <h3>{title}</h3> : null}
      <div className="custom-form-fields">
        {visibleFields.map((field) => (
          <label key={field.id} className={field.type === "boolean" ? "checkbox-field" : ""}>
            <span>{field.label}{field.required ? " *" : ""}</span>
            {field.type === "mealRef" ? (
              <select name={field.id} required={field.required} defaultValue=""><option value="" disabled>Choose a meal</option>{meals.map((meal) => <option key={meal.id} value={meal.id}>{meal.name} · {meal.calories} kcal</option>)}</select>
            ) : field.type === "boolean" ? (
              <input name={field.id} type="checkbox" defaultChecked={Boolean(field.default)} />
            ) : (
              <input
                name={field.id}
                type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                required={field.required}
                min={field.min}
                max={field.max}
                step={field.type === "number" ? "any" : undefined}
                defaultValue={field.type === "date" && !field.default ? new Date().toISOString().slice(0, 10) : field.default === null ? "" : String(field.default ?? "")}
              />
            )}
          </label>
        ))}
      </div>
      <div className="form-actions"><button type="submit" className="primary-button"><Plus size={17} />{submitLabel ?? "Add record"}</button><span role="status">{status}</span></div>
    </form>
  );
}

const runButtonAction = async (action: ActionBinding, resources: Resources, onNavigate: (surfaceId: string) => void) => {
  const resolution = resolveAction(action, { resources });
  if (!resolution.ok) return;
  await performAction(resolution.action, appStore, onNavigate);
};

interface NodeProps {
  component: ComponentNode;
  state: AppRuntimeState;
  resources: Resources;
  elements: Map<string, ElementInfo>;
  onSelectMeal: (meal: Meal) => void;
  onNavigate: (surfaceId: string) => void;
}

function ComponentRenderer({ component, state, resources, elements, onSelectMeal, onNavigate }: NodeProps) {
  if (elements.get(component.id)?.hidden) return null;
  const pass = { state, resources, elements, onSelectMeal, onNavigate };

  switch (component.kind) {
    case "section":
      return (
        <section className={`manifest-section ${component.className ?? ""}`} data-component-id={component.id}>
          {component.title || component.description || component.eyebrow ? (
            <header className="manifest-heading">
              <div>{component.title ? <h1>{component.title}</h1> : null}</div>
              <div>{component.description ? <p>{component.description}</p> : null}{component.eyebrow ? <span className="section-note">{component.eyebrow}</span> : null}</div>
            </header>
          ) : null}
          <div className="manifest-children">{component.children.map((child) => <ComponentRenderer key={child.id} component={child} {...pass} />)}</div>
        </section>
      );
    case "grid":
      return (
        <div className={`manifest-grid columns-${component.columns} ${component.density === "compact" ? "is-compact" : ""}`} data-component-id={component.id}>
          {component.children.map((child) => <ComponentRenderer key={child.id} component={child} {...pass} />)}
        </div>
      );
    case "text":
      return <p className={`manifest-text ${component.variant ?? "body"}`}>{component.text}</p>;
    case "metric": {
      const value = evaluate(component.value, resources);
      return <article className="metric-block" data-component-id={component.id}><span>{component.label}</span><strong>{displayValue(value)}{component.unit ? <small> {component.unit}</small> : null}</strong></article>;
    }
    case "progress": {
      const value = Number(evaluate(component.value, resources) ?? 0);
      const max = Math.max(Number(evaluate(component.max, resources) ?? 0), 1);
      const percent = Math.min(Math.max((value / max) * 100, 0), 100);
      return (
        <article className="progress-block" data-component-id={component.id}>
          <div><span>{component.label}</span><strong>{displayValue(value)} / {displayValue(max)} {component.unit}</strong></div>
          <i><b style={{ width: `${percent}%` }} /></i>
        </article>
      );
    }
    case "calendar":
      return (
        <div className="custom-collection" data-component-id={component.id}>
          {component.title ? <h2>{component.title}</h2> : null}
          <WeekPlanner componentId={component.id} entries={state.planEntries} slots={component.slots} emptyText={component.emptyText} onSelectMeal={onSelectMeal} />
        </div>
      );
    case "collection": {
      if (component.query.source === "meals") {
        return <div data-component-id={component.id}><MealMarket componentId={component.id} limit={component.query.limit} dense={component.variant === "table"} favorites={state.favorites} onSelect={onSelectMeal} /></div>;
      }
      if (component.query.source === "meal-plan") {
        return <div data-component-id={component.id}><WeekPlanner componentId={component.id} entries={state.planEntries} emptyText={component.emptyText} onSelectMeal={onSelectMeal} /></div>;
      }
      if (component.query.source === "grocery-list") {
        return <div data-component-id={component.id}><GroceryList items={deriveGroceryList(state.planEntries)} dense={component.variant === "table"} /></div>;
      }
      const schema = state.configuration.collections.find((collection) => collection.id === component.query.source && !collection.archived);
      const records = queryResource(component.query, resources);
      return (
        <div className="custom-collection" data-component-id={component.id}>
          {component.title ? <h2>{component.title}</h2> : null}
          <CustomCollectionView
            componentId={component.id}
            collectionId={component.query.source}
            schema={schema}
            records={records}
            fields={component.fields}
            variant={component.variant}
            emptyText={component.emptyText}
            resources={resources}
          />
        </div>
      );
    }
    case "recipe": {
      const mealId = evaluate(component.mealId, resources);
      const meal = typeof mealId === "string" ? mealById.get(mealId) : undefined;
      return meal ? (
        <button type="button" className="recipe-inline" data-component-id={component.id} onClick={() => onSelectMeal(meal)}>
          <span><b>{meal.name}</b><small>{meal.calories} kcal · {meal.protein}g protein</small></span><ChevronRight />
        </button>
      ) : <div className="component-error">Recipe binding did not resolve to a meal.</div>;
    }
    case "form":
      return (
        <div data-component-id={component.id}>
          <CustomRecordForm
            schema={state.configuration.collections.find((collection) => collection.id === component.collectionId && !collection.archived)}
            fields={component.fields}
            title={component.title}
            submitLabel={component.submitLabel}
          />
        </div>
      );
    case "button":
      return (
        <button
          type="button"
          data-component-id={component.id}
          className={component.variant === "primary" ? "primary-button" : "secondary-button"}
          onClick={() => void runButtonAction(component.action, resources, onNavigate)}
        >
          {component.label}<ChevronRight size={16} />
        </button>
      );
  }
}

export function SurfaceRenderer({ surface, state, onSelectMeal, onNavigate }: RendererProps) {
  const resources = useMemo(() => makeResources(state), [state]);
  return (
    <DragBindingProvider configuration={state.configuration} resources={resources}>
      <ComponentRenderer component={surface.root} state={state} resources={resources} elements={state.elements} onSelectMeal={onSelectMeal} onNavigate={onNavigate} />
    </DragBindingProvider>
  );
}

export function InteractionSummary({ configuration }: { configuration: ResolvedConfiguration }) {
  if (!configuration.interactions.length) return null;
  return (
    <ul className="interaction-summary">
      {configuration.interactions.map((interaction) => (
        <li key={interaction.id}><GripVertical size={14} /><b>{interaction.label}</b><small>{interaction.source.componentId} → {interaction.target.componentId}</small></li>
      ))}
    </ul>
  );
}

