import { describe, expect, it } from "vitest";

import { parseOodaBriefMarkdown } from "../grounding";

const SAMPLE = `# Moab to Grand Junction corridor
`.concat(`
*Research brief generated 2026-07-30*

### Uranium boom towns of the Colorado River [1]

Moab's modern shape was cast in the 1950s uranium rush. Charlie Steen's
Mi Vida mine turned a sleepy ranch town into a boomtown almost overnight.

### The river crossing at Dewey Bridge [2]

Dewey Bridge carried traffic across the Colorado from 1916 until 1988 and
burned in 2008.

### Ghost vineyards of the Grand Valley [UNVERIFIED]

Locals say pre-Prohibition vineyards once lined the valley near Fruita.

## Sources

[1] wikipedia-search: https://en.wikipedia.org/wiki/Moab,_Utah (retrieved 2026-07-30T02:00:00Z)
[2] wikipedia-search: no URL available (retrieved 2026-07-30T02:05:00Z)
`);

describe("parseOodaBriefMarkdown", () => {
  it("parses title, verified and unverified facts, and the source index", () => {
    const brief = parseOodaBriefMarkdown(SAMPLE);
    expect(brief.title).toBe("Moab to Grand Junction corridor");
    expect(brief.facts).toHaveLength(3);

    const [uranium, dewey, vineyards] = brief.facts;
    expect(uranium).toMatchObject({
      title: "Uranium boom towns of the Colorado River",
      verified: true,
      sourceIndexes: [1],
    });
    expect(uranium?.text).toContain("Charlie Steen");
    // The generated-date byline never leaks into fact text.
    expect(uranium?.text).not.toContain("Research brief generated");

    expect(dewey).toMatchObject({ verified: true, sourceIndexes: [2] });
    expect(vineyards).toMatchObject({
      title: "Ghost vineyards of the Grand Valley",
      verified: false,
      sourceIndexes: [],
    });

    expect(brief.sources).toEqual([
      {
        index: 1,
        capabilityId: "wikipedia-search",
        url: "https://en.wikipedia.org/wiki/Moab,_Utah",
        retrievedAt: "2026-07-30T02:00:00Z",
      },
      {
        index: 2,
        capabilityId: "wikipedia-search",
        url: null, // "no URL available" normalizes to null
        retrievedAt: "2026-07-30T02:05:00Z",
      },
    ]);
  });

  it("an empty or notes-free export parses to zero facts", () => {
    const brief = parseOodaBriefMarkdown(
      "# Empty thread\n\n*No research notes promoted yet.*\n",
    );
    expect(brief.title).toBe("Empty thread");
    expect(brief.facts).toHaveLength(0);
    expect(brief.sources).toHaveLength(0);
  });

  it("source lines without a retrieved date still parse", () => {
    const brief = parseOodaBriefMarkdown(
      "# T\n\n### A note [1]\n\nBody text.\n\n## Sources\n\n[1] reddit: https://example.com/r\n",
    );
    expect(brief.sources[0]).toEqual({
      index: 1,
      capabilityId: "reddit",
      url: "https://example.com/r",
      retrievedAt: null,
    });
  });

  it("notes with empty bodies are dropped, not pushed as blank facts", () => {
    const brief = parseOodaBriefMarkdown(
      "# T\n\n### Empty note [1]\n\n### Real note [UNVERIFIED]\n\nSomething.\n\n## Sources\n\n*No verified sources.*\n",
    );
    expect(brief.facts).toHaveLength(1);
    expect(brief.facts[0]?.title).toBe("Real note");
  });
});
