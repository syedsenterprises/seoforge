const test = require("node:test");
const assert = require("node:assert/strict");
const au = require("../assets/automations.js");

function fakeStorage(initial){
  const data = new Map(Object.entries(initial || {}));
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k)
  };
}
const throwingStorage = {
  getItem(){ throw new Error("denied"); },
  setItem(){ throw new Error("denied"); }
};

test("due / overdue computation, including never run", () => {
  assert.equal(au.computeStatus({ lastRun: "2026-11-20", intervalDays: 7 }, "2026-11-26").status, "ok");
  assert.equal(au.computeStatus({ lastRun: "2026-11-20", intervalDays: 7 }, "2026-11-27").status, "due");
  assert.equal(au.computeStatus({ lastRun: "2026-11-20", intervalDays: 7 }, "2026-11-28").status, "overdue");
  assert.equal(au.computeStatus({ lastRun: null, intervalDays: 7 }, "2026-11-28").status, "due");
  assert.equal(au.computeStatus({}, "2026-11-28").status, "due");
  assert.equal(au.computeStatus({ nextDue: "2026-11-28" }, "2026-11-28").status, "due");
  assert.equal(au.computeStatus({ nextDue: "2026-11-27" }, "2026-11-28").status, "overdue");
  assert.equal(au.computeStatus({ nextDue: "2026-11-29" }, "2026-11-28").status, "ok");
});

test("next-due arithmetic across month boundaries", () => {
  assert.equal(au.nextDueDate({ lastRun: "2026-11-27", intervalDays: 7 }), "2026-12-04");
  assert.equal(au.nextDueDate({ lastRun: "2026-01-30", intervalDays: 7 }), "2026-02-06");
  assert.equal(au.nextDueDate({ lastRun: null, intervalDays: 7 }), null);
  assert.equal(au.nextDueDate({ nextDue: "2026-12-01" }), "2026-12-01");
  assert.equal(au.addDays("2026-12-31", 1), "2027-01-01");
});

test("overdue-first sorting", () => {
  const items = [
    { id: "ok", lastRun: "2026-11-27", intervalDays: 7 },
    { id: "overdue", lastRun: "2026-11-10", intervalDays: 7 },
    { id: "due", lastRun: null, intervalDays: 7 },
    { id: "overdue-older", lastRun: "2026-11-01", intervalDays: 7 }
  ];
  assert.deepEqual(au.sortItems(items, "2026-11-28").map(i => i.id),
    ["overdue-older", "overdue", "due", "ok"]);
});

test("storage helpers round-trip and survive disabled storage", () => {
  const s = fakeStorage();
  assert.deepEqual(au.loadRecord(s), { lastRuns: {}, dismissed: {} });
  au.markDone(s, "rank-recheck", "2026-11-28");
  assert.equal(au.loadRecord(s).lastRuns["rank-recheck"], "2026-11-28");
  au.dismiss(s, "health-recheck", "2026-11-28");
  assert.equal(au.loadRecord(s).dismissed["health-recheck"], "2026-11-28");
  assert.equal(au.isDismissed(au.loadRecord(s), "health-recheck"), true);
  assert.equal(au.isDismissed(au.loadRecord(s), "rank-recheck"), false);
  // Marking done clears a dismissal for the same id.
  au.markDone(s, "health-recheck", "2026-11-28");
  assert.equal(au.isDismissed(au.loadRecord(s), "health-recheck"), false);
  // Corrupt JSON and throwing storage both fall back to an empty record.
  assert.deepEqual(au.loadRecord(fakeStorage({ [au.RECORD_KEY]: "{nope" })), { lastRuns: {}, dismissed: {} });
  assert.deepEqual(au.loadRecord(throwingStorage), { lastRuns: {}, dismissed: {} });
  assert.equal(au.saveRecord(throwingStorage, au.emptyRecord()), false);
  assert.equal(au.saveRecord(null, au.emptyRecord()), false);
  assert.deepEqual(au.loadRecord(null), { lastRuns: {}, dismissed: {} });
});

test("last rank check is the newest check date across keywords", () => {
  const kws = [
    { keyword: "a", checks: [{ date: "2026-11-10", position: 3 }, { date: "2026-11-20", position: 2 }] },
    { keyword: "b", checks: [{ date: "2026-11-25", position: 5 }] },
    { keyword: "c", checks: [] }
  ];
  assert.equal(au.lastRankCheckDate(kws), "2026-11-25");
  assert.equal(au.lastRankCheckDate([]), null);
  assert.equal(au.lastRankCheckDate(null), null);
});

test("last health check is the newest audit date", () => {
  assert.equal(au.lastHealthCheckDate([{ date: "2026-11-01" }, { date: "2026-11-22" }]), "2026-11-22");
  assert.equal(au.lastHealthCheckDate([]), null);
});

test("draft items use the draft due date, then 7 days after mark-done", () => {
  const drafts = [{ id: "d1", title: "Post", updatedAt: "2026-11-20", due: "2026-11-25", status: "draft" }];
  const items = au.draftsToItems(drafts, au.emptyRecord(), "2026-11-28");
  assert.equal(items.length, 1);
  assert.equal(items[0].nextDue, "2026-11-25");
  assert.equal(au.computeStatus(items[0], "2026-11-28").status, "overdue");
  const rec = au.markDone(fakeStorage(), "draft:d1", "2026-11-28");
  const after = au.draftsToItems(drafts, rec, "2026-11-28");
  assert.equal(after[0].nextDue, "2026-12-05");
  assert.equal(au.computeStatus(after[0], "2026-11-28").status, "ok");
  // Drafts without a due date never become reminders.
  assert.deepEqual(au.draftsToItems([{ id: "d2", title: "No date" }], au.emptyRecord()), []);
});

test("buildReminderItems combines drafts, rank and health, overdue first", () => {
  const data = {
    drafts: [{ id: "d1", title: "Old draft", updatedAt: "2026-11-01", due: "2026-11-10" }],
    keywords: [{ keyword: "a", checks: [{ date: "2026-11-27", position: 1 }] }],
    audits: [{ date: "2026-11-01" }]
  };
  const items = au.buildReminderItems(data, au.emptyRecord(), "2026-11-28");
  // Both overdue, earliest next-due first: health (due 8 Nov) before draft (due 10 Nov).
  assert.deepEqual(items.map(i => i.id), ["health-recheck", "draft:d1", "rank-recheck"]);
  assert.equal(au.computeStatus(items[0], "2026-11-28").status, "overdue");
  assert.equal(au.computeStatus(items[2], "2026-11-28").status, "ok");
  // Dismissed rows are left out.
  const rec = au.dismiss(fakeStorage(), "health-recheck", "2026-11-28");
  assert.ok(!au.buildReminderItems(data, rec, "2026-11-28").some(i => i.id === "health-recheck"));
});
