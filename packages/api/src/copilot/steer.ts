/**
 * Deterministic co-pilot rules engine.
 * Parses intent from natural language (keyword heuristics) and returns
 * PlanOptions grounded in the seed/local world — no LLM required.
 */
import { defaultSeedWorld, legHours, SEED_NODES } from "./seeds";
import type {
  CopilotMoveType,
  CopilotSteerInput,
  CopilotSteerResult,
  CopilotWorld,
  PlanOption,
} from "./types";

function todayIso(input?: string): string {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function classify(message: string): CopilotMoveType {
  const m = message.toLowerCase();
  if (
    /how long|hours|drive time|how far|eta|miles to/.test(m) ||
    /bryce.*denver|denver.*bryce|zion.*bryce/.test(m)
  ) {
    return "question";
  }
  if (
    /laundry|truck\s*stop|costco|fuel|gas|dump|water|camp(site)? tonight|sleep tonight|stage/.test(
      m,
    )
  ) {
    return "service_need";
  }
  if (
    /zion|bryce|utah|2 nights|two nights|heat|hike|grand junction|\bgj\b|denver/.test(
      m,
    ) &&
    /or|vs|versus|better|prefer|should we|2 zion|2 bryce/.test(m)
  ) {
    return "ask_options";
  }
  if (/hike|heat|scenery|rest|short day|miles matter/.test(m)) {
    return "preference";
  }
  if (
    /tonight|camp|yosemite|bay|from the bay|leaving|headed|heading/.test(m)
  ) {
    return "frame";
  }
  if (/zion|bryce|utah|denver|omaha|lake forest|tracy/.test(m)) {
    return "ask_options";
  }
  return "general";
}

function prefersHike(message: string, world: CopilotWorld): boolean {
  const m = message.toLowerCase();
  if (/hike|trail|canyon hike|walking/.test(m)) return true;
  if (/heat|melt|hot|cool|altitude|shade/.test(m)) return false;
  return world.brief.prioritize?.includes("hike") ?? true;
}

function utahOptions(
  today: string,
  world: CopilotWorld,
  hikeFirst: boolean,
): PlanOption[] {
  const d0 = today;
  // Assume caller is deciding Utah after Yosemite block: start +3 days as rough
  const zion1 = addDays(d0, 3);
  const zion2 = addDays(d0, 4);
  const bryceDay = addDays(d0, 5);
  const gj = addDays(d0, 5);
  const gjAlt = addDays(d0, 6);

  const zionBryceGj: PlanOption = {
    id: "opt:2zion-bryce-day-gj",
    title: "2 Zion + Bryce morning → Grand Junction",
    summary:
      "Two Zion nights for the real hike. Bryce is a short rim stop the same day you stage GJ — not an overnight. Protects Denver on the 26th.",
    nights: [
      {
        date: zion1,
        place: "Zion",
        kind: "park",
        role: "play",
        lat: SEED_NODES["node:zion"]!.lat,
        lng: SEED_NODES["node:zion"]!.lng,
      },
      {
        date: zion2,
        place: "Zion",
        kind: "park",
        role: "play",
        lat: SEED_NODES["node:zion"]!.lat,
        lng: SEED_NODES["node:zion"]!.lng,
      },
      {
        date: gj,
        place: "Grand Junction",
        kind: "hotel",
        role: "transit",
        lat: SEED_NODES["node:grand_junction"]!.lat,
        lng: SEED_NODES["node:grand_junction"]!.lng,
      },
    ],
    costs: {
      totalDriveHours:
        (legHours(world, "node:yosemite_valley", "node:zion") ?? 9.5) +
        (legHours(world, "node:zion", "node:bryce") ?? 1.8) +
        (legHours(world, "node:bryce", "node:grand_junction") ?? 4.5),
      maxDayDriveHours: Math.max(
        legHours(world, "node:yosemite_valley", "node:zion") ?? 9.5,
        (legHours(world, "node:zion", "node:bryce") ?? 1.8) +
          (legHours(world, "node:bryce", "node:grand_junction") ?? 4.5),
      ),
      hikeQuality: 3,
      heatRisk: 2,
      anchorRisk: 1,
    },
    cutIfBehind: "Skip Bryce rim; Zion → straight to GJ",
    recommended: hikeFirst,
  };

  const twoBryce: PlanOption = {
    id: "opt:1zion-2bryce",
    title: "1 Zion + 2 Bryce",
    summary:
      "One solid Zion morning, then cooler Bryce nights. Better heat management; slightly less canyon hiking.",
    nights: [
      {
        date: zion1,
        place: "Zion",
        kind: "park",
        role: "play",
        lat: SEED_NODES["node:zion"]!.lat,
        lng: SEED_NODES["node:zion"]!.lng,
      },
      {
        date: zion2,
        place: "Bryce Canyon",
        kind: "park",
        role: "play",
        lat: SEED_NODES["node:bryce"]!.lat,
        lng: SEED_NODES["node:bryce"]!.lng,
      },
      {
        date: bryceDay,
        place: "Bryce Canyon",
        kind: "park",
        role: "play",
        lat: SEED_NODES["node:bryce"]!.lat,
        lng: SEED_NODES["node:bryce"]!.lng,
      },
      {
        date: gjAlt,
        place: "Grand Junction",
        kind: "hotel",
        role: "transit",
        lat: SEED_NODES["node:grand_junction"]!.lat,
        lng: SEED_NODES["node:grand_junction"]!.lng,
      },
    ],
    costs: {
      totalDriveHours:
        (legHours(world, "node:yosemite_valley", "node:zion") ?? 9.5) +
        (legHours(world, "node:zion", "node:bryce") ?? 1.8) +
        (legHours(world, "node:bryce", "node:grand_junction") ?? 4.5),
      maxDayDriveHours: legHours(world, "node:yosemite_valley", "node:zion") ?? 9.5,
      hikeQuality: 2,
      heatRisk: 1,
      anchorRisk: 1,
    },
    cutIfBehind: "Drop second Bryce night; Bryce morning → GJ",
    recommended: !hikeFirst,
  };

  const bryceDenverSameDay: PlanOption = {
    id: "opt:bryce-denver-same-day",
    title: "Avoid: Bryce overnight then Denver",
    summary: `Bryce → Denver is ~${legHours(world, "node:bryce", "node:denver") ?? 9.3}h wheel time. Do not overnight Bryce if Denver is the same calendar push — stage GJ instead.`,
    nights: [
      {
        date: gj,
        place: "Grand Junction",
        kind: "hotel",
        role: "transit",
        lat: SEED_NODES["node:grand_junction"]!.lat,
        lng: SEED_NODES["node:grand_junction"]!.lng,
      },
    ],
    costs: {
      totalDriveHours: legHours(world, "node:bryce", "node:denver") ?? 9.3,
      maxDayDriveHours: legHours(world, "node:bryce", "node:denver") ?? 9.3,
      hikeQuality: 1,
      heatRisk: 1,
      anchorRisk: 3,
    },
    cutIfBehind: "Always stage GJ or further east before Denver",
    recommended: false,
  };

  return hikeFirst
    ? [zionBryceGj, twoBryce, bryceDenverSameDay]
    : [twoBryce, zionBryceGj, bryceDenverSameDay];
}

function stagingTonight(world: CopilotWorld, today: string): PlanOption[] {
  const ta = world.pois.find((p) => p.id === "seed:tracy_ta");
  const costco = world.pois.find((p) => p.id === "costco:tracy");
  const grove = world.pois.find((p) => p.id === "seed:groveland_stage");

  const tracy: PlanOption = {
    id: "opt:stage-tracy",
    title: "Stage Tracy truck stop",
    summary: `Laundry + overnight near Tracy${costco ? "; fuel at Costco Tracy first" : ""}. Then 120 toward Yosemite tomorrow — not Tahoe-first from the Bay.`,
    nights: [
      {
        date: today,
        place: ta?.name ?? "Tracy truck stop",
        kind: "truck_stop",
        role: "stage",
        lat: ta?.lat,
        lng: ta?.lng,
      },
    ],
    costs: {
      totalDriveHours: legHours(world, "node:bay_area", "node:tracy") ?? 1.2,
      maxDayDriveHours: legHours(world, "node:bay_area", "node:tracy") ?? 1.2,
      hikeQuality: 0,
      heatRisk: 1,
      anchorRisk: 0,
    },
    cutIfBehind: "Any valley truck stop with showers/laundry",
    recommended: true,
  };

  const groveland: PlanOption = {
    id: "opt:stage-groveland",
    title: "Push to Groveland / Buck Meadows",
    summary:
      "If you still have daylight and energy: stage on 120 for a shorter park morning. Skip if late or laundry is the priority.",
    nights: [
      {
        date: today,
        place: grove?.name ?? "Groveland stage",
        kind: "camp",
        role: "stage",
        lat: grove?.lat,
        lng: grove?.lng,
      },
    ],
    costs: {
      totalDriveHours:
        (legHours(world, "node:bay_area", "node:tracy") ?? 1.2) +
        (legHours(world, "node:tracy", "node:groveland") ?? 1.8),
      maxDayDriveHours:
        (legHours(world, "node:bay_area", "node:tracy") ?? 1.2) +
        (legHours(world, "node:tracy", "node:groveland") ?? 1.8),
      hikeQuality: 0,
      heatRisk: 1,
      anchorRisk: 0,
    },
    cutIfBehind: "Stop Tracy; don't arrive gate at midnight",
    recommended: false,
  };

  return [tracy, groveland];
}

function driveFact(
  world: CopilotWorld,
  message: string,
): { reply: string; facts: string[] } {
  const m = message.toLowerCase();
  const pairs: Array<[string, string, string, string]> = [
    ["bryce", "denver", "node:bryce", "node:denver"],
    ["zion", "bryce", "node:zion", "node:bryce"],
    ["yosemite", "zion", "node:yosemite_valley", "node:zion"],
    ["grand junction", "denver", "node:grand_junction", "node:denver"],
    ["gj", "denver", "node:grand_junction", "node:denver"],
    ["denver", "omaha", "node:denver", "node:omaha"],
    ["omaha", "lake forest", "node:omaha", "node:lake_forest"],
    ["bay", "tracy", "node:bay_area", "node:tracy"],
  ];

  for (const [a, b, from, to] of pairs) {
    if (m.includes(a) && m.includes(b)) {
      const h = legHours(world, from, to);
      if (h != null) {
        const fromLabel = SEED_NODES[from]?.label ?? from;
        const toLabel = SEED_NODES[to]?.label ?? to;
        return {
          reply: `${fromLabel} → ${toLabel} is about **${h} hours** van wheel time (seed leg table). Add stops/food — plan a full day if ≥8h. Numbers from tools, not a guess.`,
          facts: [`${fromLabel}→${toLabel}: ${h}h`],
        };
      }
    }
  }

  return {
    reply:
      "Ask about a known leg (e.g. Bryce→Denver, Yosemite→Zion, Zion→Bryce, GJ→Denver). I answer from the local leg table.",
    facts: [],
  };
}

function costcoList(world: CopilotWorld): string {
  const list = world.pois
    .filter((p) => p.isCostco)
    .map((p) => p.name)
    .join("; ");
  return list || "No Costco seeds loaded.";
}

/**
 * Main entry: pure co-pilot turn.
 */
export function steerCopilot(input: CopilotSteerInput): CopilotSteerResult {
  const world = input.world ?? defaultSeedWorld();
  const today = todayIso(input.today);
  const message = input.message.trim();
  const moveType = classify(message);
  const denver = world.brief.anchors?.find((a) =>
    /denver/i.test(a.title),
  );

  const baseChrome = {
    nextAnchorTitle: denver?.title,
    nextAnchorDate: denver?.date,
  };

  if (!message) {
    return {
      reply: "Say what changed — camp tonight, Utah split, drive times, laundry…",
      moveType: "general",
      options: [],
      chrome: baseChrome,
      sources: ["rules"],
    };
  }

  if (moveType === "question") {
    const { reply, facts } = driveFact(world, message);
    return {
      reply,
      moveType,
      options: [],
      chrome: { ...baseChrome, facts },
      sources: ["rules", "tools"],
    };
  }

  if (moveType === "service_need" || /costco|laundry|truck/.test(message.toLowerCase())) {
    if (/costco/.test(message.toLowerCase()) && !/tonight|camp|sleep|laundry/.test(message.toLowerCase())) {
      return {
        reply: `Along Bay → Yosemite (seed): ${costcoList(world)}. Last smart fuel is usually **Tracy** before 120.`,
        moveType: "service_need",
        options: [],
        chrome: {
          ...baseChrome,
          facts: world.pois
            .filter((p) => p.isCostco)
            .map((p) => p.name),
        },
        sources: ["rules", "tools"],
      };
    }

    const options = stagingTonight(world, today);
    const rec = options.find((o) => o.recommended) ?? options[0]!;
    return {
      reply:
        "From the Bay, stage in the **valley/foothills** — not Tahoe. Laundry points at a **Tracy truck stop**; fuel at **Costco Tracy** when you can. Options:",
      moveType: "service_need",
      options,
      recommendedOptionId: rec.id,
      chrome: {
        ...baseChrome,
        tonightPlace: rec.nights[0]?.place,
        tonightKind: rec.nights[0]?.kind,
        facts: [
          `Costcos: ${costcoList(world)}`,
          `Bay→Tracy ~${legHours(world, "node:bay_area", "node:tracy") ?? 1.2}h`,
        ],
      },
      sources: ["rules", "tools"],
    };
  }

  if (moveType === "ask_options" || moveType === "preference") {
    const hikeFirst = prefersHike(message, world);
    const options = utahOptions(today, world, hikeFirst);
    const rec = options.find((o) => o.recommended) ?? options[0]!;
    const bryceDenver = legHours(world, "node:bryce", "node:denver");
    return {
      reply: hikeFirst
        ? `Preferring **hike** → lean **2 Zion**, Bryce as a **morning only**, sleep **Grand Junction** (not Bryce overnight). Bryce→Denver is ~${bryceDenver ?? 9.3}h — too long after a full park day.`
        : `Preferring **heat/comfort** → more **Bryce** nights are cooler. Still avoid Bryce+Denver same night push (~${bryceDenver ?? 9.3}h).`,
      moveType,
      options,
      recommendedOptionId: rec.id,
      chrome: {
        ...baseChrome,
        facts: [
          `Bryce→Denver ~${bryceDenver ?? 9.3}h`,
          `Zion→Bryce ~${legHours(world, "node:zion", "node:bryce") ?? 1.8}h`,
          denver
            ? `Anchor: ${denver.title} ${denver.date}`
            : "No Denver anchor in brief",
        ],
      },
      sources: ["rules", "tools"],
    };
  }

  if (moveType === "frame") {
    const options = stagingTonight(world, today);
    const rec = options.find((o) => o.recommended) ?? options[0]!;
    const yos = legHours(world, "node:bay_area", "node:yosemite_valley");
    return {
      reply: `Bay → Yosemite is ~${yos ?? 4}h. **Tonight:** stage Tracy (laundry) or push Groveland if early. **Not Tahoe first.** Then Yosemite play nights, then Utah (2 Zion + Bryce day → GJ is the default dogfood).`,
      moveType,
      options,
      recommendedOptionId: rec.id,
      chrome: {
        ...baseChrome,
        tonightPlace: rec.nights[0]?.place,
        tonightKind: rec.nights[0]?.kind,
        facts: [
          `Bay→Yosemite ~${yos ?? 4}h`,
          `Yosemite→Zion ~${legHours(world, "node:yosemite_valley", "node:zion") ?? 9.5}h`,
        ],
      },
      sources: ["rules", "tools"],
    };
  }

  // general
  return {
    reply:
      "I'm the trip co-pilot. Try: **camp tonight from the Bay**, **laundry near Tracy**, **Costcos along the way**, **2 Zion or 2 Bryce**, **how long is Bryce to Denver**.",
    moveType: "general",
    options: [],
    chrome: baseChrome,
    sources: ["rules"],
  };
}
