# YourWeb

YourWeb is a local-first meal planner built for the OpenAI WebMCP Challenge. It is a useful meal product first: browse 18 synthetic community recipes, inspect nutrition and methods, plan a week, and derive groceries. Its defining WebMCP demonstration is that the user's external AI can also compose a persistent new local feature from a small developer-owned UI grammar.

**Live demo:** [yourweb.datafinansial.workers.dev](https://yourweb.datafinansial.workers.dev)

The canonical demo asks the AI to create a Daily Intake tracker. The AI does not write HTML, CSS, JavaScript, or server code. It declares a local collection, trusted view components, and bounded expressions; YourWeb validates, previews, and renders them. Once created, the tracker works manually and survives reload without another model call.

![YourWeb meal catalog](artifacts/screenshots/catalog-desktop.jpg)

## Run locally

Requirements: Node.js 22 or newer and a WebMCP-capable ChatGPT/Chrome environment.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Production checks:

```bash
npm run typecheck
npm test
npm run build
```

## Try it with Site Tools

Open YourWeb in ChatGPT's in-app browser or Chrome with WebMCP support, enable Site Tools, and use these prompts in order:

1. `Find three high-protein dinners on this site and plan them for Monday, Wednesday, and Friday this week.`
2. `Create a local Daily Intake surface. It should let me log a date, one of the site's meals, and servings; show today's calories and protein; show progress toward 2,000 kcal; and list today's entries. Inspect the site's UI capabilities first, preview the complete change, and tell me when I need to approve it.`
3. Approve the visible preview in YourWeb, then say: `Apply the approved interface preview.`
4. Add an entry in the new tracker, reload the page, and confirm that the surface and record remain.
5. Optional safety proof: manually place a meal in the week, then ask the agent to replace it. YourWeb returns an `Are you sure?` response and a one-use token rather than silently overwriting human-authored work.

The app registers ten static tools: five for meal discovery/planning and five for inspecting and changing the UI configuration. Custom surfaces do not create new dynamic tools.

## Architecture

```text
external AI
    │  ten static WebMCP tools
    ▼
validated commands ── preview / approval / version checks
    │
    ▼
bounded composition kernel
    ├── typed resource and expression evaluator
    ├── closed component registry
    ├── configuration history and undo
    └── shared meal-plan commands
    │
    ▼
React renderer + IndexedDB
```

All mutable state stays in the browser origin's IndexedDB. There is no account, application backend, model API, or real social marketplace. `Minimal` and `Dense` are immutable preset manifests; the active experience is a mutable local fork. Configuration bundles can be exported without personal records, or with records when explicitly selected.

The browser UI and WebMCP tools share the same domain commands. Agent-created surfaces are ordinary durable UI, not screenshots or generated code.

## Security boundary

- No arbitrary HTML, CSS, JavaScript, SQL, URL, network request, module, event handler, or executable string is accepted.
- Components, expressions, actions, fields, resources, and operations are closed discriminated unions with runtime validation and hard limits.
- Structural changes are validated and staged as expiring previews. The visible app must approve a preview before the agent can commit it.
- Human-authored meal-plan conflicts require a one-use, expiring confirmation token bound to the exact retry.
- Stale configuration and plan revisions fail instead of overwriting newer work.
- The application shell, settings, reset, undo, import/export, and recovery path cannot be removed by a configuration.
- Removing a surface never removes its records.
- CSP and Cloudflare response headers restrict scripts, connections, frames, permissions, and referrers.

## Scope and disclosure

The meals, creator profiles, and discussion snippets are deterministic synthetic showcase data. They are not real users or marketplace activity. The product deliberately omits authentication, cross-device sync, publishing, payments, arbitrary app-building, charts, and embedded chat.


## Screens

The `Dense` layout puts the week, the counts, and the grocery list on one screen:

![The Dense weekly layout](artifacts/screenshots/week-dense-desktop.jpg)

On a phone the week becomes a list of days rather than a sideways-scrolling grid:

<img src="artifacts/screenshots/week-mobile.jpg" alt="The week planner on a phone" width="330">

[artifacts/yourweb-proof.mp4](artifacts/yourweb-proof.mp4) is a short silent proof reel recorded against an earlier build, kept as a review artifact.

## License

MIT. See [LICENSE](LICENSE).
