# 黄金走势跟踪看板（GoldDashboard）

每 2 小时自动检索影响金价的行情与新闻事件，重新生成单页看板并发布到固定公网地址。

**不需要本地常驻服务**：定时抓取由 GitHub Actions cron 完成，页面通过 GitHub Pages 提供固定公网 URL，外部直接访问即可。

---

## 一、架构总览

```
GitHub Actions (cron: 11 */2 * * *)
   │
   ├─ 1. research/run.mjs    调用 LLM API（OpenAI 兼容协议）检索行情+新闻，
   │                          结合上一轮 data.json，输出新的 data.json
   ├─ 2. validate.mjs        schema 校验门禁：结构/条数/字数/免责声明，失败则中止
   ├─ 3. render.mjs          确定性渲染：template.html + data.json → index.html
   ├─ 4. git commit & push   内容有变化才提交（无变化跳过）
   │
   └─ push 触发 pages.yml → GitHub Pages 部署 → 固定公网 URL 自动更新
```

- **数据与模板分离**：每轮变化的内容全部在 `data.json`；`template.html` 是静态外壳（CSS/JS/20 个占位符），研究轮次不应改动它。
- **零依赖**：`research/run.mjs`、`validate.mjs`、`render.mjs` 只用 Node 内置模块，Actions 里 `setup-node` 即可运行。
- **失败安全**：LLM 输出不合法 → validate 报错 → workflow 失败，旧的 index.html 保持在线不变。

## 二、文件清单

```
├── .github/workflows/
│   ├── dashboard.yml        # 定时研究 + 校验 + 渲染 + 提交（cron）
│   └── pages.yml            # GitHub Pages 部署（只发布 index.html + data.json）
├── research/
│   ├── run.mjs              # LLM 研究调用（OpenAI 兼容 /chat/completions）
│   └── prompt.md            # 研究指令：数据口径、schema 约束、禁止编造
├── data.json                # 当前一轮的全部数据（每次刷新被重写）
├── template.html            # 静态模板（暗色金色主题，20 个 __TOKEN__ 占位符）
├── render.mjs               # 渲染器：token 替换 + HTML 转义 + 富文本白名单
├── validate.mjs             # schema 校验门禁
├── index.html               # 渲染产物（Pages 发布的就是它）
├── migrate.mjs              # 一次性迁移工具（旧单文件页面 → data.json），仅留档
├── make_template.mjs        # 一次性模板生成工具，仅留档
└── _orig_index.html         # 重构前原始自包含页面备份，仅留档
```

## 三、data.json schema（validate.mjs 强制）

| 字段 | 说明 |
|---|---|
| `meta` | `{generationTime, titleDate}` 本轮生成时间与标题日期 |
| `statusTagText` | 头部状态标签文字 |
| `kpi` | `{hint, cards[6]}` 每张卡：`name / pill{cls,text}\|null / value / valueCls / descCls / desc`（desc 支持 `<b>`） |
| `chart` | `{hint, fallback, labels[], series[], yMin, yMax, markLines[]}`；labels 与 series 等长 |
| `levels[2]` | 支撑/阻力阶梯：`{heading, markColor(red\|green), rungs[{value,color,name,tag,bubble}]}` |
| `drivers[5]` | 驱动因素：`{title, sub, pillCls, pillText, body, dirColor, dirText}` |
| `scenarios[3]` | 情景记分卡 A/B/C：`{id, prob, name, cond, path, obs}` |
| `calendar` | `{hint, rows[11], note}`；行：`{hl, time, event, eventPill, stars(1-5), prev/forecast/actual, impactCls(bull\|bear\|mid\|pend), impactText}`；三列取值须为短值或 null（≤40 字），未公布用 `{text:"待公布", pending:true}` |
| `timeline` | `{hint, entries[10]}`；每条：`{label, small, ev(≤200字), de(≤200字), mark{cls,text}\|null}` |
| `checklist[6]` | 跟踪清单：`{freq, event, signal}` |
| `risk` | `{heading, body}`；body 必须逐字包含免责声明（见约束第 5 条） |
| `footerText` | 页脚生成时间 |

## 四、部署步骤（一次性，手动）

1. **创建 GitHub 仓库**：在 github.com 新建仓库（建议私有即可，Pages 可对外公开），例如 `GoldDashboard`。
2. **推送本目录**：
   ```bash
   git remote add origin https://github.com/<你的用户名>/GoldDashboard.git
   git push -u origin main
   ```
3. **添加 Secrets**（仓库 Settings → Secrets and variables → Actions）：

   | Secret | 示例 | 说明 |
   |---|---|---|
   | `LLM_API_BASE` | `https://api.openai.com/v1` | OpenAI 兼容 API 的 base URL（不带末尾 `/chat/completions`） |
   | `LLM_API_KEY` | `sk-...` | API Key |
   | `LLM_MODEL` | `gpt-4o-mini` | 模型名，需支持联网检索或配合 prompt 内搜索要求 |

   > 任何 OpenAI 兼容端点均可（OpenAI / Azure 兼容网关 / DeepSeek / Moonshot / 通义等），只要暴露 `/chat/completions`。非兼容协议需改 `research/run.mjs` 的 `callLLM()`。

4. **启用 GitHub Pages**：Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。首次 push 后由 `pages.yml` 自动部署，URL 形如 `https://<用户名>.github.io/GoldDashboard/`。
5. **验证**：Actions 标签页手动点 "Run workflow"（workflow_dispatch）触发一轮；约 2-4 分钟后访问 Pages URL 确认更新。

## 五、日常运维

- **改刷新频率**：编辑 `.github/workflows/dashboard.yml` 的 `cron`（UTC 时区）。当前 `11 */2 * * *` = 北京时间偶数小时的 :11，每 2 小时一轮。
- **换 LLM 供应商/模型**：只改 Secrets，无需改代码（兼容协议前提下）。
- **临时停更**：Actions → dashboard-refresh → Disable workflow。
- **查看某轮失败原因**：Actions 运行记录；最常见是 LLM 返回 JSON 不合法被 validate 拦截——重跑一次即可（workflow_dispatch）。
- **页面手动刷新**：`meta refresh` 900 秒 + 暂停按钮，与重构前一致。

## 六、数据源与口径

| 品种 | 数据源 | 口径 |
|---|---|---|
| 伦敦金现 | 同花顺行情检索 | 美元/盎司，现货 |
| 纽约金 | 同花顺行情检索 | COMEX 期货主连，美元/盎司 |
| 黄金 T+D | 同花顺行情检索 | 元/克，上海黄金现货 |
| 沪金主连 | 同花顺行情检索 | 元/克，SHFE 期货 |
| 伦敦银现 / 纽约银 / 白银 T+D | 同花顺行情检索 | 同上口径 |
| 美联储议息预期 | 搜索 + CME FedWatch | 当月/次月加息概率 |
| 美元指数 / 10Y 美债 / 油价 | 搜索 | 最近收盘口径 |

## 七、硬约束（research/prompt.md 与 validate.mjs 共同强制）

1. **所有数字必须来自当轮实际检索**，不得沿用旧数据或编造。
2. 周末/节假日休市时报价持平属正常，但 `generationTime` 时间戳仍须每轮推进。
3. 时间轴卡片 `ev`、`de` 各 ≤200 字（手机端可读性，长期偏好）。
4. 日历 prev/forecast/actual 只放短值或 null，不写叙事长文。
5. 风险提示必须逐字保留"不构成任何投资建议，不承诺任何价格走势"。
6. `meta refresh` 900s + 暂停按钮、暗色金色主题（`#0d1117`/`#d4a643`）、390px 移动端适配由 template.html 保证，研究轮次不得改动模板 CSS。
