// node scripts/check-convos.mjs: Cupid display-string parsing, month windows and source mapping.
import assert from "node:assert/strict";
import {appOfSource, cupidCount, cupidIds, cupidMetrics, formatCupidIds, monthDays, monthRange, sourceBucket, toCsv, shiftMonth, forecast, convoCost, CONVO_PRICE} from "../lib/convos.ts";

assert.equal(cupidCount("1,234"), 1234);
assert.equal(cupidCount("900 (72.93% of 1,234)"), 900);
assert.equal(cupidCount("-"), null);
assert.equal(cupidCount(undefined), null);
const f = cupidMetrics([
  {name: "Conversations raw", values: ["1,234"]}, {name: "Conversations charged", values: ["900 (72.93% of 1,234)"]},
  {name: "Shared CTA link", values: ["500 (55.56% of 900)"]}, {name: "Conversions", values: ["50 (5.56% of 900)"]},
  {name: "Conversions from CTA link shared", values: ["-"]},
]);
assert.deepEqual(f, {raw: 1234, charged: 900, ctaStarted: null, ctaShared: 500, ctaConversions: null, conversions: 50});
assert.deepEqual(monthRange("2026-10"), {start: "2026-10-01", last: "2026-10-31", next: "2026-11-01"});
assert.deepEqual(monthRange("2026-12"), {start: "2026-12-01", last: "2026-12-31", next: "2027-01-01"});
assert.deepEqual(monthRange("2028-02").last, "2028-02-29");
assert.equal(shiftMonth("2026-01", -1), "2025-12");
assert.equal(shiftMonth("2026-12", 1), "2027-01");
assert.equal(appOfSource("Twitter"), "x");
assert.equal(appOfSource("IG"), "instagram");
assert.equal(appOfSource("Discord"), "discord");
assert.equal(appOfSource("untracked"), null);
assert.deepEqual(cupidIds("2290730"), {x: "2290730"});
assert.deepEqual(cupidIds("x:2290730, discord:2290729"), {x: "2290730", discord: "2290729"});
assert.deepEqual(cupidIds("bogus:1,discord:"), {});
assert.equal(formatCupidIds({discord: "2290729", x: "2290730"}), "x:2290730,discord:2290729");
assert.deepEqual(monthDays("2026-10", "2026-10-03"), ["2026-10-01", "2026-10-02", "2026-10-03"]);
assert.equal(monthDays("2026-09", "2026-10-03").length, 30);
assert.equal(monthDays("2026-11", "2026-10-03").length, 0);
assert.equal(sourceBucket("twitter"), "x");
assert.equal(sourceBucket("untracked"), "other");
assert.equal(toCsv([["a", 1, null], ['say "hi", ok', 2]]), 'a,1,\n"say ""hi"", ok",2');
// Forecast: Oct 10 today, 9 complete days of 10 (last 7 → rate 10) + a partial 3 today.
const oct = monthDays("2026-10", "2026-10-10").map((date, i) => ({date, v: i === 9 ? 3 : i < 2 ? 100 : 10}));
const fc = forecast(oct, "2026-10", "2026-10-10");
assert.equal(fc.actual, 273); assert.equal(fc.rate, 10); assert.equal(fc.basis, 7);
assert.equal(fc.month, 270 + 10 * 22); assert.equal(fc.next, 300);
// Two complete days: falls back to their mean.
const early = forecast([{date: "2026-11-01", v: 4}, {date: "2026-11-02", v: 8}, {date: "2026-11-03", v: 1}], "2026-11", "2026-11-03");
assert.equal(early.rate, 6); assert.equal(early.month, 12 + 6 * 28); assert.equal(early.next, 6 * 31);
// Day one: nothing complete, no forecast. A finished month projects to its actual.
assert.equal(forecast([{date: "2026-11-01", v: 5}], "2026-11", "2026-11-01").month, null);
assert.equal(forecast(oct, "2026-10", "2026-11-05").month, 273);
assert.equal(convoCost(100, "x"), null);
CONVO_PRICE.all = 0.5; CONVO_PRICE.x = 0.2;
assert.equal(convoCost(100, "x"), 20); assert.equal(convoCost(100, "discord"), 50); assert.equal(convoCost(null, "x"), null);
delete CONVO_PRICE.all; delete CONVO_PRICE.x;
console.log("check-convos ok");
