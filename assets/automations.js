"use strict";
/* Automation Hub (v2.12.0) — pure reminder logic. Nothing here sends, posts
   or spends: it only computes what is due from dates the app already stores.
   Storage helpers take a storage object so tests can pass a fake. */
const RECORD_KEY = "seoforge.automations.v1";
function emptyRecord(){ return { lastRuns: {}, dismissed: {} }; }
function parseDate(s){
  if(typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s.slice(0, 10) + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}
function toISODate(d){ return d.toISOString().slice(0, 10); }
function addDays(iso, days){
  const d = parseDate(iso);
  if(!d) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}
function todayStr(now){
  const d = now instanceof Date ? now : new Date();
  return toISODate(d);
}
/* nextDue: explicit nextDue wins; otherwise lastRun + intervalDays; a never-run
   item has no due date yet and counts as due. */
function nextDueDate(item){
  if(!item) return null;
  if(item.nextDue) return parseDate(item.nextDue) ? item.nextDue.slice(0, 10) : null;
  if(item.lastRun && item.intervalDays != null) return addDays(item.lastRun, Number(item.intervalDays));
  return null;
}
/* status: "ok" (not yet due), "due" (due today, or never run), "overdue"
   (due date has passed). Returns {status, nextDue}. */
function computeStatus(item, today){
  const t = today || todayStr();
  const nextDue = nextDueDate(item || {});
  if(!nextDue) return { status: "due", nextDue: null };
  if(t > nextDue) return { status: "overdue", nextDue };
  if(t === nextDue) return { status: "due", nextDue };
  return { status: "ok", nextDue };
}
const STATUS_ORDER = { overdue: 0, due: 1, ok: 2 };
function sortItems(items, today){
  const t = today || todayStr();
  return (items || []).slice().sort((a, b) => {
    const sa = computeStatus(a, t), sb = computeStatus(b, t);
    if(STATUS_ORDER[sa.status] !== STATUS_ORDER[sb.status]) return STATUS_ORDER[sa.status] - STATUS_ORDER[sb.status];
    if(!sa.nextDue && !sb.nextDue) return 0;
    if(!sa.nextDue) return -1;
    if(!sb.nextDue) return 1;
    return sa.nextDue < sb.nextDue ? -1 : sa.nextDue > sb.nextDue ? 1 : 0;
  });
}
function loadRecord(storage){
  try{
    if(!storage || typeof storage.getItem !== "function") return emptyRecord();
    const raw = storage.getItem(RECORD_KEY);
    if(!raw) return emptyRecord();
    const rec = JSON.parse(raw);
    if(!rec || typeof rec !== "object") return emptyRecord();
    return { lastRuns: rec.lastRuns && typeof rec.lastRuns === "object" ? rec.lastRuns : {},
      dismissed: rec.dismissed && typeof rec.dismissed === "object" ? rec.dismissed : {} };
  }catch(e){ return emptyRecord(); }
}
function saveRecord(storage, record){
  try{
    if(!storage || typeof storage.setItem !== "function") return false;
    storage.setItem(RECORD_KEY, JSON.stringify(record || emptyRecord()));
    return true;
  }catch(e){ return false; }
}
function markDone(storage, id, date){
  const rec = loadRecord(storage);
  rec.lastRuns[id] = date || todayStr();
  delete rec.dismissed[id];
  saveRecord(storage, rec);
  return rec;
}
function dismiss(storage, id, date){
  const rec = loadRecord(storage);
  rec.dismissed[id] = date || todayStr();
  saveRecord(storage, rec);
  return rec;
}
function isDismissed(record, id){
  return !!(record && record.dismissed && record.dismissed[id]);
}
/* Latest rank-check date across keywords[].checks[].date (the Rank Tracker
   stores checks inside each keyword; see app.js loadCloudData). */
function lastRankCheckDate(keywords){
  let latest = null;
  (keywords || []).forEach(k => {
    (k.checks || []).forEach(c => {
      const d = typeof c === "string" ? c : c.date;
      if(typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) && (!latest || d > latest)) latest = d.slice(0, 10);
    });
  });
  return latest;
}
/* Latest audit date. Health checks save as audit records (app.js runHealth
   stores {date, url, ...} in the audits list), so the newest audit date is
   the newest health-check date the app has. */
function lastHealthCheckDate(audits){
  let latest = null;
  (audits || []).forEach(a => {
    const d = a && a.date;
    if(typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) && (!latest || d > latest)) latest = d.slice(0, 10);
  });
  return latest;
}
function isDraftDue(draft, today){
  if(!draft || !draft.due) return false;
  const due = parseDate(draft.due);
  return !!due && (today || todayStr()) >= draft.due.slice(0, 10);
}
/* One automation item per Studio draft that has a review (due) date.
   A draft the user marked done gets its next review 7 days after that mark;
   otherwise the draft's own due date is the next due date. Drafts without a
   due date, and drafts already dismissed, are left out. */
function draftsToItems(drafts, record, today){
  const rec = record || emptyRecord();
  return (drafts || []).filter(d => d && d.due && !isDismissed(rec, "draft:" + d.id)).map(d => {
    const id = "draft:" + d.id;
    const doneOn = rec.lastRuns[id];
    const lastRun = doneOn || (d.updatedAt ? String(d.updatedAt).slice(0, 10) : null);
    return {
      id, kind: "draft",
      title: "Review draft: " + (d.title || "Untitled draft"),
      lastRun,
      nextDue: doneOn ? addDays(doneOn, 7) : String(d.due).slice(0, 10),
      targetTab: "studio",
      detail: (d.status ? String(d.status) + " · " : "") + "review date " + String(d.due).slice(0, 10)
    };
  });
}
function rankItem(keywords, record){
  const lastRun = lastRankCheckDate(keywords);
  const doneOn = record && record.lastRuns ? record.lastRuns["rank-recheck"] : null;
  const effective = doneOn && (!lastRun || doneOn > lastRun) ? doneOn : lastRun;
  return { id: "rank-recheck", kind: "rank", title: "Weekly rank re-check",
    lastRun: effective, intervalDays: 7, targetTab: "rank",
    detail: "Re-check tracked keywords in the Rank Tracker" };
}
function healthItem(audits, record){
  const lastRun = lastHealthCheckDate(audits);
  const doneOn = record && record.lastRuns ? record.lastRuns["health-recheck"] : null;
  const effective = doneOn && (!lastRun || doneOn > lastRun) ? doneOn : lastRun;
  return { id: "health-recheck", kind: "health", title: "Site-health re-check",
    lastRun: effective, intervalDays: 7, targetTab: "health",
    detail: "Re-run the Health Check on your site" };
}
/* All reminder rows for the tab, overdue first. Dismissed one-off rows
   (rank/health) are left out until marked done again. */
function buildReminderItems(data, record, today){
  const rec = record || emptyRecord();
  const items = [];
  items.push.apply(items, draftsToItems(data.drafts, rec, today));
  if(!isDismissed(rec, "rank-recheck")) items.push(rankItem(data.keywords, rec));
  if(!isDismissed(rec, "health-recheck")) items.push(healthItem(data.audits, rec));
  return sortItems(items, today);
}
const automationsApi = { RECORD_KEY, emptyRecord, parseDate, addDays, todayStr, nextDueDate,
  computeStatus, sortItems, loadRecord, saveRecord, markDone, dismiss, isDismissed,
  lastRankCheckDate, lastHealthCheckDate, isDraftDue, draftsToItems, rankItem,
  healthItem, buildReminderItems };
if(typeof module !== "undefined") module.exports = automationsApi;
if(typeof window !== "undefined") window.SeoforgeAutomations = automationsApi;
