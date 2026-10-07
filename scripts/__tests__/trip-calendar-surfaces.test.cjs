const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const revision = process.env.SORTEY_CALENDAR_SOURCE_REVISION;
const corpus = JSON.parse(
  readFileSync(
    path.join(__dirname, "fixtures/trip-calendar-corpus.json"),
    "utf8",
  ),
);
function read(file) {
  return revision
    ? execFileSync(
        "jj",
        ["file", "show", "-r", revision, `root-file:${JSON.stringify(file)}`],
        { cwd: root, encoding: "utf8" },
      )
    : readFileSync(path.join(root, file), "utf8");
}
function source(file) {
  return ts.createSourceFile(
    file,
    read(file),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
function find(tree, predicate) {
  let result;
  function visit(node) {
    if (result) return;
    if (predicate(node)) result = node;
    else ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(result, "Expected actual source expression");
  return result;
}
function variable(tree, name) {
  return find(
    tree,
    (node) =>
      ts.isVariableDeclaration(node) && node.name.getText(tree) === name,
  ).initializer;
}
function evaluate(node, tree, context) {
  const js = ts.transpileModule(
    `(${node.getText(tree).replace(/^export\s+/, "")})`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return vm.runInNewContext(js, context);
}
const calendar = {};
vm.runInNewContext(
  ts.transpileModule(read("packages/validators/src/trip-day.ts"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText,
  { exports: calendar },
);
const instant = "2026-10-07T06:48:00Z";
const contexts = [
  [instant, "America/Los_Angeles", "2026-10-06"],
  ["2026-10-07T07:00:00Z", "America/Los_Angeles", "2026-10-07"],
  ["2026-10-06T16:00:00Z", "Asia/Tokyo", "2026-10-07"],
  ["2027-01-01T00:30:00Z", "America/Los_Angeles", "2026-12-31"],
  [instant, "Review/Invalid", "2026-10-07"],
];
function clock(at) {
  return class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [at]));
    }
    static now() {
      return new Date(at).getTime();
    }
  };
}
function context(at) {
  return {
    Date: clock(at),
    useTripCalendarDay: (tz) =>
      tz === undefined ? null : calendar.tripCalendarDay(new Date(at), tz),
    useMemo: (fn) => fn(),
  };
}

test("actual road preview selects the captured trip-local day at timezone boundaries", () => {
  const tree = source("apps/expo/src/components/trip/road-trip-detail.tsx");
  for (const [at, tz, expected] of contexts) {
    const scope = {
      ...context(at),
      trip: { ...corpus.trip, tz },
      planDays: corpus.days,
    };
    const selected = evaluate(variable(tree, "todayStr"), tree, scope);
    assert.equal(selected, expected);
    if (at === instant && tz === corpus.trip.tz) {
      scope.todayStr = selected;
      const preview = evaluate(variable(tree, "upcomingDay"), tree, scope);
      assert.equal(preview.date, corpus.today.date);
      assert.equal(preview.title, corpus.today.title);
    }
  }
});

test("actual Day Plan upcoming filter retains today's captured LA plan", () => {
  const tree = source("apps/expo/src/app/trip/[tripId]/day-plan.tsx");
  const scope = {
    ...context(instant),
    trip: corpus.trip,
    days: corpus.days,
    filter: "upcoming",
  };
  if (revision) {
    const todayUtc = find(
      tree,
      (node) => ts.isFunctionDeclaration(node) && node.name.text === "todayUtc",
    );
    scope.todayUtc = evaluate(todayUtc, tree, scope);
  }
  scope.today = evaluate(variable(tree, "today"), tree, scope);
  scope.dayList = evaluate(variable(tree, "dayList"), tree, scope);
  const days = evaluate(variable(tree, "filtered"), tree, scope);
  assert.equal(days[0].date, corpus.today.date);
  assert.equal(days.length, 2);
});

test("actual Drive Today request lets the scoped server select the day", () => {
  const tree = source("apps/expo/src/app/trip/[tripId]/drive.tsx");
  const calls = [];
  const scope = {
    ...context(instant),
    today: "2026-10-07",
    workspaceId: "reserved-workspace",
    tripId: "reserved-trip",
    trpc: {
      planner: {
        todayCommand: {
          queryOptions: (input, options) => ({ input, options }),
        },
      },
    },
    useQuery: (options) => {
      calls.push(options);
      return { data: corpus.today };
    },
  };
  const query = find(
    tree,
    (node) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === "{ data: todayCmd }",
  ).initializer;
  evaluate(query, tree, scope);
  assert.equal(Object.hasOwn(calls[0].input, "date"), false);
  assert.equal(calls[0].options.refetchInterval, 60_000);
  assert.equal(
    evaluate(variable(tree, "today"), tree, { todayCmd: corpus.today }),
    corpus.today.date,
  );
});

test("actual next-anchor route uses stored trip timezone for countdown and position", async () => {
  const tree = source("packages/api/src/router/anchors.ts");
  const next = find(
    tree,
    (node) =>
      ts.isPropertyAssignment(node) && node.name.getText(tree) === "next",
  );
  const callback = next.initializer.arguments[0];
  for (const [at, tz, expected] of contexts) {
    let currentDay;
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ tz }] }) }),
      }),
    };
    const fn = evaluate(callback, tree, {
      ...context(at),
      ...calendar,
      trips: { tz: "tz", id: "id" },
      eq: () => "scoped",
      currentPoint: async (_db, _tripId, day) => {
        currentDay = day;
        return null;
      },
      computeNextAnchor: async (_db, input) => input,
    });
    const result = await fn({ ctx: { db, tripId: "reserved-trip" } });
    assert.equal(result.today, expected);
    assert.equal(currentDay, expected);
  }
});

if (!revision)
  test("actual calendar hook refreshes at midnight and resume, and releases listeners", () => {
    const tree = source("apps/expo/src/utils/use-trip-calendar-day.ts");
    const fn = find(
      tree,
      (node) =>
        ts.isFunctionDeclaration(node) &&
        node.name.text === "useTripCalendarDay",
    );
    let at = instant;
    let state;
    let interval;
    let listener;
    let cleanup;
    let removed = false;
    let cleared = false;
    const scope = {
      ...calendar,
      Date: class Clock extends Date {
        static now() {
          return new Date(at).getTime();
        }
      },
      useState: (initial) => {
        state ??= initial();
        return [
          state,
          (value) => {
            state = value;
          },
        ];
      },
      useEffect: (effect) => {
        cleanup ??= effect();
      },
      setInterval: (callback) => {
        interval = callback;
        return 1;
      },
      clearInterval: () => {
        cleared = true;
      },
      AppState: {
        addEventListener: (_event, callback) => {
          listener = callback;
          return {
            remove: () => {
              removed = true;
            },
          };
        },
      },
    };
    const render = evaluate(fn, tree, scope);
    assert.equal(render(undefined), null);
    assert.equal(render(corpus.trip.tz), "2026-10-06");
    at = "2026-10-07T07:00:00Z";
    interval();
    assert.equal(render(corpus.trip.tz), "2026-10-07");
    at = "2026-10-08T07:00:00Z";
    listener("background");
    assert.equal(render(corpus.trip.tz), "2026-10-07");
    listener("active");
    assert.equal(render(corpus.trip.tz), "2026-10-08");
    cleanup();
    assert.equal(removed, true);
    assert.equal(cleared, true);
  });
