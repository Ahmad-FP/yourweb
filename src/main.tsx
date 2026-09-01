import "@fontsource-variable/figtree";
import "@fontsource-variable/source-serif-4";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { appStore } from "./data/store";
import "./styles/index.css";
import { registerWebMCPTools } from "./webmcp/register";

const root = document.getElementById("root");
if (!root) throw new Error("YourWeb root element is missing.");

await appStore.initialize();
await registerWebMCPTools(appStore);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
