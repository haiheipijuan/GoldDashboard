// render.mjs — data.json + template.html -> index.html (zero dependencies)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));
let html = readFileSync(join(root, 'template.html'), 'utf8');

// ---- helpers -------------------------------------------------------------
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Allow a small whitelist of inline tags (used for emphasis in prose fields).
function rich(s) {
  return String(s ?? '')
    .split(/(<b>|<\/b>)/g)
    .map((part) => (part === '<b>' || part === '</b>' ? part : esc(part)))
    .join('');
}

function cls(prefix, extra) {
  return `class="${prefix}${extra ? ' ' + esc(extra) : ''}"`;
}

function stars(n) {
  const full = Math.max(0, Math.min(5, n | 0));
  return `<b>${'★'.repeat(full)}</b><i>${'☆'.repeat(5 - full)}</i>`;
}

// ---- section renderers ---------------------------------------------------
function kpiCards() {
  return data.kpi.cards.map((c) => {
    const pill = c.pill ? ` <span class="pill ${esc(c.pill.cls)}">${esc(c.pill.text)}</span>` : '';
    return [
      '      <div class="kpi">',
      `        <div class="k">${esc(c.name)}${pill}</div>`,
      `        <div ${cls('v', c.valueCls)}>${esc(c.value)}</div>`,
      `        <div ${cls('d', c.descCls)}>${rich(c.desc)}</div>`,
      '      </div>',
    ].join('\n');
  }).join('\n');
}

function levelRungs(level) {
  return level.rungs.map((r) => {
    const tail = r.bubble
      ? `<div class="bubble" style="background:var(--${esc(r.bubble.color)});width:${Number(r.bubble.width) || 0}%"></div>`
      : r.tag
        ? `<span class="tag">${esc(r.tag)}</span>`
        : '';
    return `        <div class="rung"><span class="lv" style="color:var(--${esc(r.color)})">${esc(r.value)}</span><span class="nm">${esc(r.name)}</span>${tail}</div>`;
  }).join('\n');
}

function drivers() {
  return data.drivers.map((d) => [
      '      <div class="drv">',
      '        <div class="drv-head">',
      `          <div><div class="t">${esc(d.title)}</div><div class="s">${esc(d.sub)}</div></div>`,
      `          <span class="pill ${esc(d.pillCls)}">${esc(d.pillText)}</span>`,
      '        </div>',
      `        <p>${rich(d.body)}`,
      `        <div class="dir" style="color:var(--${esc(d.dirColor)})">方向：${esc(String(d.dirText || '').replace(/^方向[:：]\s*/, ''))}</div>`,
      '      </div>',
    ].join('\n')
  ).join('\n');
}

function scenarios() {
  return data.scenarios.map((s) => [
      `      <div class="scn" data-s="${esc(s.id)}">`,
      `        <div class="prob">${esc(s.prob)}</div>`,
      `        <div class="name">${esc(s.name)}</div>`,
      `        <div class="cond">${rich(s.cond)}</div>`,
      `        <div class="path">${esc(s.path)}</div>`,
      `        <div class="obs">${esc(s.obs)}</div>`,
      '      </div>',
    ].join('\n')
  ).join('\n');
}

function calCell(v) {
  if (v === null || v === undefined || v === '') return '<td class="pending">--</td>';
  if (typeof v === 'object') return `<td class="pending">${esc(v.text)}</td>`;
  return `<td>${esc(v)}</td>`;
}

function calRows() {
  return data.calendar.rows.map((r) => {
    const pill = r.eventPill ? ` <span class="pill ${esc(r.eventPill.cls)}" style="font-size:10px">${esc(r.eventPill.text)}</span>` : '';
    return [
      `          <tr${r.hl ? ' class="hl"' : ''}>`,
      `            <td class="time">${esc(r.time)}</td>`,
      `            <td>${esc(r.event)}${pill}</td>`,
      `            <td class="imp">${stars(r.stars)}</td>`,
      calCell(r.prev),
      calCell(r.forecast),
      calCell(r.actual),
      `            <td><span class="tg ${esc(r.impactCls)}">${esc(r.impactText)}</span></td>`,
      '          </tr>',
    ].join('\n');
  }).join('\n');
}

function timeline() {
  return data.timeline.entries.map((e) => [
      `      <div class="t">${esc(e.label)}</div><div class="c"><span class="dot${e.small ? ' small' : ''}"></span></div><div class="x">`,
      `        <div class="ev">${esc(e.ev)}</div>`,
      `        <div class="de">${esc(e.de)}</div>`,
      e.mark ? `        <div class="mk"><span class="pill ${esc(e.mark.cls)}">${esc(e.mark.text)}</span></div>` : '',
      '      </div>',
    ]
    .filter(Boolean)
    .join('\n')
  ).join('\n');
}

function checklistRows() {
  return data.checklist.map((c) => `          <tr><td>${esc(c.freq)}</td><td>${esc(c.event)}</td><td>${esc(c.signal)}</td></tr>`).join('\n');
}

// ECharts option as a JS literal (JSON is valid JS; labels/series are arrays).
function chartConfig() {
  return JSON.stringify({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', triggerOn: 'click', renderMode: 'richText', confine: true },
    grid: { left: 12, right: 16, top: 30, bottom: 24, containLabel: true },
    xAxis: {
      type: 'category',
      data: data.chart.labels,
      axisLabel: { color: '#93a1b5', fontSize: 11 },
      axisLine: { lineStyle: { color: '#2a3548' } },
    },
    yAxis: {
      type: 'value',
      min: data.chart.yMin,
      max: data.chart.yMax,
      axisLabel: { color: '#93a1b5', fontSize: 11 },
      splitLine: { lineStyle: { type: 'dashed', color: '#232d3f' } },
    },
    series: [{
      type: 'line',
      data: data.chart.series,
      lineStyle: { width: 2.5, color: '#d4a643' },
      itemStyle: { color: '#d4a643' },
      symbolSize: 6,
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(212,166,67,.22)' },
            { offset: 1, color: 'rgba(212,166,67,0)' },
          ],
        },
      },
      markLine: {
        silent: true,
        symbol: 'none',
        label: { fontSize: 11, color: '#93a1b5', position: 'insideEndTop' },
        data: data.chart.markLines.map((m) => ({
          yAxis: m.value,
          lineStyle: { color: m.color, type: 'dashed' },
          label: { formatter: m.label },
        })),
      },
      markPoint: {
        symbol: 'pin',
        symbolSize: 32,
        label: { fontSize: 10, color: '#e8edf5' },
        data: [
          { type: 'max', itemStyle: { color: '#e25555' } },
          { type: 'min', itemStyle: { color: '#3fb27f' } },
        ],
      },
    }],
  });
}

// ---- token map -----------------------------------------------------------
const DEFAULT_SCN_GUIDE = '使用方法：对照"观察"栏与每日更新的行情判断当前走向，点击对应卡片标记；刷新或下次打开仍会保留你的选择。';

const tokens = {
  __STATUS_TAG_TEXT__: esc(data.statusTagText),
  __KPI_HINT__: esc(data.kpi.hint),
  __KPI_CARDS__: kpiCards(),
  __CHART_HINT__: esc(data.chart.hint),
  __CHART_FALLBACK__: esc(data.chart.fallback),
  __LEVEL_RUNGS_0__: levelRungs(data.levels[0]),
  __LEVEL_RUNGS_1__: levelRungs(data.levels[1]),
  __DRIVERS__: drivers(),
  __SCENARIOS__: scenarios(),
  __SCN_GUIDE__: esc(data.scnGuide || DEFAULT_SCN_GUIDE),
  __CAL_HINT__: esc(data.calendar.hint),
  __CAL_ROWS__: calRows(),
  __CAL_NOTE__: esc(data.calendar.note),
  __TL_HINT__: esc(data.timeline.hint),
  __TIMELINE__: timeline(),
  __CHECKLIST_ROWS__: checklistRows(),
  __RISK_HEADING__: esc(data.risk.heading),
  __RISK_BODY__: rich(data.risk.body),
  __FOOTER_TEXT__: esc(data.footerText),
  __CHART_CONFIG__: chartConfig(),
};

for (const [token, value] of Object.entries(tokens)) {
  if (!html.includes(token)) throw new Error(`Template missing token: ${token}`);
  html = html.split(token).join(value);
}

const leftover = html.match(/__[A-Z0-9_]+__/g);
if (leftover) throw new Error(`Unreplaced tokens remain: ${[...new Set(leftover)].join(', ')}`);

writeFileSync(join(root, 'index.html'), html, 'utf8');
console.log(`rendered index.html (${html.length} bytes)`);
