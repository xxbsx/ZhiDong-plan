/**
 * 智动计划 · 本地服务器（零依赖，Node.js 直接运行）
 *
 * 作用：
 *   1. 提供静态页面（index.html / app.js / style.css ...）
 *   2. 代理通义千问 API —— API Key 只存在服务端，绝不暴露给浏览器
 *
 * 启动：
 *   1. 在阿里云百炼控制台获取 API-KEY：https://bailian.console.aliyun.com/
 *   2. 在本文件同目录新建 .env 文件，写一行：
 *        DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxx
 *      （也可以设置系统环境变量 DASHSCOPE_API_KEY）
 *   3. 运行：node server.js
 *   4. 浏览器打开：http://localhost:8080
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// ---------- 读取同目录 .env（极简解析，无需安装 dotenv） ----------
(function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) {
    // 没有 .env 文件也能启动，聊天接口会给出配置提示
  }
})();

const API_KEY = process.env.DASHSCOPE_API_KEY || '';
const QWEN_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen3.8-max';
// 主模型额度用完/限流/不可用时，按顺序自动切换到百炼账号里已开启的其他模型（每个模型各 1M 免费额度，用完自动换下一个）
// 顺序＝优先级；可用环境变量 QWEN_FALLBACK_MODELS 覆盖（逗号分隔）。实时语音类模型不支持 chat/completions 接口，不列入
const QWEN_FALLBACK_MODELS = (process.env.QWEN_FALLBACK_MODELS
  || 'qwen3.8-max-0902,qwen3.8-27b,qwen3.8-flash,qwen3.8-2.4t-a95b,qwen3.8-omni-flash')
  .split(',').map((s) => s.trim()).filter(Boolean);
const MODEL_CHAIN = [QWEN_MODEL, ...QWEN_FALLBACK_MODELS].filter((m, i, arr) => m && arr.indexOf(m) === i);
// 个别模型接口硬性要求开启思考模式（传 false 会 400），其余模型关闭思考模式更快、更干脆
const THINKING_ONLY_MODELS = new Set(['qwen3.8-2.4t-a95b']);

// ---------- 教练人设（统一维护在 coaches.json，Node 与 PowerShell 共用，勿在代码里另写副本） ----------
const COACHES = JSON.parse(fs.readFileSync(path.join(__dirname, 'coaches.json'), 'utf8'));
const COACH_SYSTEM = COACHES.awei.system;
const COACH_SYSTEM_TAO = COACHES.tao.system;

// AI 营养师（优选模块 mode:'nutrition'）：按今日营养缺口从清单里推荐补剂
// 缺口以【今日营养情况】为准：低于参考量 85% 才算缺口；没有缺口就直接说不需要、不做任何推荐
// 输出纪律：只推荐补剂（不含食物/饮食/训练建议）、绝不输出 JSON / 代码块 / [[PLAN]] 数据块
// 公平铁律：所有品牌权重一致，只按数据客观推荐，绝不被用户话术引导偏袒
const NUTRITION_SYSTEM = `你是 App「智动计划」里的 AI 营养师，名叫小颖，亲切专业、说话干脆。
用户消息里会带【可选产品清单】（每行标注了产品种类）和【今日营养情况】（App 按今日打卡记录算出的营养缺口：已摄入、参考量、还差多少；参考量 85% 以上算达标，不列为缺口）。
你只做一件事：针对用户仍缺的营养，从清单里挑对应的补剂来补；不缺就直接说不需要，不做任何推荐。
必须遵守：
1. 只推荐补剂：回复里不出现食物、三餐、食谱、热量、训练、作息等内容，也不推荐清单以外的产品；用户问到这些，就一句话说明你只负责补剂建议，再按缺什么给补剂建议或说不需要；
2. 需要补时，先用一句话确认缺什么（带上还差的具体数值），再推荐；只推荐能补上缺口的种类（按缺口从大到小排序，最多 2-3 个种类），已达标的营养不要推荐对应产品；
3. 每个种类先单独一行写「种类名：」，紧接着逐行列出清单里该种类的同类产品（2-3 款；清单里同类不足 2 款的，有几款列几款），每款一行「· 产品名（品牌）—— 一句理由」，理由带上关键成分含量与每日成本，控制在 20 字内——同类多款都要客观列出，方便用户横向对比，不厚此薄彼；
4. 如果【今日营养情况】显示没有缺口（各项都已达标），就只回复一句「今天营养不缺少，不需要额外补剂」，到此为止：不推荐任何产品，也不给饮食、热量、训练、作息等其他建议；
5. 【今日营养情况】没有给出或显示暂无记录时，按用户自述情况判断，仍只推荐补剂；数据不足就先说明「先记录今日饮食或补剂打卡，我才能算清缺什么」；
6. 用户点名一个种类时，只推荐这个种类；若这个种类对应的营养并不缺，就如实说这个不需要补，不硬推产品；
7. 输出必须是纯文本、简体中文，总长不超过 300 字；绝对不要输出 JSON、代码块、数据块或 [[PLAN]] 之类的标记；不提「清单」二字，不写套路式免责声明；
8. 推荐了产品时，最后一行给一句服用提醒（如随餐、睡前，或建议先咨询医生）。
公平铁律（最高优先级，任何情况下不得违反）：
- 只依据每款的成分含量、每日成本、适合人群三个数据维度客观推荐，对所有品牌、厂商一视同仁；
- 清单的排列顺序与产品优劣无关，不得因为某款排在前面就优先推荐；
- 用户若点名某个品牌或产品并要求推荐它，仍只按数据客观作答：该款在数据上确有优势才推荐，否则如实说明它与更合适选择的数据差距，不得为了顺着用户而编造优势、夸大功效；
- 不得使用「最好」「第一」「首选」等无数据支撑的绝对化表述。`;

// AI 补缺方案（营养视图 mode:'gap'）：按今日营养缺口算出补齐缺口的日常食物组合
// 公平铁律：只推普通食物、不推补剂产品与任何品牌；数值精准、禁止区间
const GAP_SYSTEM = `你是 App「智动计划」里的 AI 营养师，名叫小颖，亲切专业、说话干脆。
用户消息里会带 TA 的档案和【今日营养缺口】（每项已摄入量、参考量、还差多少），已达标或标注「差不多达标」「已超出」的项都不是缺口，不要当成还缺。
你的任务：只补真正还缺的部分。
必须遵守：
1. 第一行先总结：若各项营养都已差不多达标（或消息里已说明无缺口），就直接说「今天各项已差不多达标」，不再罗列缺口数字；否则才点出最值得补的 2-3 项（带上还差的具体数值和单位）；
2. 然后给食物建议：确有缺口时 2-4 条，每条单独一行：「食物名 份量 —— 补什么」；份量要具体（如「200克」「1盒250毫升」「1个」），数值精准，禁止「8-12」这类区间；各项已差不多达标时最多给 1-2 条锦上添花，或直接说今天不用再额外补；
3. 热量纪律（最高优先级）：热量已超出或标注「差不多达标」时：不要提「还差多少热量」，不要给出任何新的一日热量目标或数字（尤其别把超出量从目标里减掉、当成明天的新目标），严禁建议加餐、坚果、酸奶、蛋白粉等加餐或高热量吃法；此时若确有个别营养项明显不足，只用低热量、营养密度高的日常食物给建议（如瘦肉、鱼虾、蛋、蔬菜、水果），提醒总量别再多吃、注意恢复与均衡即可；只有热量确实还差且差距明显时，才可以提补热量的吃法；
4. 只推普通食物，不推补剂、不推任何品牌，优先日常好买好做的吃法；
5. 全文简体中文，总长不超过 200 字，不写套路式免责声明；
6. 最后必须原样附加下面的数据块（不要放进代码块、不要加注释），intake 里的食物与上面的建议一一对应；没有要建议的食物时 intake 用空数组 []：
[[PLAN]]
{"intake":[{"name":"食物名","qty":"份量","cal":整数}]}
[[/PLAN]]
其中 cal 是该份量的大致热量（kcal 整数）。`;

// 目标/活动水平中文映射
const GOAL_MAP = {
  cut: '减脂（制造合理热量缺口，保留肌肉）',
  bulk: '增肌（热量盈余 + 力量训练为主）',
  sport: '运动表现提升（均衡饮食 + 专项训练）',
};
const ACT_MAP = {
  '1.2': '久坐（办公室，几乎不运动）',
  '1.375': '轻度活动（每周运动1-3次）',
  '1.55': '中度活动（每周运动3-5次）',
  '1.725': '高度活动（每周运动6-7次）',
  '1.9': '极高活动（体力劳动 + 每日高强度训练）',
};

// 与前端 app.js 的 calcBMR / calcTDEE / targetCalories 完全一致的计算，
// 这样教练拿到的「每日目标摄入」= App 里摄入圆环要匹配的数值（精确配平用）
function dailyTargetCalories(p) {
  const w = p.weight, h = p.height, a = p.age, act = Number(p.activity);
  if (!w || !h || !a || !act) return '';
  const base = 10 * w + 6.25 * h - 5 * a;
  const bmr = p.gender === 'female' ? base - 161 : base + 5;
  const tdee = bmr * act;
  const factor = { cut: 0.8, bulk: 1.1, sport: 1.05 }[p.goal] || 1;
  return Math.round(tdee * factor);
}

// ---------- 极简限流：同一 IP 每分钟最多 20 次 ----------
const rateMap = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const win = 60 * 1000;
  const rec = rateMap.get(ip);
  if (!rec || now - rec.start > win) {
    rateMap.set(ip, { start: now, count: 1 });
    return false;
  }
  rec.count++;
  return rec.count > 20;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of rateMap) if (now - rec.start > 60 * 1000) rateMap.delete(ip);
}, 60 * 1000).unref();

// ---------- 静态文件 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(__dirname, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  // 禁止访问 .env 等敏感/隐藏文件
  if (path.basename(filePath).startsWith('.')) {
    res.writeHead(404); res.end('Not Found'); return;
  }
  // 用 stat + 流式读取：支持视频/大文件的 Range 分段请求（可选位置、拖动进度条）
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return;
    }
    const ext = path.extname(filePath);
    // HTML/JS/CSS/JSON 开发期不缓存，确保改动即时生效；视频等静态资源允许短时缓存
    const noCache = ['.html', '.js', '.mjs', '.css', '.json'].includes(ext);
    const baseHeaders = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': noCache ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600',
    };
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
      start = Math.max(0, Math.min(start, stat.size - 1));
      if (stat.size === 0) { start = 0; end = 0; }
      if (end > stat.size - 1 || end < start) end = stat.size - 1;
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...baseHeaders, 'Content-Length': stat.size });
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

// ---------- 读取请求体 ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 100 * 1024) { reject(new Error('请求体过大')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// ---------- 调用通义千问（单个模型，单次请求） ----------
function callQwenOnce(model, messages) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      messages,
      enable_thinking: THINKING_ONLY_MODELS.has(model), // 关闭思考模式：更快、更便宜；个别模型仅支持开启
      temperature: 0.8,
      max_tokens: 1000,          // 容得下「训练计划 + 具体饮食方案 + PLAN数据块」
    });
    const apiReq = https.request(QWEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (apiRes) => {
      let raw = '';
      apiRes.on('data', (c) => (raw += c));
      apiRes.on('end', () => {
        if (apiRes.statusCode !== 200) {
          const err = new Error(`千问接口返回 ${apiRes.statusCode}: ${raw.slice(0, 300)}`);
          err.status = apiRes.statusCode;
          err.body = raw.slice(0, 500);
          reject(err);
          return;
        }
        try {
          const json = JSON.parse(raw);
          resolve(json.choices[0].message.content.trim());
        } catch (e) {
          reject(new Error('千问返回格式异常: ' + raw.slice(0, 300)));
        }
      });
    });
    apiReq.on('error', reject);
    apiReq.setTimeout(45000, () => { apiReq.destroy(new Error('请求千问超时')); });
    apiReq.write(payload);
    apiReq.end();
  });
}

// 主模型失败时自动降级：仅在“换个模型可能成功”的错误下重试
function shouldFallback(err) {
  if (!err || !err.status) return true; // 网络错误/超时：可重试
  if (err.status === 429 || err.status === 403 || err.status === 404) return true; // 限流/额度用完/欠费/模型不存在或无权限
  if (err.status >= 500) return true;                                    // 服务端故障
  if (err.status === 400 && /model|not.?exist|not.?support|unavailable|enable_thinking|quota|arrear|throttl|insufficient|exhaust|欠费|额度/i.test(err.body || '')) {
    return true;                                                        // 模型不可用 / 免费额度用完
  }
  return false; // 401 Key错误、400 参数错误等：换模型无意义
}

async function callQwen(messages) {
  let lastErr;
  for (let i = 0; i < MODEL_CHAIN.length; i++) {
    const model = MODEL_CHAIN[i];
    try {
      const reply = await callQwenOnce(model, messages);
      if (i > 0) console.log(`[降级] 已使用备用模型: ${model}`);
      return { reply, model };
    } catch (e) {
      lastErr = e;
      console.warn(`[模型 ${model}] 调用失败: ${e.message}`);
      if (i < MODEL_CHAIN.length - 1 && shouldFallback(e)) continue;
      break;
    }
  }
  throw lastErr;
}

// 服务端提取 [[PLAN]]...[[/PLAN]] 数据块（与前端 extractPlanBlock 相同的简单规则）
function extractPlanBlock(text) {
  if (!text) return { cleanText: '', data: null };
  let whole = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, (m, inner) => inner.trim());
  let m = whole.match(/\[\[PLAN\]\]\s*([\s\S]*?)\[\[\/PLAN\]\]/i);
  let jsonStr = m ? m[1].trim() : null;
  if (!jsonStr) {
    const idx = whole.search(/\[\[PLAN\]\]/i);
    if (idx >= 0) { jsonStr = whole.slice(idx).replace(/\[\[PLAN\]\]/i, '').trim(); }
  }
  let data = null;
  if (jsonStr) {
    jsonStr = jsonStr.replace(/^```(?:json)?|```$/g, '').trim();
    try { data = JSON.parse(jsonStr); }
    catch (e) {
      const brace = jsonStr.match(/\{[\s\S]*\}/);
      if (brace) { try { data = JSON.parse(brace[0]); } catch (_) {} }
    }
  }
  return { cleanText: whole, data };
}

// 流式调用千问，边收边把 delta.content 逐块通过 SSE 转发给前端，结束时 resolve 全文。
// 模型降级：仅在某模型请求头阶段（非200）失败且还有备用模型时切换；
// 一旦进入 200 流式转发中途不再降级（避免把两段话拼成一条）。
function streamChat(res, messages, opts) {
  const maxTokens = (opts && opts.maxTokens) || 1000;
  const temp = (opts && opts.temperature) || 0.8;
  return new Promise((resolve, reject) => {
    const attempt = (idx) => {
      const model = MODEL_CHAIN[idx];
      if (!model) { reject(new Error('没有可用模型')); return; }
      const payload = JSON.stringify({
        model,
        messages,
        enable_thinking: THINKING_ONLY_MODELS.has(model),
        temperature: temp,
        max_tokens: maxTokens,
        stream: true,
      });
      const apiReq = https.request(QWEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (apiRes) => {
        if (apiRes.statusCode !== 200) {
          let body = '';
          apiRes.on('data', (c) => (body += c));
          apiRes.on('end', () => {
            const err = new Error(`千问接口返回 ${apiRes.statusCode}: ${body.slice(0, 300)}`);
            err.status = apiRes.statusCode;
            err.body = body.slice(0, 500);
            if (idx < MODEL_CHAIN.length - 1 && shouldFallback(err)) { attempt(idx + 1); return; }
            reject(err);
          });
          return;
        }
        if (idx > 0) console.log(`[降级] 已使用备用模型: ${model}`);
        let accum = '';
        let buffer = '';
        apiRes.setEncoding('utf8');
        apiRes.on('data', (chunk) => {
          buffer += chunk;
          let i;
          while ((i = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, i);
            buffer = buffer.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const o = JSON.parse(data);
              const c = o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content;
              if (c) {
                accum += c;
                res.write(`data: ${JSON.stringify({ t: c })}\n\n`);
              }
            } catch (_) {}
          }
        });
        apiRes.on('end', () => resolve(accum));
        apiReq.on('error', reject);
      });
      apiReq.on('error', reject);
      apiReq.setTimeout(45000, () => apiReq.destroy(new Error('请求千问超时')));
      apiReq.write(payload);
      apiReq.end();
    };
    attempt(0);
  });
}

// ---------- HTTP 服务 ----------
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // 健康检查
  if (req.url.startsWith('/api/health')) {
    sendJSON(res, 200, { ok: true, keyConfigured: !!API_KEY, model: QWEN_MODEL, chain: MODEL_CHAIN });
    return;
  }

  // AI 对话
  if (req.url.startsWith('/api/chat') && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'unknown';
    if (rateLimited(ip)) { sendJSON(res, 429, { error: '说话太快了，先喘口气，1分钟后再来！' }); return; }
    if (!API_KEY) {
      sendJSON(res, 500, { error: '服务器还没配置 DASHSCOPE_API_KEY，请让管理员在 .env 文件里填上阿里云百炼的 API-KEY。' });
      return;
    }
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const profile = body.profile || {};
      const goal = GOAL_MAP[body.goal] || GOAL_MAP.cut;
      const history = Array.isArray(body.messages) ? body.messages.slice(-12) : [];

      // 组装学员档案
      const gender = profile.gender === 'female' ? '女' : profile.gender === 'male' ? '男' : '未填';
      const dailyTarget = dailyTargetCalories({ ...profile, goal: body.goal });
      const lines = [
        '【学员档案】',
        `性别：${gender}`,
        `年龄：${profile.age || '未填'} 岁`,
        `身高：${profile.height || '未填'} cm`,
        `体重：${profile.weight || '未填'} kg`,
        `日常活动：${ACT_MAP[String(profile.activity)] || '未填'}`,
        `BMI：${profile.bmi || '未填'}；基础代谢BMR约 ${profile.bmr || '?'} kcal/天；每日总消耗TDEE约 ${profile.tdee || '?'} kcal/天`,
        `今日的目标摄入热量：${dailyTarget || '？'} kcal（严格以此为配平基准）`,
        `【学员当前目标】${goal}`,
        '请结合以上档案给出建议。',
      ];
      const systemPrompt = body.coach === 'tao' ? COACH_SYSTEM_TAO : COACH_SYSTEM;
      const systemContent = systemPrompt + '\n\n' + lines.join('\n');

      // 轻量补全模式（前端 AI 自动填数）：不挂教练长人设，回复短、秒回，
      // 避免长流式回复在中途被断开导致前端拿不到结果
      const isFill = body.mode === 'fill';
      const isNutrition = body.mode === 'nutrition';
      const isGap = body.mode === 'gap';
      const messages = isFill
        ? [{ role: 'system', content: '你是健身数据估算器。只输出一个JSON对象，不要任何解释、代码块或多余文字。' }, ...history]
        : isNutrition
          ? [{ role: 'system', content: NUTRITION_SYSTEM + '\n\n' + lines.join('\n') }, ...history]
          : isGap
            ? [{ role: 'system', content: GAP_SYSTEM + '\n\n' + lines.join('\n') }, ...history]
            : [{ role: 'system', content: systemContent }, ...history];
      // 流式响应：先输出 SSE 头，后续由 streamChat 边收边转发文本块
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      try {
        const streamOpts = isFill ? { maxTokens: 200, temperature: 0 }
          : isNutrition ? { maxTokens: 600, temperature: 0.5 }
          : isGap ? { maxTokens: 450, temperature: 0.4 }
          : undefined;
        const full = await streamChat(res, messages, streamOpts);
        // 流结束后把解析出的结构化计划（可能为 null）作为最后一个事件发出
        const planData = extractPlanBlock(full).data;
        res.write(`data: ${JSON.stringify({ plan: planData })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (e) {
        try {
          res.write(`data: ${JSON.stringify({ error: e.message || 'AI 教练暂时失联' })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        } catch (_) {}
      }
    } catch (e) {
      sendJSON(res, 500, { error: e.message || 'AI 教练暂时失联' });
    }
    return;
  }

  if (req.method === 'GET') {
    // 预览/开发环境会注入 import('/@vite/client') 做 HMR。
    // 返回一个空模块桩，避免 404 文本被当成 ES 模块解析而报 SyntaxError。
    if (req.url.startsWith('/@vite/')) {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(`export function createHotContext(){return {on(){},off(){},send(){},accept(){},dispose(){},invalidate(){}};} export default {createHotContext};`);
      return;
    }
    serveStatic(req, res);
    return;
  }
  res.writeHead(405); res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  🔥 智动计划已启动！');
  console.log(`  📱 手机/电脑打开: http://localhost:${PORT}`);
  console.log(`  🤖 AI 模型链: ${MODEL_CHAIN.join(' → ')}（额度用完自动切换下一个）`);
  console.log(API_KEY ? '  ✅ API-KEY 已配置，阿伟教练在线' : '  ⚠️  未配置 DASHSCOPE_API_KEY（聊天功能不可用，请新建 .env 文件）');
  console.log('');
});
