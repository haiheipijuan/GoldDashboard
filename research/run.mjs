// research/run.mjs — 每轮研究：调用 LLM API（OpenAI 兼容协议）生成新 data.json。
// 环境变量：LLM_API_BASE（如 https://api.openai.com/v1）、LLM_API_KEY、LLM_MODEL。
// 可选：LLM_TIMEOUT_MS（默认 300000）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataPath = join(root, 'data.json');
const promptPath = join(dirname(fileURLToPath(import.meta.url)), 'prompt.md');

const apiBase = (process.env.LLM_API_BASE || '').replace(/\/+$/, '');
const apiKey = process.env.LLM_API_KEY;
const model = process.env.LLM_MODEL;
if (!apiBase || !apiKey || !model) {
  console.error('[research] 缺少环境变量：LLM_API_BASE / LLM_API_KEY / LLM_MODEL');
  process.exit(1);
}
const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 300000);

// ---- 组装 prompt ---------------------------------------------------------
let systemPrompt = readFileSync(promptPath, 'utf8');
if (existsSync(dataPath)) {
  const prev = readFileSync(dataPath, 'utf8');
  // 上一轮数据可能较大，截断到 60KB 以内防止超上下文
  systemPrompt = systemPrompt.replace('__PREVIOUS_DATA_JSON__', prev.length > 60000 ? prev.slice(0, 60000) + '\n…（已截断）' : prev);
} else {
  systemPrompt = systemPrompt.replace('__PREVIOUS_DATA_JSON__', '（无上一轮数据，这是首轮生成）');
}
const userMessage = `现在是 ${new Date().toISOString()}（UTC）。请开始本轮研究并输出完整 JSON。`;

// ---- 调用 API ------------------------------------------------------------
async function callLLM() {
  const doFetch = (extra) => fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      ...extra,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  // 优先要求 JSON 输出模式；供应商不支持该参数（400）时退回普通请求
  let res;
  try {
    res = await doFetch({ response_format: { type: 'json_object' } });
  } catch (e) {
    throw e;
  }
  if (res.status === 400) {
    await res.text().catch(() => '');
    console.log('[research] json_object 模式被拒绝，改用普通请求');
    res = await doFetch({});
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new Error('LLM 返回空内容');
  return content;
}

// ---- 从回复中提取 JSON ----------------------------------------------------
function repairJson(text) {
  // 去掉尾逗号（对象/数组末尾的 ,）
  return text.replace(/,\s*([}\]])/g, '$1');
}
function extractJson(text) {
  // 去掉推理块（MiniMax 等模型会在 content 里内嵌 <think>...</think>）
  const stripped = text.replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, '').trim();
  const candidates = [];
  // markdown 代码块（可能有多个，全部收集）
  for (const src of [stripped, text]) {
    for (const m of src.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) candidates.push(m[1]);
    const s = src.indexOf('{');
    const e = src.lastIndexOf('}');
    if (s >= 0 && e > s) candidates.push(src.slice(s, e + 1));
  }
  candidates.push(text);
  let lastErr;
  for (const cand of candidates) {
    try { return JSON.parse(cand); } catch (e) { lastErr = e; }
    try { return JSON.parse(repairJson(cand)); } catch (e) { lastErr = e; }
  }
  const head = text.slice(0, 600).replace(/\s+/g, ' ');
  const tail = text.slice(-300).replace(/\s+/g, ' ');
  throw new Error(`无法从 LLM 回复中解析出 JSON（${lastErr?.message}）。回复开头: ${head} … 结尾: ${tail}`);
}

// ---- main ------------------------------------------------------------------
(async () => {
  console.log(`[research] 调用 ${model} @ ${apiBase} ...`);
  const content = await callLLM();
  console.log(`[research] LLM 返回 ${content.length} 字符`);
  const data = extractJson(content);
  writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
  console.log('[research] data.json 已写入，等待 validate.mjs 校验');
})().catch((e) => {
  console.error(`[research] FAILED: ${e.message}`);
  process.exit(1);
});
