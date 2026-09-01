import { describe, expect, it } from "vitest";
import { YourWebStore } from "../data/store";
import { createWebMCPToolsForTesting } from "./register";

const execute = async (definition: WebMCP.ModelContextTool, input: Record<string, unknown>) => {
  const output = await definition.execute(input, { signal: new AbortController().signal });
  if (typeof output !== "string") throw new Error("YourWeb tools must return bounded JSON strings.");
  return JSON.parse(output) as Record<string, unknown>;
};

describe("WebMCP tool contract", () => {
  it("exposes ten concise, non-overlapping static tools with explicit mutation hints", async () => {
    const definitions = createWebMCPToolsForTesting(new YourWebStore());
    const names = definitions.map((definition) => definition.name);
    expect(definitions).toHaveLength(10);
    expect(new Set(names).size).toBe(10);
    expect(definitions.every((definition) => definition.name.length <= 30 && definition.description.length <= 500)).toBe(true);
    expect(definitions.find((definition) => definition.name === "search_meals")?.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(definitions.find((definition) => definition.name === "apply_ui_preview")?.annotations?.readOnlyHint).toBe(false);

    const search = definitions.find((definition) => definition.name === "search_meals");
    if (!search) throw new Error("search_meals is missing.");
    const result = await execute(search, { dietaryTags: ["vegan"], minProtein: 18, limit: 3 });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(JSON.stringify(result).length).toBeLessThan(1_500);
  });
});
