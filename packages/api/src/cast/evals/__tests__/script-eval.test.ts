import type { CastScript } from "@sortey/db/schema";
import { describe, expect, it } from "vitest";
import type { CastDayContext } from "../../context";
import {
  countWords,
  evaluateCastScript,
  factEntities,
  factReferenced,
  formatEvalReport,
} from "../script-eval";

/**
 * Every check must be shown to BITE. A quality gate that only ever passes is
 * worse than none: it reads as coverage while asserting nothing. So each case
 * takes the golden script and breaks exactly one contract.
 */

const CONTEXT: CastDayContext = {
  tripName: "Van Trip",
  tz: "America/Denver",
  targetDate: "2026-08-03",
  hasDriveLeg: true,
  degraded: false,
  segment: {
    name: "Bryce Canyon area → Moab",
    originName: "Bryce Canyon area",
    destinationName: "Moab",
    distanceMiles: 250.5,
    durationMinutes: 262,
    hasGeometry: true,
  },
  day: null,
  anchors: [
    {
      title: "Campground reservation",
      kind: "reservation",
      placeName: "Devils Garden",
      startDate: "2026-08-03",
      endDate: null,
      note: null,
    },
  ],
  pois: [
    {
      name: "Hollow Mountain Fuel",
      category: "fuel",
      milesAway: 0.4,
      routeFraction: 0.6,
    },
  ],
  grounding: null,
};

/** ~150 words of plausible narration, no markup. */
function filler(
  words: number,
  seed = "the road unspools ahead of you again",
): string {
  const base = seed.split(" ");
  const out: string[] = [];
  while (out.length < words) out.push(base[out.length % base.length]!);
  return `${out.join(" ")}.`;
}

function goldenScript(): CastScript {
  const intro =
    "Good evening, and welcome to tomorrow's drive down to Moab. " +
    "The road facts tonight come straight from your plan; the stories along " +
    "the way are mine, so take them as campfire truth. " +
    `${filler(120)}`;
  const middle =
    "You will pass Hollow Mountain Fuel before the long empty stretch. " +
    `${filler(600)}`;
  const outro =
    "Devils Garden is holding your site for tomorrow night. " +
    `${filler(120)}`;

  return {
    episodeTitle: "The Reef and the Road",
    outline: [
      { key: "intro", title: "Tomorrow", beats: ["welcome"], wordTarget: 150 },
      { key: "fold", title: "The Fold", beats: ["geology"], wordTarget: 620 },
      {
        key: "outro",
        title: "Into Moab",
        beats: ["send-off"],
        wordTarget: 140,
      },
    ],
    segments: [
      { key: "intro", title: "Tomorrow", text: intro, wordTarget: 150 },
      { key: "fold", title: "The Fold", text: middle, wordTarget: 620 },
      { key: "outro", title: "Into Moab", text: outro, wordTarget: 140 },
    ],
  };
}

const DURATION = 6; // ~870 words at 145 wpm — matches the golden fixture.

function evaluate(script: CastScript, context: CastDayContext = CONTEXT) {
  return evaluateCastScript({ context, script, durationMinutes: DURATION });
}

function failedIds(script: CastScript, context?: CastDayContext): string[] {
  return evaluate(script, context)
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);
}

describe("countWords", () => {
  it("counts what TTS will read, ignoring padding", () => {
    expect(countWords("  two   words \n")).toBe(2);
    expect(countWords("")).toBe(0);
  });
});

describe("evaluateCastScript — the golden script", () => {
  it("passes every error-level check", () => {
    const report = evaluate(goldenScript());
    expect(report.passed, formatEvalReport(report)).toBe(true);
  });
});

describe("evaluateCastScript — each check bites", () => {
  it("catches a chapter that ran long or short", () => {
    const script = goldenScript();
    script.segments[1]!.text = "Too short.";
    expect(failedIds(script)).toContain("chapter-length:fold");
  });

  it("catches an episode that misses its duration budget", () => {
    const script = goldenScript();
    // Halve the long chapter: chapters still self-consistent, episode is not.
    script.segments[1]!.text = filler(300);
    script.segments[1]!.wordTarget = 300;
    script.outline[1]!.wordTarget = 300;
    expect(failedIds(script)).toContain("episode-length");
  });

  it("catches markup that would be read aloud", () => {
    for (const [id, bad] of [
      ["tts-clean:heading", "## The Fold\n\nnarration"],
      ["tts-clean:bullet", "- first stop\n- second stop"],
      ["tts-clean:numbered", "1. first stop\n2. second stop"],
      ["tts-clean:emphasis", "this is **important** country"],
      ["tts-clean:cue", "[sound of wind] the road climbs"],
    ] as const) {
      const script = goldenScript();
      script.segments[1]!.text = `${bad} ${filler(600)}`;
      expect(failedIds(script), id).toContain(id);
    }
  });

  it("catches a missing sourcing disclaimer", () => {
    const script = goldenScript();
    script.segments[0]!.text = filler(150);
    expect(failedIds(script)).toContain("sourcing-disclaimer");
  });

  it("wants the research disclaimer instead when a brief is present", () => {
    const grounded: CastDayContext = {
      ...CONTEXT,
      grounding: {
        title: "Corridor research",
        facts: [
          {
            title: "Waterpocket Fold",
            text: "A hundred-mile monocline.",
            verified: true,
            sourceIndexes: [1],
          },
        ],
      },
    };
    // The campfire-truth line alone is no longer the right disclosure.
    const campfire = goldenScript();
    expect(failedIds(campfire, grounded)).toContain("sourcing-disclaimer");

    const sourced = goldenScript();
    sourced.segments[0]!.text = sourced.segments[0]!.text.replace(
      "the stories along the way are mine, so take them as campfire truth.",
      "the histories come from the trip's research file.",
    );
    expect(failedIds(sourced, grounded)).not.toContain("sourcing-disclaimer");
  });

  it("catches an unmentioned anchor — the reservation the group is counting on", () => {
    const script = goldenScript();
    script.segments[2]!.text = filler(140);
    expect(failedIds(script)).toContain("mentions-anchors");
  });

  it("catches a destination the episode never names", () => {
    const script = goldenScript();
    script.segments[0]!.text = script.segments[0]!.text.replace(
      "down to Moab",
      "onward",
    );
    expect(failedIds(script)).toContain("mentions-destination");
  });

  it("catches an outline whose chapters were not all written", () => {
    const script = goldenScript();
    script.segments.pop();
    expect(failedIds(script)).toContain("outline-coverage");
  });

  it("catches duplicate chapter keys", () => {
    const script = goldenScript();
    script.segments[2]!.key = "intro";
    script.outline[2]!.key = "intro";
    expect(failedIds(script)).toContain("unique-keys");
  });
});

describe("evaluateCastScript — warnings do not fail an episode", () => {
  it("flags unreferenced corridor POIs without failing", () => {
    const script = goldenScript();
    script.segments[1]!.text = filler(620);
    const report = evaluate(script);
    const poi = report.checks.find((c) => c.id === "grounded-poi");
    expect(poi?.passed).toBe(false);
    expect(poi?.severity).toBe("warning");
    expect(report.passed).toBe(true);
  });

  it("flags research that went unused without failing", () => {
    const grounded: CastDayContext = {
      ...CONTEXT,
      grounding: {
        title: "Corridor research",
        facts: [
          {
            title: "Robbers Roost",
            text: "Outlaw country east of Hanksville.",
            verified: true,
            sourceIndexes: [1],
          },
        ],
      },
    };
    const script = goldenScript();
    script.segments[0]!.text = script.segments[0]!.text.replace(
      "the stories along the way are mine, so take them as campfire truth.",
      "the histories come from the trip's research file.",
    );
    const report = evaluateCastScript({
      context: grounded,
      script,
      durationMinutes: DURATION,
    });
    const used = report.checks.find((c) => c.id === "uses-research");
    expect(used?.passed).toBe(false);
    expect(report.passed).toBe(true);
  });
});

describe("factReferenced — found by auditing a real script", () => {
  const fold = {
    title: "The Waterpocket Fold is the spine of the drive",
    text: "Capitol Reef is built around the Waterpocket Fold, a monocline.",
  };
  const hole = {
    title: "Hole-in-the-Rock: six weeks of blasting",
    text: "The road leaves Highway 12 at the town of Escalante.",
  };
  const byway = {
    title: "Highway 12 is an All-American Road",
    text: "It threads Escalante and ends near Torrey.",
  };

  it("pulls proper nouns, not whole titles", () => {
    // Matching the full title scored a script that discusses the fold at
    // length as ignoring it — no narration says a title verbatim.
    expect(factEntities(fold)).toContain("Waterpocket Fold");
  });

  it("counts a fact its own entity identifies", () => {
    expect(
      factReferenced("the Waterpocket Fold runs a hundred miles", fold, [
        fold,
        hole,
        byway,
      ]),
    ).toBe(true);
  });

  it("does NOT count ground shared with another fact", () => {
    // The real failure: a script naming Escalante while describing Highway 12
    // scored the Hole-in-the-Rock expedition as used. Shared ground cannot
    // attribute usage, and a rubber stamp is worse than crying wolf because
    // nobody notices it.
    const narration = "Scenic Byway 12 runs past Escalante toward Torrey.";
    expect(factReferenced(narration, hole, [fold, hole, byway])).toBe(false);
    expect(factReferenced(narration, byway, [fold, hole, byway])).toBe(true);
  });

  it("with no siblings supplied, every entity counts", () => {
    expect(factReferenced("we passed Escalante", hole)).toBe(true);
  });
});
