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
  const res = await fetch(`${apiBase}/chat/completions`, {
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
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? '';
}

// ---- 从回复中提取 JSON ----------------------------------------------------
function extractJson(text) {
  // 直接解析
  try { return JSON.parse(text); } catch {}
  // 去掉可能的 markdown 代码块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch {}
  }
  // 取第一个 { 到最后一个 }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  throw new Error('无法从 LLM 回复中解析出 JSON');
}

// ---- main ------------------------------------------------------------------
(async () => {
  console.log(`[research] 调用 ${model} @ ${apiBase} ...`);
  const content = await callLLM();
  const data = extractJson(content);
  writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
  console.log('[research] data.json 已写入，等待 validate.mjs 校验');
})().catch((e) => {
  console.error(`[research] FAILED: ${e.message}`);
  process.exit(1);
});
