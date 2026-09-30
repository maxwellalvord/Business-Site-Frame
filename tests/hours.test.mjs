// Tests for the opening-hours helpers in site/js/components.js.
// Run from the project root:  node --test tests/hours.test.mjs
//
// The helpers are plain functions, so components.js is loaded into a sandbox
// with a stub `document`; no browser needed. Times are "minutes since Sunday
// 00:00", so a whole week is one number line from 0 to 10080.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site", "js", "components.js"), "utf8");
const ctx = vm.createContext({ document: { addEventListener() {} }, Intl, console });
vm.runInContext(src, ctx);
const { toMinutes, minuteOfWeekInZone, getOpenStatus, formatTime, dayLabel, validateHours } = ctx;

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
// at("fri", "19:00") -> minute of the week
const at = (day, hhmm) => DAYS.indexOf(day) * 1440 + Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const plain = (v) => JSON.parse(JSON.stringify(v)); // sandbox objects -> plain objects for deepEqual

// The sample business: weekdays 7–3, a Friday evening session that runs past
// midnight, a shorter Saturday, closed Sunday.
const SAMPLE = {
  mon: [{ open: "07:00", close: "15:00" }],
  tue: [{ open: "07:00", close: "15:00" }],
  wed: [{ open: "07:00", close: "15:00" }],
  thu: [{ open: "07:00", close: "15:00" }],
  fri: [{ open: "07:00", close: "15:00" }, { open: "18:00", close: "00:30" }],
  sat: [{ open: "08:00", close: "14:00" }],
  sun: [],
};
const status = (hours, day, hhmm) => plain(getOpenStatus(hours, at(day, hhmm)));

test("toMinutes converts 24-hour HH:MM", () => {
  assert.equal(toMinutes("00:00"), 0);
  assert.equal(toMinutes("07:30"), 450);
  assert.equal(toMinutes("23:59"), 1439);
});

test("formatTime gives 12-hour times, dropping :00", () => {
  assert.equal(formatTime(0), "12 AM");
  assert.equal(formatTime(420), "7 AM");
  assert.equal(formatTime(450), "7:30 AM");
  assert.equal(formatTime(720), "12 PM");
  assert.equal(formatTime(1439), "11:59 PM");
});

test("open during a normal range, with the closing time", () => {
  assert.deepEqual(status(SAMPLE, "wed", "10:00"), { isOpen: true, closesAt: at("wed", "15:00") });
});

test("the opening minute is open and the closing minute is closed", () => {
  assert.equal(status(SAMPLE, "mon", "07:00").isOpen, true);
  assert.deepEqual(status(SAMPLE, "mon", "15:00"), { isOpen: false, opensAt: at("tue", "07:00") });
});

test("before opening: closed, opens later today", () => {
  const s = status(SAMPLE, "mon", "06:59");
  assert.deepEqual(s, { isOpen: false, opensAt: at("mon", "07:00") });
  assert.equal(dayLabel(s.opensAt, at("mon", "06:59")), "today");
});

test("several ranges in one day: closed in the gap, open in the second range", () => {
  const gap = status(SAMPLE, "fri", "16:00");
  assert.deepEqual(gap, { isOpen: false, opensAt: at("fri", "18:00") });
  assert.equal(dayLabel(gap.opensAt, at("fri", "16:00")), "today");
  assert.deepEqual(status(SAMPLE, "fri", "19:00"), { isOpen: true, closesAt: at("sat", "00:30") });
});

test("past midnight: Friday's late range is still open early Saturday, then closes", () => {
  assert.deepEqual(status(SAMPLE, "sat", "00:15"), { isOpen: true, closesAt: at("sat", "00:30") });
  assert.deepEqual(status(SAMPLE, "sat", "00:30"), { isOpen: false, opensAt: at("sat", "08:00") });
});

test("Saturday into Sunday: a range that crosses the end of the week", () => {
  const late = { sat: [{ open: "22:00", close: "02:00" }] };
  assert.deepEqual(status(late, "sat", "23:00"), { isOpen: true, closesAt: at("sun", "02:00") });
  assert.deepEqual(status(late, "sun", "01:00"), { isOpen: true, closesAt: at("sun", "02:00") });
  const after = status(late, "sun", "02:00");
  assert.deepEqual(after, { isOpen: false, opensAt: at("sat", "22:00") });
  assert.equal(dayLabel(after.opensAt, at("sun", "02:00")), "Saturday");
});

test("next opening wraps to the next week: Saturday afternoon -> Monday", () => {
  const s = status(SAMPLE, "sat", "15:00");
  assert.deepEqual(s, { isOpen: false, opensAt: at("mon", "07:00") });
  assert.equal(dayLabel(s.opensAt, at("sat", "15:00")), "Monday");
  assert.equal(dayLabel(status(SAMPLE, "sun", "12:00").opensAt, at("sun", "12:00")), "tomorrow");
});

test("no hours at all: closed with no next opening", () => {
  assert.deepEqual(status({}, "wed", "12:00"), { isOpen: false, opensAt: null });
  const allEmpty = Object.fromEntries(DAYS.map((d) => [d, []]));
  assert.deepEqual(status(allEmpty, "wed", "12:00"), { isOpen: false, opensAt: null });
});

test("a close time equal to the open time means open for 24 hours", () => {
  const allDay = { mon: [{ open: "00:00", close: "00:00" }] };
  assert.deepEqual(status(allDay, "mon", "12:00"), { isOpen: true, closesAt: at("tue", "00:00") });
  assert.equal(status(allDay, "tue", "00:00").isOpen, false);
});

test("minuteOfWeekInZone uses the business's time zone, not the visitor's", () => {
  const instant = new Date("2026-09-30T19:00:00Z"); // a Wednesday
  assert.equal(minuteOfWeekInZone("America/Los_Angeles", instant), at("wed", "12:00"));
  assert.equal(minuteOfWeekInZone("Asia/Tokyo", instant), at("thu", "04:00"));
  assert.equal(minuteOfWeekInZone("UTC", instant), at("wed", "19:00"));
});

test("minuteOfWeekInZone reports midnight as 00:00, not 24:00", () => {
  assert.equal(minuteOfWeekInZone("America/Los_Angeles", new Date("2026-09-30T07:00:00Z")), at("wed", "00:00"));
});

// Config validation: a mistake in site-config.js is reported with where it is.
test("toMinutes rejects anything that isn't 24-hour HH:MM", () => {
  for (const bad of ["7am", "7:30", "24:00", "07:60", "0730", "", undefined, 730]) {
    assert.throws(() => toMinutes(bad), /invalid time/, `should reject ${JSON.stringify(bad)}`);
  }
});

test("validateHours accepts the sample hours", () => {
  assert.doesNotThrow(() => validateHours(SAMPLE, "America/Los_Angeles"));
  assert.doesNotThrow(() => validateHours({}, "UTC"));
});

test("validateHours reports each kind of mistake, with its location", () => {
  const cases = [
    [SAMPLE, "America/Portland", /timeZone "America\/Portland" isn't a valid IANA time zone/],
    [SAMPLE, undefined, /timeZone is missing/],
    [undefined, "UTC", /hours is missing/],
    [{ monday: [] }, "UTC", /hours\.monday: unknown day/],
    [{ mon: { open: "07:00", close: "15:00" } }, "UTC", /hours\.mon must be a list/],
    [{ mon: [{ open: "7am", close: "15:00" }] }, "UTC", /hours\.mon\[0\]\.open: invalid time "7am"/],
    [{ fri: [{ open: "07:00", close: "15:00" }, { open: "18:00" }] }, "UTC", /hours\.fri\[1\]\.close: invalid time/],
  ];
  for (const [hours, zone, message] of cases) assert.throws(() => validateHours(hours, zone), message);
});
