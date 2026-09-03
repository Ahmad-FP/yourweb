# YourWeb

YourWeb is a local-first meal planner where the developer publishes a bounded composition system
over WebMCP, and your own AI assembles a persistent version of the site out of it. The developer
defines what is possible; your assistant composes those possibilities into a version of the site
that fits you, and it survives a reload.

It is a real meal product first: browse 18 synthetic community recipes, read the nutrition and
method, plan a week, derive groceries. Then ask your assistant for the version you actually wanted.

**Live demo:** [yourweb.fpahmad36.workers.dev](https://yourweb.fpahmad36.workers.dev)

The assistant never writes HTML, CSS, JavaScript, or server code. It sends inert JSON describing
screens, record types and interactions; YourWeb validates it against a closed grammar, stages it as
a preview you approve, and renders it with trusted components.

![YourWeb meal catalog](artifacts/screenshots/catalog-desktop.jpg)

## The two halves

Everything in the interface belongs to one of two layers.

**The developer base** ships in the bundle. It is the screens YourWeb itself provides, and it is
never written to your browser's storage. Each element carries a policy saying what a user layer may
do to it: the week screen is movable, its metric row is hideable, its root section is extendable,
and none of it is removable.

**The user layer** is the only thing that persists, and the only thing the assistant can change. It
holds screens, record types and interactions of its own, plus adjustments keyed by base element id
— hide this, move that, insert a block into that slot.

Because the layer stores adjustments rather than a copy of the base, shipping a new base revision
replaces the developer's structure outright while every personalisation whose target still exists
is re-applied on top. An adjustment whose target has left the base goes inert instead of breaking.

```text
developer base (in the bundle)      user layer (in IndexedDB)
  screens + element policy    ×       patches, screens, record types, interactions
                              ↓
                    resolved interface  →  React renderer
                              ↓
                    derived WebMCP tools
```

## Drag and drop is part of the grammar

An interaction is a binding between two components that already exist:

```jsonc
{
  "id": "plan-by-dragging",
  "label": "Drag a meal onto a day",
  "source": { "componentId": "week-picker", "type": "meal",
              "payload": { "mealId": { "op": "field", "name": "id" } } },
  "target": { "componentId": "week-calendar", "accepts": ["meal"],
              "action": { "id": "add_meal_to_plan",
                          "args": { "mealId": { "op": "dragged", "name": "mealId" },
                                    "date":   { "op": "cell", "name": "date" },
                                    "slot":   { "op": "cell", "name": "slot" } } } }
}
```

Dragging a meal card onto a calendar cell is not a behaviour the shipped site has. Your assistant
can create it, and because the interaction lives in the user layer it attaches to `week-calendar`,
a developer-owned component, without editing it. Here `week-picker` is a meal list the assistant
inserted into the week screen's extendable slot in the same batch — a drag cannot cross screens, so
the grammar refuses a binding whose halves sit on different ones and says how to fix it.

The developer decides what is bindable. A meal list can be a drag source of type `meal` exposing
its record fields; a calendar offers `date` and `slot` per cell and permits `add_meal_to_plan` or
`remove_meal_from_plan`; a custom record list permits `log_record`. A binding outside that registry
is refused, and what crosses the pointer boundary is a small JSON payload built from the
interaction's own expressions — never a function.

## Features the assistant builds get their own tools

Custom features do not stay inert. When a record type or an interaction is saved, YourWeb derives
WebMCP tools from the persisted schema, in trusted app code:

- a record type called `intake-log` yields `list_intake_log`, `add_intake_log` and
  `remove_intake_log`, whose input schema is generated from its field definitions;
- the `plan-by-dragging` interaction yields `run_plan_by_dragging`, which performs exactly the drop
  a person would perform by hand.

The derived set is kept in step with what is saved: change the record types or the interactions and
the previous registration is aborted and a fresh set registered. No generated code is executed at
any point — a derived tool is a closure over a validated schema, and its writes go through the same
store methods the visible UI uses.

## Run locally

Requirements: Node.js 22 or newer and a WebMCP-capable browser environment.

```bash
npm install
npm run dev
```

Production checks:

```bash
npm run typecheck
npm test
npm run build
```

## Try it with Site Tools

Open YourWeb in a browser with WebMCP support, enable Site Tools, and work through
[docs/demo.md](docs/demo.md). The short version:

1. `Find three high-protein dinners on this site and plan them for Monday, Wednesday and Friday.`
2. `Read this site's UI capabilities and outline. Then build me a Today screen that logs what I eat
   and tracks 2,000 kcal, and add a way to drag meals straight onto a day in my week. Preview it
   first and tell me when to approve.`
3. Approve the preview in YourWeb, then: `Apply the approved interface preview.`
4. Drag a meal card onto a calendar cell. Reload. Everything is still there.
5. Ask the assistant to `remove the week screen` — it is refused, because the developer marked it
   non-removable, and the reply points at `hide_element` for the parts that may be hidden.

The app registers ten static tools, and as many derived tools as your saved features justify.

## Security boundary

- No arbitrary HTML, CSS, JavaScript, SQL, URL, network request, module, event handler or
  executable string is accepted, from a tool call or an imported bundle.
- Components, expressions, actions, fields, resources, patches, interactions and operations are
  closed discriminated unions with runtime validation and hard limits.
- The developer base cannot be edited, removed or shadowed. Protected elements refuse the operation
  and name the reversible alternative the policy does allow.
- Structural changes are staged as expiring previews. The visible app must approve a preview before
  the agent can commit it, and a stale base revision fails instead of overwriting newer work.
- Human-authored meal-plan conflicts require a one-use, expiring confirmation token bound to the
  exact retry.
- Drag payloads are validated JSON. The bound action is re-read from the persisted definition on
  drop, not carried with the pointer, and a payload that resolves to an unknown meal or a malformed
  cell fails closed.
- Derived tools come from validated schemas, never from generated code, and are named and bounded
  by trusted app code.
- The app shell, settings, reset, undo, import/export and recovery path cannot be removed by a
  configuration. Removing a screen never removes its records; archiving a record type keeps them.
- CSP and Cloudflare response headers restrict scripts, connections, frames, permissions and
  referrers.

## Scope and disclosure

The meals, creator profiles and discussion snippets are deterministic synthetic showcase data. They
are not real users or marketplace activity. All mutable state lives in the browser origin's
IndexedDB; there is no account, application backend, model API or real marketplace. The product
deliberately omits authentication, cross-device sync, publishing, payments, arbitrary app-building,
charts and embedded chat.

Dragging is an addition, not a replacement: every meal can still be planned from the recipe sheet's
keyboard-accessible week picker, whether or not an interaction is bound.

## Screens

The `Dense` base puts the week, the counts and the grocery list on one screen:

![The Dense weekly layout](artifacts/screenshots/week-dense-desktop.jpg)

On a phone the week becomes a list of days rather than a sideways-scrolling grid:

<img src="artifacts/screenshots/week-mobile.jpg" alt="The week planner on a phone" width="330">

[artifacts/yourweb-proof.mp4](artifacts/yourweb-proof.mp4) is a short silent proof reel recorded
against an earlier build, kept as a review artifact.

## License

MIT. See [LICENSE](LICENSE).
