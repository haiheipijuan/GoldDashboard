// validate.mjs — schema gate for data.json (zero dependencies). Exits 1 on any error.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));

const errors = [];
function err(msg) { errors.push(msg); }
function isStr(v) { return typeof v === 'string' && v.length > 0; }

// ---- meta ----
if (!isStr(data.meta?.generationTime)) err('meta.generationTime missing');
if (!isStr(data.statusTagText)) err('statusTagText missing');

// ---- kpi ----
const kpi = data.kpi;
if (!kpi || !Array.isArray(kpi.cards) || kpi.cards.length !== 6) err('kpi.cards must have exactly 6 cards');
(kpi?.cards || []).forEach((c, i) => {
  if (!isStr(c.name)) err(`kpi.cards[${i}].name missing`);
  if (c.value === null || c.value === undefined || String(c.value).length === 0) err(`kpi.cards[${i}].value missing`);
  if (!isStr(c.desc)) err(`kpi.cards[${i}].desc missing`);
  if (c.pill !== null && (typeof c.pill !== 'object' || !isStr(c.pill.cls) || !isStr(c.pill.text))) err(`kpi.cards[${i}].pill invalid`);
});

// ---- chart ----
const ch = data.chart;
if (!ch || !Array.isArray(ch.labels) || !Array.isArray(ch.series)) err('chart.labels/series must be arrays');
else if (ch.labels.length !== ch.series.length) err(`chart labels(${ch.labels.length}) != series(${ch.series.length})`);
else if (ch.labels.length < 2) err('chart needs at least 2 points');
(ch?.series || []).forEach((v, i) => { if (typeof v !== 'number' || !Number.isFinite(v)) err(`chart.series[${i}] not a finite number: ${v}`); });
if (!Array.isArray(ch?.markLines)) err('chart.markLines must be an array');
(ch?.markLines || []).forEach((m, i) => {
  if (typeof m.value !== 'number' || !isStr(m.color) || !isStr(m.label)) err(`chart.markLines[${i}] invalid`);
});
if (!Array.isArray(ch?.markLines) || ch.markLines.length < 4) err('chart.markLines needs at least 4 lines');
else {
  const upperPressure = ch.markLines.filter((m) => /压力/.test(m.label));
  if (upperPressure.length < 2) err('chart.markLines must include two pressure lines labeled with 压力 (中期压力位 + 顶部/长期压力位)');
  const topLine = Math.max(...ch.markLines.map((m) => m.value));
  if (typeof ch.yMax === 'number' && ch.yMax < topLine + 20) err(`chart.yMax(${ch.yMax}) must leave room above the highest markLine(${topLine})`);
}

// ---- levels ----
if (!Array.isArray(data.levels) || data.levels.length !== 2) err('levels must have exactly 2 entries');
(data.levels || []).forEach((lv, i) => {
  if (!isStr(lv.heading)) err(`levels[${i}].heading missing`);
  if (lv.markColor !== 'red' && lv.markColor !== 'green') err(`levels[${i}].markColor must be red|green`);
  if (!Array.isArray(lv.rungs) || lv.rungs.length < 2) err(`levels[${i}].rungs too short`);
  (lv.rungs || []).forEach((r, j) => {
    if (!isStr(r.value)) err(`levels[${i}].rungs[${j}].value missing`);
    if (!isStr(r.color)) err(`levels[${i}].rungs[${j}].color missing`);
    if (!isStr(r.name)) err(`levels[${i}].rungs[${j}].name missing`);
    const hasBubble = r.bubble !== null && r.bubble !== undefined;
    const hasTag = r.tag !== null && r.tag !== undefined;
    if (hasBubble === hasTag) err(`levels[${i}].rungs[${j}] must have exactly one of bubble|tag`);
  });
});

// ---- drivers ----
if (!Array.isArray(data.drivers) || data.drivers.length !== 5) err('drivers must have exactly 5 entries');
(data.drivers || []).forEach((d, i) => {
  for (const k of ['title', 'sub', 'pillCls', 'pillText', 'body', 'dirColor', 'dirText']) {
    if (!isStr(d[k])) err(`drivers[${i}].${k} missing`);
  }
});

// ---- scenarios ----
if (!Array.isArray(data.scenarios) || data.scenarios.length !== 3) err('scenarios must have exactly 3 entries');
(data.scenarios || []).forEach((s, i) => {
  if (!['A', 'B', 'C'].includes(s.id)) err(`scenarios[${i}].id must be A|B|C`);
  for (const k of ['prob', 'name', 'cond', 'path', 'obs']) {
    if (!isStr(s[k])) err(`scenarios[${i}].${k} missing`);
  }
});

// ---- calendar ----
const cal = data.calendar;
if (!cal || !Array.isArray(cal.rows) || cal.rows.length !== 11) err('calendar.rows must have exactly 11 rows');
(cal?.rows || []).forEach((r, i) => {
  if (!isStr(r.time)) err(`calendar.rows[${i}].time missing`);
  if (!isStr(r.event)) err(`calendar.rows[${i}].event missing`);
  if (!(r.stars >= 1 && r.stars <= 5)) err(`calendar.rows[${i}].stars must be 1-5`);
  for (const k of ['prev', 'forecast', 'actual']) {
    const v = r[k];
    const ok = v === null || isStr(v) || (typeof v === 'object' && isStr(v.text));
    if (!ok) err(`calendar.rows[${i}].${k} must be null, short string, or {text,pending}`);
    else if (isStr(v) && v.length > 20) err(`calendar.rows[${i}].${k} too long (>20 chars), only number+unit like "3.7% / 3.3%" or null`);
    else if ((isStr(v) ? v : v?.text || '').match(/[；。]/)) err(`calendar.rows[${i}].${k} contains narrative punctuation (；/。), use one short value or null (details belong in timeline/scenarios)`);
  }
  if (!['bull', 'bear', 'mid', 'pend'].includes(r.impactCls)) err(`calendar.rows[${i}].impactCls must be bull|bear|mid|pend`);
  if (!isStr(r.impactText)) err(`calendar.rows[${i}].impactText missing`);
});

// ---- timeline ----
const tl = data.timeline;
if (!tl || !Array.isArray(tl.entries) || tl.entries.length !== 10) err('timeline.entries must have exactly 10 entries');
(tl?.entries || []).forEach((e, i) => {
  if (!isStr(e.label)) err(`timeline.entries[${i}].label missing`);
  if (!isStr(e.ev)) err(`timeline.entries[${i}].ev missing`);
  else if (e.ev.length > 200) err(`timeline.entries[${i}].ev too long (${e.ev.length} > 200 chars)`);
  if (!isStr(e.de)) err(`timeline.entries[${i}].de missing`);
  else if (e.de.length > 200) err(`timeline.entries[${i}].de too long (${e.de.length} > 200 chars)`);
});

// ---- checklist / risk / footer ----
if (!Array.isArray(data.checklist) || data.checklist.length !== 6) err('checklist must have exactly 6 rows');
(data.checklist || []).forEach((c, i) => {
  for (const k of ['freq', 'event', 'signal']) if (!isStr(c[k])) err(`checklist[${i}].${k} missing`);
});
if (!isStr(data.risk?.heading)) err('risk.heading missing');
if (!isStr(data.risk?.body)) err('risk.body missing');
else if (!data.risk.body.includes('不构成任何投资建议，不承诺任何价格走势')) {
  err('risk.body must keep the verbatim disclaimer phrase 不构成任何投资建议，不承诺任何价格走势');
}
if (!isStr(data.footerText)) err('footerText missing');

// ---- result ----
if (errors.length) {
  console.error(`[validate] FAILED with ${errors.length} error(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('[validate] OK — data.json schema valid');
