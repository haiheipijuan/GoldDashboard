// One-off tool: converts the current index.html into template.html.
// Every per-round-changing region is replaced with a __TOKEN__ placeholder;
// render.mjs fills those tokens from data.json.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
let out = src;

function replaceOnce(text, regex, token) {
  const matches = text.match(regex);
  if (!matches) {
    throw new Error('No match for ' + token + ': ' + regex);
  }
  return text.replace(regex, token);
}

// ---- header status tag ----
out = replaceOnce(
  out,
  /<div class="status-tag"><span class="dot"><\/span>[^<]*<\/div>/,
  '<div class="status-tag"><span class="dot"></span>__STATUS_TAG_TEXT__</div>'
);

// ---- sec1 KPI: hint + cards ----
out = replaceOnce(
  out,
  /核心指标快照 <span class="hint">.*?<\/span><\/div>/s,
  '核心指标快照 <span class="hint">__KPI_HINT__</span></div>'
);
out = replaceOnce(
  out,
  /<div class="grid kpi-grid">[\s\S]*?<\/div>\r?\n  <\/section>/,
  '<div class="grid kpi-grid">\n__KPI_CARDS__\n    </div>\n  </section>'
);

// ---- sec2 chart: hint + fallback ----
out = replaceOnce(
  out,
  /9 月走势与关键位 <span class="hint">.*?<\/span><\/div>/s,
  '9 月走势与关键位 <span class="hint">__CHART_HINT__</span></div>'
);
out = replaceOnce(
  out,
  /<div class="chart-fallback" id="chartFallback">.*?<\/div>/s,
  '<div class="chart-fallback" id="chartFallback">__CHART_FALLBACK__</div>'
);

// ---- sec3 levels: line-based. First rung line per lvl block becomes the
// token, remaining rung lines in that block are dropped (render re-emits all). ----
{
  const lines = out.split('\n');
  let inLvl = false;
  let lvlIndex = -1;
  let emitted = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^ {6}<div class="lvl">$/.test(lines[i])) {
      inLvl = true;
      lvlIndex++;
      emitted = false;
      continue;
    }
    if (!inLvl) continue;
    if (/^ {8}<h3><span class="mark"/.test(lines[i])) continue;
    if (/^ {8}<div class="rung">/.test(lines[i])) {
      lines.splice(i, 1, emitted ? null : '__LEVEL_RUNGS_' + lvlIndex + '__');
      if (!emitted) i--; // re-check position after removing the line
      emitted = true;
      continue;
    }
    if (/^ {6}<\/div>$/.test(lines[i])) inLvl = false;
  }
  out = lines.filter((l) => l !== null).join('\n');
}

// ---- sec4 drivers: content inside grid div ----
out = replaceOnce(
  out,
  /(<div class="grid" style="grid-template-columns:repeat\(auto-fit,minmax\(300px,1fr\)\);gap:12px">)[\s\S]*?(<\/div>\r?\n  <\/section>)/,
  '$1\n__DRIVERS__\n$2'
);

// ---- sec5 scenarios: cards grid + guide ----
out = replaceOnce(
  out,
  /<div class="grid scn-grid">[\s\S]*?<\/div>\r?\n( {4}<div class="scn-guide">)/,
  '<div class="grid scn-grid">\n__SCENARIOS__\n$1'
);
out = replaceOnce(
  out,
  /<div class="scn-guide">.*?<\/div>/s,
  '<div class="scn-guide">__SCN_GUIDE__</div>'
);

// ---- sec6 calendar: hint + tbody rows + note ----
out = replaceOnce(
  out,
  /财经数据日历 <span class="hint">.*?<\/span><\/div>/s,
  '财经数据日历 <span class="hint">__CAL_HINT__</span></div>'
);
out = replaceOnce(
  out,
  /<tbody>\r?\n([\s\S]*?)<\/tbody>/,
  '<tbody>\n__CAL_ROWS__\n        </tbody>'
);
out = replaceOnce(
  out,
  /<div class="cal-note">.*?<\/div>/s,
  '<div class="cal-note">__CAL_NOTE__</div>'
);

// ---- sec7 timeline: hint + entries ----
out = replaceOnce(
  out,
  /近期关键事件时间轴 <span class="hint">.*?<\/span><\/div>/s,
  '近期关键事件时间轴 <span class="hint">__TL_HINT__</span></div>'
);
out = replaceOnce(
  out,
  /<div class="tl">\r?\n([\s\S]*?)\r?\n    <\/div>/,
  '<div class="tl">\n__TIMELINE__\n    </div>'
);

// ---- sec8 checklist rows: anchor on the checklist table's unique colgroup,
// because a bare <tbody> regex would re-match the already-replaced calendar tbody ----
out = replaceOnce(
  out,
  /(<colgroup><col style="width:16%"><col style="width:44%"><col style="width:40%"><\/colgroup>\r?\n      <thead>.*?<\/thead>\r?\n      <tbody>\r?\n)[\s\S]*?(<\/tbody>)/,
  '$1__CHECKLIST_ROWS__$2'
);

// ---- risk + footer ----
out = replaceOnce(
  out,
  /<div class="risk">\r?\n    <h3>.*?<\/h3>\r?\n    <p>[\s\S]*?<\/p>/,
  '<div class="risk">\n    <h3>__RISK_HEADING__</h3>\n    <p>__RISK_BODY__</p>'
);
out = replaceOnce(
  out,
  /<footer>[\s\S]*?<\/footer>/,
  '<footer>__FOOTER_TEXT__</footer>'
);

// ---- script: echarts setOption config ----
{
  const startMarker = 'chart.setOption({';
  const start = out.indexOf(startMarker);
  if (start < 0) throw new Error('setOption not found');
  let depth = 0;
  let i = start + startMarker.length - 1; // position of '{'
  let end = -1;
  for (; i < out.length; i++) {
    const ch = out[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error('setOption braces not balanced');
  out = out.slice(0, start) + '__CHART_CONFIG__' + out.slice(end);
}

writeFileSync(new URL('./template.html', import.meta.url), out, 'utf8');
console.log('template.html written:', out.length, 'bytes');
