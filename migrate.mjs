// 一次性迁移脚本：把当前手写 index.html 的内容抽取为 data.json。
// 用法：node migrate.mjs [源文件，默认 ./index.html]
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2] || new URL('./index.html', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const html = readFileSync(src, 'utf8');

function fail(msg) { console.error('[migrate] 失败：' + msg); process.exit(1); }
function grab(pattern, text, label) {
  const m = text.match(pattern);
  if (!m) fail('未找到 ' + label);
  return m;
}
function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// Pending cells: keep informative placeholder text (e.g. "8 月值"), null for empty/--.
function pendingCell(raw) {
  const text = stripTags(raw);
  if (!text || /^[-—–/]+$/.test(text)) return null;
  return { text, pending: true };
}

// Legacy data may exceed per-field limits; truncate with an ellipsis at migration time.
function clip(s, max) {
  const t = stripTags(s);
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

// ---------- meta ----------
const gen = grab(/生成时间\s*([\d\-: ]+?)\s*<\/footer>/, html, '生成时间');
const generationTime = gen[1].trim();
const titleDate = generationTime.slice(0, 10);

// ---------- status tag ----------
const st = grab(/<div class="status-tag"><span class="dot"><\/span>([\s\S]*?)<\/div>/, html, '状态标签');
const statusTagText = stripTags(st[1]);

// ---------- 1 KPI ----------
function extractKpis() {
  const secStart = html.indexOf('<!-- ===== 1 核心指标 ===== -->');
  const secEnd = html.indexOf('<!-- ===== 2', secStart);
  if (secStart < 0 || secEnd < 0) fail('KPI 区块');
  const sec = html.slice(secStart, secEnd);
  const hint = grab(/<span class="hint">([\s\S]*?)<\/span>/, sec, 'KPI hint')[1].trim();
  const cards = [];
  const re = /<div class="kpi">\r?\n([\s\S]*?)\r?\n      <\/div>/g;
  let m;
  while ((m = re.exec(sec)) !== null) {
    const block = m[1];
    const kLine = grab(/<div class="k">([\s\S]*?)<\/div>/, block, 'kpi .k')[1].trim();
    const pillM = kLine.match(/<span class="pill ([a-z]+)">([^<]*)<\/span>/);
    const name = stripTags(kLine.replace(/<span[\s\S]*?<\/span>/, ''));
    const vLine = grab(/<div class="v(?: ([a-z]+))?"?>([\s\S]*?)<\/div>/, block, 'kpi .v');
    const dLine = grab(/<div class="d(?: ([a-z]+))?"?>([\s\S]*?)<\/div>/, block, 'kpi .d');
    cards.push({
      name,
      pill: pillM ? { cls: pillM[1], text: pillM[2] } : null,
      value: vLine[2].trim(),
      valueCls: vLine[1] || '',
      descCls: dLine[1] || '',
      desc: dLine[2].trim(),
    });
  }
  if (!cards.length) fail('KPI 卡片');
  return { hint, cards };
}

// ---------- 2 chart ----------
function extractChart() {
  const secStart = html.indexOf('<!-- ===== 2', 0);
  const secEnd = html.indexOf('<!-- ===== 3', secStart);
  const sec = html.slice(secStart, secEnd);
  const hint = grab(/<span class="hint">([\s\S]*?)<\/span>/, sec, 'chart hint')[1].trim();
  const fallback = grab(/id="chartFallback">([\s\S]*?)<\/div>/, sec, 'chartFallback')[1].trim();
  const xM = grab(/xAxis: \{ type: 'category', data: (\[[^\]]*\])/ , html, 'xAxis');
  const sM = grab(/type: 'line', data: (\[[^\]]*\])/, html, 'series data');
  const yM = grab(/yAxis: \{ type: 'value', min: ([\d.]+), max: ([\d.]+)/, html, 'yAxis range');
  function jsArrToJson(s) { return s.replace(/'/g, '"'); }
  const labels = JSON.parse(jsArrToJson(xM[1]));
  const series = JSON.parse(jsArrToJson(sM[1]));
  const marks = [];
  const mlStart = html.indexOf('markLine:');
  const mlEnd = html.indexOf('markPoint:', mlStart);
  const mlBlock = html.slice(mlStart, mlEnd);
  const mre = /\{ yAxis: ([\d.]+), lineStyle: \{ color: '([^']+)', type: 'dashed' \}, label: \{ formatter: '([^']*)' \} \}/g;
  let mm;
  while ((mm = mre.exec(mlBlock)) !== null) {
    marks.push({ value: Number(mm[1]), color: mm[2], label: mm[3] });
  }
  return { hint, fallback, labels, series, yMin: Number(yM[1]), yMax: Number(yM[2]), markLines: marks };
}

// ---------- 3 levels ----------
function extractLevels() {
  const secStart = html.indexOf('<!-- ===== 3', 0);
  const secEnd = html.indexOf('<!-- ===== 4', secStart);
  const sec = html.slice(secStart, secEnd);
  const out = [];
  const re = /<div class="lvl">([\s\S]*?)<\/div>\r?\n(?=      <\/div>|    <\/div>)/g;
  let m;
  while ((m = re.exec(sec)) !== null) {
    const block = m[1];
    const hM = grab(/<h3><span class="mark" style="background:var\(--([a-z]+)\)"><\/span>([\s\S]*?)<\/h3>/, block, 'lvl h3');
    const rungs = [];
    const rre = /<div class="rung"><span class="lv" style="color:var\(--([a-z]+)\)">([^<]*)<\/span><span class="nm">([\s\S]*?)<\/span>([\s\S]*?)<\/div>/g;
    let rm;
    while ((rm = rre.exec(block)) !== null) {
      const rest = rm[4];
      const tagM = rest.match(/<span class="tag">([^<]*)<\/span>/);
      const bubM = rest.match(/class="bubble" style="background:var\(--([a-z]+)\);width:(\d+)%"/);
      rungs.push({
        value: rm[2], color: rm[1], name: rm[3].trim(),
        tag: tagM ? tagM[1] : null,
        bubble: bubM ? { color: bubM[1], width: Number(bubM[2]) } : null,
      });
    }
    out.push({ heading: stripTags(hM[2]), markColor: hM[1], rungs });
  }
  if (out.length !== 2) fail('levels 需要 2 组，实际 ' + out.length);
  return out;
}

// ---------- 4 drivers ----------
function extractDrivers() {
  const secStart = html.indexOf('<!-- ===== 4', 0);
  const secEnd = html.indexOf('<!-- ===== 5', secStart);
  const sec = html.slice(secStart, secEnd);
  const out = [];
  const re = /<div class="drv">([\s\S]*?)\r?\n      <\/div>\r?\n(?=      <div class="drv">|    <\/div>)/g;
  let m;
  while ((m = re.exec(sec)) !== null) {
    const block = m[1];
    const tM = grab(/<div class="t">([\s\S]*?)<\/div>/, block, 'drv .t');
    const sM = grab(/<div class="s">([\s\S]*?)<\/div>/, block, 'drv .s');
    const pM = grab(/<span class="pill ([a-z]+)">([^<]*)<\/span>/, block, 'drv pill');
    const pTextM = grab(/<p>([\s\S]*?)\r?\n\s*<div class="dir"/, block, 'drv <p>');
    const dM = grab(/<div class="dir" style="color:var\(--([a-z]+)\)">([\s\S]*?)<\/div>/, block, 'drv .dir');
    out.push({
      title: stripTags(tM[1]), sub: stripTags(sM[1]),
      pillCls: pM[1], pillText: pM[2],
      body: pTextM[1].trim(),
      dirColor: dM[1], dirText: dM[2].trim(),
    });
  }
  if (!out.length) fail('drivers');
  return out;
}

// ---------- 5 scenarios ----------
function extractScenarios() {
  const secStart = html.indexOf('<!-- ===== 5', 0);
  const secEnd = html.indexOf('<!-- ===== 6', secStart);
  const sec = html.slice(secStart, secEnd);
  const out = [];
  const re = /<div class="scn" data-s="([A-Z])">([\s\S]*?)\r?\n      <\/div>/g;
  let m;
  while ((m = re.exec(sec)) !== null) {
    const block = m[2];
    out.push({
      id: m[1],
      prob: grab(/<div class="prob">([\s\S]*?)<\/div>/, block, 'scn .prob')[1].trim(),
      name: grab(/<div class="name">([\s\S]*?)<\/div>/, block, 'scn .name')[1].trim(),
      cond: grab(/<div class="cond">([\s\S]*?)<\/div>/, block, 'scn .cond')[1].trim(),
      path: grab(/<div class="path">([\s\S]*?)<\/div>/, block, 'scn .path')[1].trim(),
      obs: grab(/<div class="obs">([\s\S]*?)<\/div>/, block, 'scn .obs')[1].trim(),
    });
  }
  if (out.length !== 3) fail('scenarios 需要 3 个，实际 ' + out.length);
  return out;
}

// ---------- 6 calendar ----------
function extractCalendar() {
  const secStart = html.indexOf('<!-- ===== 6', 0);
  const secEnd = html.indexOf('<!-- ===== 7', secStart);
  const sec = html.slice(secStart, secEnd);
  const hint = grab(/<span class="hint">([\s\S]*?)<\/span>/, sec, 'cal hint')[1].trim();
  const tbodyM = grab(/<tbody>([\s\S]*?)<\/tbody>/, sec, 'cal tbody');
  const noteM = grab(/<div class="cal-note">([\s\S]*?)<\/div>/, sec, 'cal-note');
  const rowsHtml = tbodyM[1];
  const rowRe = /<tr(?: class="hl")?>([\s\S]*?)<\/tr>/g;
  const tdRe = /<td(?: class="([a-z]+)")?>([\s\S]*?)<\/td>/g;
  const rows = [];
  let rm;
  while ((rm = rowRe.exec(rowsHtml)) !== null) {
    const tds = [];
    let tm;
    tdRe.lastIndex = 0;
    while ((tm = tdRe.exec(rm[1])) !== null) tds.push({ cls: tm[1] || '', raw: tm[2].trim() });
    if (tds.length !== 7) fail('日历行需要 7 列，实际 ' + tds.length);
    const evCell = tds[1];
    const pillM = evCell.raw.match(/ <span class="pill ([a-z]+)"[^>]*>([^<]*)<\/span>\s*$/);
    const impactM = tds[6].raw.match(/<span class="tg ([a-z]+)">([^<]*)<\/span>/);
    if (!impactM) fail('日历影响标签');
    rows.push({
      hl: /class="hl"/.test(rm[0]),
      time: stripTags(tds[0].raw),
      event: pillM ? evCell.raw.replace(/ <span class="pill [\s\S]*?<\/span>\s*$/, '').trim() : evCell.raw,
      eventPill: pillM ? { cls: pillM[1], text: pillM[2] } : null,
      stars: Number((tds[2].raw.match(/★+/) || ['0'])[0].length),
      prev: tds[3].cls === 'pending' ? pendingCell(tds[3].raw) : clip(tds[3].raw, 40),
      forecast: tds[4].cls === 'pending' ? pendingCell(tds[4].raw) : clip(tds[4].raw, 40),
      actual: tds[5].cls === 'pending' ? pendingCell(tds[5].raw) : clip(tds[5].raw, 40),
      impactCls: impactM[1],
      impactText: impactM[2],
    });
  }
  if (!rows.length) fail('日历行');
  return { hint, rows, note: noteM[1].trim() };
}

// ---------- 7 timeline ----------
function extractTimeline() {
  const secStart = html.indexOf('<!-- ===== 7', 0);
  const secEnd = html.indexOf('<!-- ===== 8', secStart);
  const sec = html.slice(secStart, secEnd);
  const hint = grab(/<span class="hint">([\s\S]*?)<\/span>/, sec, 'tl hint')[1].trim();
  const out = [];
  const re = /<div class="t">([\s\S]*?)<\/div><div class="c"><span class="dot( small)?"><\/span><\/div><div class="x">\r?\n([\s\S]*?)\r?\n      <\/div>/g;
  let m;
  while ((m = re.exec(sec)) !== null) {
    const x = m[3];
    const evM = grab(/<div class="ev">([\s\S]*?)<\/div>/, x, 'tl .ev');
    const deM = grab(/<div class="de">([\s\S]*?)<\/div>/, x, 'tl .de');
    const mkM = x.match(/<div class="mk"><span class="pill ([a-z]+)">([^<]*)<\/span><\/div>/);
    out.push({
      label: stripTags(m[1]),
      small: !!m[2],
      ev: clip(evM[1], 200),
      de: clip(deM[1], 200),
      mark: mkM ? { cls: mkM[1], text: mkM[2] } : null,
    });
  }
  if (!out.length) fail('timeline');
  return { hint, entries: out };
}

// ---------- 8 checklist ----------
function extractChecklist() {
  const secStart = html.indexOf('<!-- ===== 8', 0);
  const riskStart = html.indexOf('<!-- ===== 风险提示', secStart);
  const sec = html.slice(secStart, riskStart);
  const tbodyM = grab(/<tbody>([\s\S]*?)<\/tbody>/, sec, 'checklist tbody');
  const rows = [];
  const re = /<tr><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><\/tr>/g;
  let m;
  while ((m = re.exec(tbodyM[1])) !== null) {
    rows.push({ freq: stripTags(m[1]), event: stripTags(m[2]), signal: stripTags(m[3]) });
  }
  if (!rows.length) fail('checklist');
  return rows;
}

// ---------- risk + footer ----------
function extractRisk() {
  const secStart = html.indexOf('<!-- ===== 风险提示', 0);
  const secEnd = html.indexOf('<footer>', secStart);
  const sec = html.slice(secStart, secEnd);
  return {
    heading: grab(/<h3>([\s\S]*?)<\/h3>/, sec, 'risk h3')[1].trim(),
    body: grab(/<p>([\s\S]*?)<\/p>/, sec, 'risk p')[1].trim(),
  };
}
const footerText = stripTags(grab(/<footer>([\s\S]*?)<\/footer>/, html, 'footer')[1]);

// ---------- assemble ----------
const kpi = extractKpis();
const data = {
  meta: { generationTime, titleDate },
  statusTagText,
  kpi: { hint: kpi.hint, cards: kpi.cards },
  chart: extractChart(),
  levels: extractLevels(),
  drivers: extractDrivers(),
  scenarios: extractScenarios(),
  calendar: extractCalendar(),
  timeline: extractTimeline(),
  checklist: extractChecklist(),
  risk: extractRisk(),
  footerText,
};

writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('[migrate] data.json 已生成：KPI %d 张 / 日历 %d 行 / 时间轴 %d 条 / 驱动 %d / 情景 %d',
  data.kpi.cards.length, data.calendar.rows.length, data.timeline.entries.length,
  data.drivers.length, data.scenarios.length);
