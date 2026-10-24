// ============ 智动计划 ============

const state = {
  gender: '',
  age: 0,
  height: 0,
  weight: 0,
  activity: '',
  goal: 'cut',
  nickname: '',
  avatar: '',
  coach: 'awei',
  chatHistory: [],           // 当前教练的对话（指向 chats[coach]）
  chats: { awei: [], tao: [] },
  sending: false,
  // 今日计划（默认由阿伟生成，可手动编辑）
  plan: { date: '', workout: [], cardio: [], intake: [] },
  subtab: 'coach',
};

const STORAGE_KEY = 'zhidong_profile_v1';
const CHAT_KEY = 'zhidong_chats_v3';
const CHAT_KEY_OLD = 'zhidong_chat_v2';
const PLAN_KEY = 'zhidong_plan_v2';
// 本地日期（YYYY-MM-DD）。注意用本地时区而非 UTC，否则凌晨0-8点会误判为前一天
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 两位教练的资料
const COACHES = {
  awei: {
    name: '阿伟教练',
    img: 'coach-avatar.svg',
    greeting: '嗨，我是阿伟',
    status: '在线 · 平均几秒内回复',
    tags: ['力量', '增肌', '饮食'],
    placeholder: '问问阿伟，训练 / 饮食都可以…',
    emptySub: '告诉我你今天的情况，训练和饮食我都可以帮你安排',
    chips: [
      ['帮我制定一份今天的训练计划', '帮我制定今日训练'],
      ['减脂期一天应该怎么吃？', '减脂期怎么吃'],
      ['我今晚想吃牛肉面，可以吗？', '想吃牛肉面'],
      ['推荐一套15分钟的居家有氧', '15分钟居家有氧'],
    ],
  },
  tao: {
    name: '林教练',
    img: 'coach-lin.svg',
    greeting: '你好，我是林教练',
    status: '在线 · 专业指导 · 高效燃脂',
    tags: ['燃脂', '有氧', '塑形'],
    placeholder: '问问林教练，燃脂 / 塑形都可以…',
    emptySub: '今天想燃脂还是塑形？告诉我，我来帮你安排',
    chips: [
      ['帮我安排一份高效燃脂计划', '帮我安排燃脂计划'],
      ['想要塑形紧致，该怎么练？', '塑形该怎么练'],
      ['推荐一套10分钟晨起拉伸', '晨起拉伸10分钟'],
      ['低卡又好吃的晚餐有什么推荐？', '低卡晚餐推荐'],
    ],
  },
};

// ---- 工具函数 ----
const $ = (id) => document.getElementById(id);
const round = (n, d = 0) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
// 热量合计：只统计已打卡（完成）的条目
const sumDoneCal = (list) => list.reduce((s, x) => s + (x.done ? (Number(x.cal) || 0) : 0), 0);

// ============ 数据持久化 ============
function saveProfile() {
  const profile = {
    gender: state.gender,
    age: state.age,
    height: state.height,
    weight: state.weight,
    activity: state.activity,
    goal: state.goal,
    nickname: state.nickname,
    avatar: state.avatar,
    coach: state.coach,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch (e) {}
}

function saveChat() {
  state.chats[state.coach] = state.chatHistory.slice(-20);
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(state.chats)); } catch (e) {}
}

function savePlan() {
  try {
    state.plan.date = todayStr(); // 每次保存都标记为「今天的计划」
    localStorage.setItem(PLAN_KEY, JSON.stringify(state.plan));
  } catch (e) {}
}

function loadChat() {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (raw) {
      const obj = JSON.parse(raw) || {};
      state.chats.awei = Array.isArray(obj.awei) ? obj.awei : [];
      state.chats.tao = Array.isArray(obj.tao) ? obj.tao : [];
    } else {
      // 旧版本迁移：v2 的单人历史归到阿伟
      const old = localStorage.getItem(CHAT_KEY_OLD);
      if (old) {
        const arr = JSON.parse(old);
        if (Array.isArray(arr)) state.chats.awei = arr;
      }
    }
  } catch (e) {}
  state.chatHistory = state.chats[state.coach] || [];
}

function loadPlan() {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    if (raw) {
      const p = JSON.parse(raw) || {};
      // 不是今天的计划（昨天或更早的数据）→ 直接清空
      const stale = p.date && p.date !== todayStr();
      state.plan = {
        date: todayStr(),
        workout: stale ? [] : (Array.isArray(p.workout) ? p.workout : []),
        cardio: stale ? [] : (Array.isArray(p.cardio) ? p.cardio : []),
        intake: stale ? [] : (Array.isArray(p.intake) ? p.intake : []),
      };
      if (stale) savePlan();
      // 旧数据里可能存着"8-12次"这类次数区间，一次性折叠成精准次数
      let migrated = stale;
      state.plan.workout.forEach((w) => {
        if (w && typeof w.reps === 'string') {
          const fixed = collapseRepRange(w.reps);
          if (fixed !== w.reps) { w.reps = fixed; migrated = true; }
        }
      });
      // 修复历史数据：份量为空却带着「用户已确认」标记的行，取消标记，让 AI 仍能自动补全
      state.plan.intake.forEach((r) => {
        if (r && r._edited && r._edited.qty && !String(r.qty || '').trim()) {
          delete r._edited.qty;
          migrated = true;
        }
      });
      if (migrated) savePlan();
    }
  } catch (e) {}
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) || {};
    state.gender = p.gender || '';
    state.age = p.age || 0;
    state.height = p.height || 0;
    state.weight = p.weight || 0;
    state.activity = p.activity || '';
    state.goal = p.goal || 'cut';
    state.nickname = p.nickname || '';
    state.avatar = p.avatar || '';
    state.coach = p.coach === 'tao' ? 'tao' : 'awei';
  } catch (e) {}
}

// 把已保存的资料回填到编辑表单
function fillProfileForm() {
  document.querySelectorAll('.seg-btn[data-gender]').forEach((b) => {
    b.classList.toggle('active', b.dataset.gender === state.gender);
  });
  $('age').value = state.age || '';
  $('height').value = state.height || '';
  $('weight').value = state.weight || '';
  $('activity').value = state.activity || '';
  const goalEdit = $('goal-edit');
  if (goalEdit) goalEdit.value = state.goal;
  renderCalcSummary();
}

// 更新编辑页的 BMI / 每日目标热量
function renderCalcSummary() {
  const bmi = $('calc-bmi');
  const target = $('calc-target');
  if (bmi) bmi.textContent = state.height && state.weight ? round(calcBMI(), 1) : '--';
  if (target) target.textContent = targetCalories() ? targetCalories() + ' kcal' : '-- kcal';
}

// ============ 页面切换（首页 / 计划 / 我的） ============
// 资料是否已完善（性别/年龄/身高/体重/活动水平都填了才放行）
const hasProfileComplete = () => !!(state.gender && state.age && state.height && state.weight && state.activity);

// 强制进入「我的资料」编辑页（作为第一步）
function openRequiredProfile() {
  $('mine-menu').classList.add('hide');
  $('mine-profile-detail').classList.remove('hide');
  $('mine-setting-detail').classList.add('hide');
  showProfileEdit();
}

function switchTab(tab) {
  // 资料未完善时，任何其他页面一律拦截，强制第一步去填资料
  if (tab !== 'mine' && !hasProfileComplete()) {
    openRequiredProfile();
    tab = 'mine';
  }
  document.querySelectorAll('.tab-content').forEach((c) => {
    c.classList.toggle('active', c.id === 'tab-' + tab);
  });
  // 底部菜单高亮
  document.querySelectorAll('.bot-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  // 离开首页：暂停首页视频自动连播，保持原位
  if (tab !== 'home') { if (window.__feedPause) window.__feedPause(); }
  // 回到首页保留原滑动位置，不上滚；其它页才置顶
  if (tab !== 'home') window.scrollTo(0, 0);
  if (tab === 'plan') {
    renderPlan();
    // 首页「找AI教练」等入口经入本页，只要聊天可见就把最新回复滚到底
    scrollChatToBottom();
  }
  if (tab === 'mine') renderProfileInfo();
  if (tab === 'supp') renderSuppView();   // 营养优选模块：进入时按上次状态渲染
  if (tab !== 'supp' && window.__aiOpen && window.__aiClose) window.__aiClose();   // 离开优选页时收起 AI 营养师浮层
  // 姿势跟练页：进入时刷新任务列表；离开时关掉摄像头（避免隐私指示灯常亮、耗电）
  if (tab === 'pose') { if (window.__poseEnter) window.__poseEnter(); }
  else if (window.__poseStop) window.__poseStop();
  // 进入计划页且停在AI教练子页时锁滚动；切到其它 tab 恢复滚动
  document.body.classList.toggle('coach-open', tab === 'plan' && state.subtab === 'coach');
}

// 聊天区滚动到底部（最新一条回复处）——多重时机兜底，确保 tab 显示后高度就绪
function scrollChatToBottom() {
  if (!chatLogEl) return;
  const go = () => { chatLogEl.scrollTop = chatLogEl.scrollHeight; };
  go();
  requestAnimationFrame(go);
  setTimeout(go, 120);
}

// 生成期间智能跟随：用户没上滑查看历史时才自动滚到底部；
// 用户一旦上滑，就不再打断他的浏览，但文字照常继续生成
function chatNearBottom() {
  if (!chatLogEl) return true;
  return chatLogEl.scrollHeight - chatLogEl.scrollTop - chatLogEl.clientHeight < 80;
}
function followChatBottom() {
  if (chatNearBottom()) chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

// 更新我的页头部信息
function renderWechatHeader() {
  const name = $('wpc-name');
  const sub = $('wpc-sub');
  const tagGoal = $('wpc-tag-goal');
  const tagAct = $('wpc-tag-act');
  const avatarIn = $('wpc-avatar-in');
  const hasProfile = state.gender && state.age && state.height && state.weight && state.activity;
  if (avatarIn) {
    avatarIn.innerHTML = state.avatar
      ? `<img src="${state.avatar}" alt="头像" />`
      : '<svg class="i"><use href="#i-user"/></svg>';
  }
  const defaultName = state.gender === 'female' ? '健身女孩' : '健身男孩';
  if (name) name.textContent = state.nickname || (hasProfile ? defaultName : '健身达人');
  if (sub) {
    sub.textContent = hasProfile
      ? `${state.height}cm · ${state.weight}kg · ${state.age}岁`
      : '点击「我的资料」填写信息';
  }
  const goalMap = { cut: '减脂', bulk: '增肌', sport: '运动表现' };
  const actMap = { '1.2': '久坐', '1.375': '轻度活动', '1.55': '中度活动', '1.725': '高度活动', '1.9': '极高活动' };
  if (tagGoal) tagGoal.textContent = state.goal ? goalMap[state.goal] : '未设置目标';
  if (tagAct) tagAct.textContent = state.activity ? actMap[state.activity] : '未设置活动';
}

// 展示"我的资料"
function renderProfileInfo() {
  renderWechatHeader();
  const info = $('profile-info');
  const empty = $('profile-empty');
  const hasProfile = state.gender && state.age && state.height && state.weight && state.activity;
  if (!hasProfile) {
    if (info) info.classList.add('hide');
    if (empty) empty.classList.remove('hide');
    return;
  }
  if (info) info.classList.remove('hide');
  if (empty) empty.classList.add('hide');
  const actMap = {
    '1.2': '久坐',
    '1.375': '轻度活动',
    '1.55': '中度活动',
    '1.725': '高度活动',
    '1.9': '极高活动',
  };
  const goalMap = { cut: '减脂', bulk: '增肌', sport: '运动表现' };
  const rows = [
    { k: '性别', v: state.gender === 'female' ? '女' : '男' },
    { k: '年龄', v: state.age + ' 岁' },
    { k: '身高', v: state.height + ' cm' },
    { k: '体重', v: state.weight + ' kg' },
    { k: '活动水平', v: actMap[state.activity] || state.activity },
    { k: '当前目标', v: goalMap[state.goal] || state.goal },
  ];
  info.innerHTML = rows.map((r) =>
    `<div class="pi-row"><span class="pi-k">${r.k}</span><span class="pi-v">${r.v}</span></div>`
  ).join('');
}

function renderHomeOverview() {
  // 资料完善后不再显示「完善资料」提示，未完善时显示
  const ovEdit = document.getElementById('ov-edit-btn');
  if (ovEdit) ovEdit.style.display = hasProfileComplete() ? 'none' : '';
  const target = targetCalories();
  // 只有打卡（完成）的条目才计入摄入 / 消耗
  const intake = sumDoneCal(state.plan.intake);
  const burn = sumDoneCal(state.plan.workout) + sumDoneCal(state.plan.cardio);
  if ($('ov-target')) $('ov-target').textContent = target || '--';
  if ($('ov-intake')) $('ov-intake').textContent = Math.round(intake);
  if ($('ov-burn')) $('ov-burn').textContent = Math.round(burn);
}

// 底部菜单点击
document.querySelectorAll('.bot-item').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// 首页快捷入口（带 data-goto / data-subtab）
document.querySelectorAll('[data-goto]').forEach((el) => {
  el.addEventListener('click', () => {
    const tab = el.dataset.goto;
    const subtab = el.dataset.subtab;
    switchTab(tab);
    if (subtab) switchSubtab(subtab);
  });
});

// ============ 第一页：校验 + 红色提示 ============
function validateProfile() {
  let valid = true;
  const age = parseFloat($('age').value);
  const height = parseFloat($('height').value);
  const weight = parseFloat($('weight').value);
  const activity = $('activity').value;

  if (!state.gender) {
    $('err-gender').textContent = '请选择性别';
    valid = false;
  } else {
    $('err-gender').textContent = '';
  }
  if (!age || age < 10 || age > 120) {
    $('err-age').textContent = age ? '年龄需在 10-120 岁' : '请填写年龄';
    valid = false;
  } else {
    $('err-age').textContent = '';
  }
  if (!height || height < 100 || height > 300) {
    $('err-height').textContent = height ? '身高需在 100-300 cm（不超过3米）' : '请填写身高';
    valid = false;
  } else {
    $('err-height').textContent = '';
  }
  if (!weight || weight < 30 || weight > 300) {
    $('err-weight').textContent = weight ? '体重需在 30-300 kg' : '请填写体重';
    valid = false;
  } else {
    $('err-weight').textContent = '';
  }
  if (!activity) {
    $('err-activity').textContent = '请选择日常活动水平';
    valid = false;
  } else {
    $('err-activity').textContent = '';
  }
  return valid;
}

// ============ 核心计算 ============
function calcBMR() {
  const { gender, weight, height, age } = state;
  const base = 10 * weight + 6.25 * height - 5 * age;
  return gender === 'female' ? base - 161 : base + 5;
}
function calcTDEE() { return calcBMR() * state.activity; }
function calcBMI() { const h = state.height / 100; return state.weight / (h * h); }

// 每日目标摄入热量
function targetCalories() {
  if (!state.activity || !state.age || !state.height || !state.weight) return 0;
  const tdee = calcTDEE();
  const factor = { cut: 0.8, bulk: 1.1, sport: 1.05 }[state.goal] || 1;
  return Math.round(tdee * factor);
}

function buildProfile() {
  return {
    nickname: state.nickname,
    gender: state.gender,
    age: state.age,
    height: state.height,
    weight: state.weight,
    activity: state.activity,
    bmi: state.height && state.weight ? round(calcBMI(), 1) : '',
    bmr: state.age && state.height && state.weight ? Math.round(calcBMR()) : '',
    tdee: state.age && state.height && state.weight && state.activity ? Math.round(calcTDEE()) : '',
  };
}

// ============ 第一页事件 ============
document.querySelectorAll('.seg-btn[data-gender]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.gender = btn.dataset.gender;
    document.querySelectorAll('.seg-btn[data-gender]').forEach((b) => b.classList.toggle('active', b.dataset.gender === state.gender));
    $('err-gender').textContent = '';
    saveProfile();
    renderCalcSummary();
  });
});

['age', 'height', 'weight'].forEach((id) => {
  $(id).addEventListener('input', (e) => {
    state[id] = parseFloat(e.target.value) || 0;
    $('err-' + id).textContent = '';
    saveProfile();
    renderCalcSummary();
  });
});

$('activity').addEventListener('change', (e) => {
  state.activity = e.target.value ? parseFloat(e.target.value) : '';
  $('err-activity').textContent = '';
  saveProfile();
  renderCalcSummary();
});

// ============ 我的页：菜单列表 / 详情页切换 ============
function showMineMenu() {
  $('mine-menu').classList.remove('hide');
  $('mine-profile-detail').classList.add('hide');
  $('mine-setting-detail').classList.add('hide');
}
document.querySelectorAll('.menu-row').forEach((row) => {
  row.addEventListener('click', () => {
    const target = row.dataset.mine;
    $('mine-menu').classList.add('hide');
    $('mine-profile-detail').classList.toggle('hide', target !== 'profile');
    $('mine-setting-detail').classList.toggle('hide', target !== 'setting');
    if (target === 'profile') showProfileDisplay();
  });
});
document.querySelectorAll('[data-mine-back]').forEach((btn) => {
  btn.addEventListener('click', showMineMenu);
});

// ============ 头部昵称行内编辑 ============
(function () {
  const nameEl = $('wpc-name');
  const input = $('wpc-name-input');
  const editIco = $('wpc-edit-name');

  function startEdit() {
    input.value = state.nickname || nameEl.textContent;
    nameEl.classList.add('hide');
    editIco.classList.add('hide');
    input.classList.remove('hide');
    input.focus();
    input.select();
  }
  function finishEdit(save) {
    if (save) {
      state.nickname = input.value.trim();
      saveProfile();
      renderWechatHeader();
    }
    input.classList.add('hide');
    nameEl.classList.remove('hide');
    editIco.classList.remove('hide');
  }
  editIco.addEventListener('click', startEdit);
  nameEl.addEventListener('click', startEdit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); }
    if (e.key === 'Escape') finishEdit(false);
  });
  input.addEventListener('blur', () => finishEdit(true));
})();

// ============ 头像上传（自动压缩到 256×256） ============
(function () {
  const avatarEl = $('wpc-avatar');
  const fileInput = $('avatar-input');
  const AVATAR_SIZE = 256; // 头像边长（px）

  avatarEl.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        // 居中正方形裁剪（cover）
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        // 原图较小则不放大，按原边长输出
        let out = canvas.toDataURL('image/jpeg', 0.85);
        if (side < AVATAR_SIZE) {
          const c2 = document.createElement('canvas');
          c2.width = side;
          c2.height = side;
          const c2ctx = c2.getContext('2d');
          c2ctx.fillStyle = '#fff';
          c2ctx.fillRect(0, 0, side, side);
          c2ctx.drawImage(img, sx, sy, side, side, 0, 0, side, side);
          out = c2.toDataURL('image/jpeg', 0.85);
        }
        state.avatar = out;
        saveProfile();
        renderWechatHeader();
      };
      img.onerror = () => alert('图片读取失败，请换一张试试');
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    fileInput.value = ''; // 允许再次选择同一文件
  });
})();

// ============ 我的资料：编辑 / 保存 / 取消 ============
function showProfileEdit() {
  fillProfileForm();
  $('profile-display').classList.add('hide');
  $('profile-edit').classList.remove('hide');
}

function showProfileDisplay() {
  $('profile-edit').classList.add('hide');
  $('profile-display').classList.remove('hide');
  renderProfileInfo();
}

$('edit-profile-btn').addEventListener('click', showProfileEdit);

$('cancel-edit-btn').addEventListener('click', () => {
  // 取消时丢弃本次编辑，从 localStorage 重新读取
  loadProfile();
  fillProfileForm();
  showProfileDisplay();
});

$('save-profile-btn').addEventListener('click', () => {
  if (validateProfile()) {
    state.goal = $('goal-edit').value;
    saveProfile();
    renderCaloriePanel();
    renderHomeOverview();
    showProfileDisplay();
  }
});

// 个人资料里的目标变化（计划页不再有目标下拉，统一在这里改）
$('goal-edit').addEventListener('change', (e) => {
  state.goal = e.target.value;
  saveProfile();
  renderCaloriePanel();
  renderCalcSummary();
});

function switchSubtab(name) {
  state.subtab = name;
  // 切子页先回到页面顶部：今日计划滑过之后切回，旧滚动位置会把 AI教练页整体顶偏
  window.scrollTo(0, 0);
  // AI教练子页整页锁滚动（只在聊天区内部滚）
  document.body.classList.toggle('coach-open', name === 'coach');
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.subtab === name);
  });
  document.querySelectorAll('.sub-content').forEach((c) => c.classList.toggle('active', c.id === 'subtab-' + name));
  if (name === 'plan') {
    $('plan-dot').classList.remove('show');
    renderPlan();
    // 回到今日计划且停在饮食视图时，顺手补一次缺份量的行
    if (planView === 'diet') state.plan.intake.forEach(queueQtyFill);
  }
  // 进入聊天子页时定位到最新一条回复
  if (name === 'coach') requestAnimationFrame(() => scrollChatToBottom());
}

// 顶部子菜单：阿伟教练 / 今日计划
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.subtab) switchSubtab(btn.dataset.subtab);
  });
});

// ============ 阿伟回复中的结构化数据解析 ============
// 从回复末尾剥离 [[PLAN]]...[[/PLAN]] 数据块，保证界面只显示干净文本
function extractPlanBlock(text) {
  if (!text) return { cleanText: '', data: null };

  // 1) 先剥离 ```json ... ``` 代码包裹（防止模型把 JSON 放进代码块）
  let cleaned = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, (m, inner) => inner.trim());

  // 2) 优先匹配带闭合标签的块
  let m = cleaned.match(/\[\[PLAN\]\]\s*([\s\S]*?)\[\[\/PLAN\]\]/i);
  let jsonStr = null;
  if (m) {
    jsonStr = m[1].trim();
    cleaned = cleaned.replace(m[0], '').trim();
  } else {
    // 3) 兜底：若只有起始标签没有闭合，从 [[PLAN]] 起全部切掉
    const startIdx = cleaned.search(/\[\[PLAN\]\]/i);
    if (startIdx >= 0) {
      jsonStr = cleaned.slice(startIdx).replace(/\[\[PLAN\]\]/i, '').trim();
      cleaned = cleaned.slice(0, startIdx).trim();
    }
  }

  // 4) 再次保险：任何残留的 [[PLAN]] 或 [[/PLAN]] 标记直接删掉
  cleaned = cleaned.replace(/\[\[\/?PLAN\]\]/gi, '').trim();

  let data = null;
  if (jsonStr) {
    // 去掉可能的 markdown 代码符号
    jsonStr = jsonStr.replace(/^```(?:json)?|```$/g, '').trim();
    try {
      data = JSON.parse(jsonStr);
    } catch (e) {
      // 兜底：提取第一个完整的 {...} JSON 对象（防止 AI 在 JSON 后加注释）
      const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try { data = JSON.parse(braceMatch[0]); } catch (_) { /* ignore */ }
      }
      if (!data) console.warn('阿伟的计划数据解析失败', e.message);
    }
  }
  return { cleanText: cleaned, data };
}

// 把"8-12次""8~12"这类次数区间折叠成单个精准数字（取中间值）
function collapseRepRange(v) {
  return String(v || '').replace(/(\d+)\s*(?:-|—|~|～|至|到)\s*(\d+)/g, (m, a, b) => String(Math.round((Number(a) + Number(b)) / 2)));
}

function normItem(x, numFields) {
  if (!x || typeof x !== 'object' || !x.name) return null;
  const item = { name: String(x.name).slice(0, 40) };
  numFields.forEach((f) => {
    item[f] = Number(x[f]) || 0;
  });
  // reps 是字符串（区间如"8-12次"折叠为精准次数）
  if ('reps' in x) item.reps = collapseRepRange(String(x.reps || '').slice(0, 12));
  // qty（食物份量/克数）也是字符串
  if ('qty' in x) item.qty = String(x.qty || '').slice(0, 16);
  return item;
}

function mergePlan(data) {
  let changed = false;
  if (Array.isArray(data.workout) && data.workout.length) {
    const rows = data.workout.map((x) => normItem(x, ['sets', 'cal'])).filter(Boolean).map((x) => ({
      name: x.name, sets: x.sets || 0, reps: x.reps || '', cal: x.cal || 0,
    }));
    if (rows.length) {
      // 保留已勾选的完成状态（同名项）
      const prev = state.plan.workout;
      state.plan.workout = rows.map((r) => {
        const old = prev.find((p) => p.name && p.name === r.name);
        return old && old.done ? Object.assign({}, r, { done: true }) : r;
      });
      changed = true;
    }
  }
  if (Array.isArray(data.cardio) && data.cardio.length) {
    const rows = data.cardio.map((x) => normItem(x, ['min', 'cal'])).filter(Boolean).map((x) => ({
      name: x.name, min: x.min || 0, cal: x.cal || 0,
    }));
    if (rows.length) {
      // 保留已勾选的完成状态（同名项）
      const prev = state.plan.cardio;
      state.plan.cardio = rows.map((r) => {
        const old = prev.find((p) => p.name && p.name === r.name);
        return old && old.done ? Object.assign({}, r, { done: true }) : r;
      });
      changed = true;
    }
  }
  if (Array.isArray(data.intake) && data.intake.length) {
    const rows = data.intake.map((x) => normItem(x, ['cal'])).filter(Boolean).map((x) => ({
      name: x.name, qty: x.qty || '', cal: x.cal || 0,
    }));
    if (rows.length) {
      // 教练新计划整体替换 intake，让列表总和与当日目标配平（防止旧食物残留叠加）；
      // 与力量/有氧一致，同名项保留已打卡状态
      const prev = state.plan.intake;
      state.plan.intake = rows.map((r) => {
        const old = prev.find((p) => p.name && p.name === r.name);
        // 教练数据块偶尔漏 qty：同名旧行已有份量时保留，不抹掉已显示的克数
        if (old && !r.qty && old.qty) {
          r.qty = old.qty;
          if (old.qtyUnit) r.qtyUnit = old.qtyUnit;
        }
        return old && old.done ? Object.assign({}, r, { done: true }) : r;
      });
      // 替换后仍缺份量的行，后台静默补齐
      state.plan.intake.forEach(queueQtyFill);
      changed = true;
    }
  }
  if (changed) {
    savePlan();
    renderPlan();
    if (state.subtab !== 'plan') $('plan-dot').classList.add('show');
  }
}

// ============ 今日计划：渲染 + 编辑 ============
function makeInput(value, { type = 'text', placeholder = '' } = {}) {
  const inp = document.createElement('input');
  inp.type = type;
  inp.value = value === 0 || value ? value : '';
  inp.placeholder = placeholder;
  return inp;
}

// ============ AI 补全 / 重算（生成组数·次数·大卡 / 份量·大卡） ============
// 规则：名字由用户填；数据字段凡是"用户已手动改过"的都保留，
// AI 只补全并重算那些用户没动过的字段。
const AI_FIELDS = {
  workout: { num: ['sets', 'cal'], text: ['reps'] },   // 组数 | 本次消耗大卡 | 每组次数
  cardio:  { num: ['min', 'cal'],  text: [] },          // 时长分钟 | 本次消耗大卡
  intake:  { num: ['cal'],         text: ['qty'] },     // 本次热量 | 份量/克数
};
const AI_UNIT = { sets: '组', reps: '次', cal: '大卡', min: '分钟', qty: '' };
const AI_DESC = { sets: '组数', reps: '每组次数', cal: '本次消耗大卡', min: '时长分钟', qty: '份量或克数' };

// 安全地从文本里截取 JSON 对象
function parseJsonBlock(text) {
  if (!text) return null;
  const f = text.indexOf('{');
  const l = text.lastIndexOf('}');
  if (f < 0 || l <= f) return null;
  try { return JSON.parse(text.slice(f, l + 1)); } catch (_) { return null; }
}
// 把用户个人资料整理成一句话，让 AI 给出更贴合的具体数值
function profileMeta() {
  const p = buildProfile();
  const g = state.goal === 'bulk' ? '增肌'
    : state.goal === 'cut' ? '减脂'
    : state.goal === 'sport' ? '提升运动表现'
    : '维持健康';
  return `用户：${p.nickname || ''}${p.gender === 'female' ? '女' : '男'}，${p.age || '?'}岁，${p.height || '?'}cm，${p.weight || '?'}kg，日常活动${p.activity || '?'}，目标：${g}（BMI ${p.bmi || '?'}，每日消耗约 ${p.tdee || '?'}大卡）。`;
}
// 根据当前行已有值 + 本轮要缺省的字段，拼出给 AI 的提示词（带明确 JSON 骨架）
function aiPromptFor(kind, row, wants) {
  const isFood = kind === 'intake';
  const name = ((row && row.name) || '').trim() || (isFood ? '这份食物' : '这个项目');
  const have = [];
  for (const k of AI_FIELDS[kind].num.concat(AI_FIELDS[kind].text)) {
    if (wants.includes(k)) continue; // 本轮要重算的字段，不当作"用户保留值"告诉 AI
    const v = row && row[k];
    if (v && Number(v) > 0) have.push(AI_DESC[k] + '=' + v + (AI_UNIT[k] || ''));
  }
  // 只放本轮要补的字段，给出带空值的 JSON 模板，让 AI 只填这几个键、绝不改其它
  const skel = {};
  for (const k of wants) skel[k] = (k === 'qty' ? '' : 0);
  const needStr = wants.map((k) => '“' + (AI_DESC[k] || k) + '”').join('、');
  return `${profileMeta()} 请为${isFood ? '食物' : '训练项目'}“${name}”${
    have.length ? '（已填：' + have.join('、') + '，这些是用户保留的数值，请保持它们不变）' : ''
  }补全/重算：${needStr}。结合以上用户资料，直接用整数估算这些数值。对力量训练的每组次数（reps），必须给单个精准次数，禁止"8-12"这类区间写法；如果是动态动作（如深蹲、卧推、俯卧撑）就带单位"次"，如果是静态支撑动作（如平板支撑、侧平板、靠墙静蹲）就带单位"秒"。计算"本次消耗大卡（cal）"时必须用统一的规则：先估算该动作每组每次（每组每秒）消耗的卡路里数，再乘以组数，得到的结果取整填入 cal —— 同样的组数和次数必须算出相同的大卡。只返回下面这一个JSON对象：把每个字段的值换成你根据该食物/动作重新估算的真实数值（严禁照抄模板，份量必须是具体量，可带"克、毫升、个、碗"等单位；其余数字不带单位），不要其它任何文字、代码块或解释：${JSON.stringify(skel)}`;
}

// AI 补全任务队列：逐个串行执行，批量补全也不会丢；
// 用户刚编辑的行插到队首优先补（同一行只排一次）
let aiQueue = [];
let aiBusy = false;
function queueFill(kind, row, only, front) {
  if (!row) return;
  const i = aiQueue.findIndex((q) => q.row === row);
  if (i >= 0) {
    if (!front) return;           // 同一行已在排队，不重复
    aiQueue.splice(i, 1);         // 用户刚改过的行：提到队首
  }
  const job = { kind, row, only: only || null };
  if (front) aiQueue.unshift(job); else aiQueue.push(job);
  pumpFill();
}
async function pumpFill() {
  if (aiBusy) return;
  aiBusy = true;
  try {
    while (aiQueue.length) {
      const job = aiQueue.shift();
      let ok = false;
      try { ok = await doAiFill(job.kind, job.row, job.only); }
      catch (_) { ok = false; /* 失败静默，用户可手填 */ }
      // 补全失败（网络抖动、模型忙）且该行仍缺份量：放开去重标记并限次自动重试
      if (!ok && job.kind === 'intake' && !String(job.row.qty || '').trim()) {
        qtyFillAsked.delete(job.row);
        retryQtyFillLater(job.row);
      }
    }
  } finally { aiBusy = false; }
}
function scheduleFill(kind, idx) {
  setTimeout(() => {
    const row = state.plan[kind] && state.plan[kind][idx];
    if (row) queueFill(kind, row, null, true);
  }, 200);
}
// 只补「份量/克数」：教练回传的数据块偶尔漏 qty，历史数据也可能缺失；
// 同一行一次只申请一次（WeakSet 去重）；补全失败限次自动重试，网络抖动后无需重开也能补上
const qtyFillAsked = new WeakSet();
const qtyRetryCount = new WeakMap();
function retryQtyFillLater(row) {
  const n = qtyRetryCount.get(row) || 0;
  if (n >= 3) return; // 最多重试 3 次，避免无网时反复空转
  qtyRetryCount.set(row, n + 1);
  setTimeout(() => queueQtyFill(row), n === 0 ? 15000 : 60000);
}
function queueQtyFill(row) {
  if (!row || !row.name) return;
  if (!state.plan.intake.includes(row)) return; // 行已被新一轮计划替换，跳过
  if (String(row.qty || '').trim()) return;
  if (row._edited && row._edited.qty) return;
  if (qtyFillAsked.has(row)) return;
  qtyFillAsked.add(row);
  queueFill('intake', row, ['qty']);
}
async function doAiFill(kind, row, onlyKeys) {
  const spec = AI_FIELDS[kind];
  const edited = row._edited || {};
  // 需要 AI 填的 = 该类型全部数据字段 中 用户没动过的；onlyKeys 表示只补指定字段（如只补份量）
  const wants = (onlyKeys || spec.num.concat(spec.text)).filter((k) => !edited[k]);
  if (!wants.length) return true; // 都已是用户确认的值，不打扰
  // 超时保护：单次补全最长 20 秒，避免卡住的连接把整个补全队列堵死
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let fullRaw = '';
  let obj = null;
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        profile: buildProfile(),
        goal: state.goal,
        coach: state.coach,
        mode: 'fill', // 轻量补全模式：服务端用极简提示词，回复短、速度快
        messages: [{ role: 'user', content: aiPromptFor(kind, row, wants) }],
      }),
    });
    const ct = resp.headers.get('Content-Type') || '';
    if (ct.includes('text/event-stream')) {
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = chunk.split('\n').find((l) => l.indexOf('data:') === 0);
          if (!line) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') break;
          let o; try { o = JSON.parse(data); } catch (_) { continue; }
          if (o.t) fullRaw += o.t;
        }
        // 增量解析：JSON 一凑齐就立即采用并取消流，
        // 不再傻等长回复结束——连接中途断开也不会丢结果
        const early = parseJsonBlock(fullRaw);
        if (early && wants.every((k) => k in early)) {
          obj = early;
          try { reader.cancel(); } catch (_) {}
          break;
        }
      }
    } else {
      const j = await resp.json();
      fullRaw = (j && j.reply) || '';
    }
  } finally {
    clearTimeout(timer);
  }
  if (!obj) obj = parseJsonBlock(fullRaw);
  if (!obj) return false; // 没拿到可解析结果：视作失败，交由队列安排重试
  let changed = false;
  for (const k of Object.keys(obj)) {
    if (!wants.includes(k)) continue;      // 只写本轮要补的字段
    if (spec.num.includes(k)) {
      const n = Math.round(Number(obj[k]));
      if (isFinite(n) && n >= 0 && row[k] !== n) { row[k] = n; changed = true; }
    } else if (spec.text.includes(k)) {
      let v = String(obj[k] || '').trim();
      if (k === 'qty' && /^(1|1份|1份量)$/.test(v)) continue; // 照抄模板的占位值：视作无效，留待重试
      // 识别 AI 值末尾的单位（次/秒/分钟），存为该行的专属单位，并从值中剥掉
      if (k === 'reps' || k === 'qty') {
        const m = v.match(/(次|秒|分钟|分|克|g|份|碗|个|只|杯|ml|毫升)\s*$/i);
        if (m) { row[k + 'Unit'] = m[1]; v = v.replace(/(次|秒|分钟|分|克|g|份|碗|个|只|杯|ml|毫升)\s*$/i, ''); }
      } else if (AI_UNIT[k]) {
        v = v.replace(new RegExp(AI_UNIT[k] + '\\s*$'), '');
      }
      if (k === 'reps') v = collapseRepRange(v); // AI 若仍返回区间，兜底折叠为精准次数
      if (v && row[k] !== v) { row[k] = v; changed = true; }
    }
  }
  if (changed) { savePlan(); renderPlan(); renderCaloriePanel(); }
  return changed;
}

function renderList(containerId, emptyId, rows, rowClass, columns, kind) {
  const box = $(containerId);
  box.innerHTML = '';
  $(emptyId).classList.toggle('hide', rows.length > 0);

  rows.forEach((row, idx) => {
    if (!row._edited) row._edited = {};   // 记录用户手动改过的字段
    const el = document.createElement('div');
    el.className = 'plan-row ' + rowClass + (row.done ? ' row-done' : '');

    // 完成打卡按钮
    const check = document.createElement('button');
    check.className = 'row-check' + (row.done ? ' checked' : '');
    check.title = row.done ? '已完成' : '标记为已完成';
    check.innerHTML = '<svg class="i"><use href="#i-check"/></svg>';
    check.addEventListener('click', () => {
      const cur = state.plan[kind][idx];
      if (cur.done) {
        // 已完成项：再次点击 = 取消完成（默认弹窗确认，可在设置里关闭）
        const doCancel = () => {
          cur.done = false;
          savePlan();
          el.classList.remove('row-done');
          check.classList.remove('checked');
          check.title = '标记为已完成';
          renderCompletion();
          renderCaloriePanel();
          refreshNutriPanels();
          renderHomeOverview();
        };
        if (localStorage.getItem(CONFIRM_CANCEL_KEY) === '0') {
          doCancel(); // 设置里已关闭确认弹窗，直接取消
        } else {
          askCancelDone(doCancel); // 弹出"是否取消完成"确认
        }
        return;
      }
      cur.done = true;
      savePlan();
      el.classList.add('row-done');
      check.classList.add('checked');
      check.title = '已完成';
      renderCompletion();
      renderCaloriePanel();
      refreshNutriPanels();
      renderHomeOverview();
    });
    el.appendChild(check);

    columns.forEach((col) => {
      let cellValue = row[col.key];
      let cellUnit = row[col.key + 'Unit'] || col.unit;
      // 兜底：值里若自带单位文字（AI教练计划直接写入的历史数据），剥出来当显示单位，
      // 避免输入框内容与常驻单位后缀重复（如 "10次" + "次" = "10次 次"）
      if ((col.key === 'reps' || col.key === 'qty') && typeof cellValue === 'string') {
        const um = cellValue.match(/(次|秒|分钟|分|克|g|份|碗|个|只|杯|ml|毫升)\s*$/i);
        if (um) { cellUnit = um[1]; cellValue = cellValue.slice(0, um.index).trim(); }
      }
      const inp = makeInput(cellValue, {
        type: col.type || 'text',
        placeholder: col.placeholder || '',
      });
      if (col.type === 'number') inp.classList.add('cell-num');
      inp.addEventListener('input', () => {
        state.plan[kind][idx][col.key] = col.type === 'number'
          ? (parseFloat(inp.value) || 0)
          : inp.value;
        savePlan();
        renderCaloriePanel();
        refreshNutriPanels();
      });
      // 聚焦时记录原值，用于判断是否真的改过
      inp.addEventListener('focus', () => { inp.dataset.orig = inp.value; });
      // 失焦确认编辑：真改过才算数。改名→清掉编辑标记让 AI 全算；改数据→保留该用户值，只重算其余字段
      inp.addEventListener('change', () => {
        if (inp.value === (inp.dataset.orig || '')) return; // 没真正改动，不触发
        const cur = state.plan[kind][idx];
        if (col.key === 'name') {
          cur._edited = {};               // 名字变了，AI 重算全部数据字段
        } else if (String(inp.value || '').trim()) {
          cur._edited[col.key] = true;    // 这个字段是用户确认过的，AI 不再动它
        } else {
          delete cur._edited[col.key];    // 用户清空了该字段：取消标记，AI 仍可自动补全
        }
        scheduleFill(kind, idx);
      });
      // 数字列：输入框内带常驻单位后缀（组 / 分钟 / 大卡）
      if (col.unit) {
        const wrap = document.createElement('span');
        wrap.className = 'cell-unit-wrap';
        const unit = document.createElement('span');
        unit.className = 'cell-unit';
        // 次数等单位可按行覆盖（静态动作用「秒」），行级 unit/值内单位 优先于列级默认
        unit.textContent = cellUnit;
        wrap.appendChild(inp);
        wrap.appendChild(unit);
        el.appendChild(wrap);
      } else {
        el.appendChild(inp);
      }
    });

    const del = document.createElement('button');
    del.className = 'row-del';
    del.textContent = '×';
    del.title = '删除';
    del.addEventListener('click', () => {
      state.plan[kind].splice(idx, 1);
      savePlan();
      renderPlan();
    });
    el.appendChild(del);
    box.appendChild(el);
  });
}

function renderCaloriePanel() {
  const target = targetCalories();
  // 只有打卡（完成）的条目才计入摄入 / 消耗
  const intake = sumDoneCal(state.plan.intake);
  const burn = sumDoneCal(state.plan.workout) + sumDoneCal(state.plan.cardio);

  $('cal-target').textContent = target || '--';
  $('cal-intake').textContent = Math.round(intake);
  $('cal-burn').textContent = Math.round(burn);

  const ring = $('ring-fg');
  const ringPct = $('ring-pct');
  const text = $('cal-progress-text');

  if (!target) {
    if (ring) ring.style.strokeDashoffset = '100';
    if (ringPct) ringPct.textContent = '0%';
    if (text) text.textContent = '请先完善个人资料';
    return;
  }
  const ratio = intake / target;
  const pct = Math.min(100, Math.round(ratio * 100));
  const over = intake > target;
  if (ring) {
    ring.style.strokeDashoffset = String(100 - Math.min(100, ratio * 100));
    ring.style.stroke = over ? '#f0443e' : '#16a34a';
  }
  if (ringPct) ringPct.textContent = pct + '%';

  if (intake === 0) {
    text.textContent = state.plan.intake.length
      ? `今天目标 ${target} kcal，食物打卡后计入摄入`
      : `今天目标 ${target} kcal，还未记录饮食`;
  } else {
    const diff = target - intake;
    text.textContent = diff >= 0
      ? `已摄入 ${pct}%，还可吃约 ${Math.round(diff)} kcal`
      : `已超出约 ${Math.round(-diff)} kcal，注意控制哦`;
  }
}

// 今日完成度：只统计训练面板（力量训练 + 有氧/拉伸）的勾选进度
function renderCompletion() {
  const lists = [state.plan.workout, state.plan.cardio];
  let total = 0;
  let done = 0;
  lists.forEach((list) => list.forEach((r) => { total += 1; if (r.done) done += 1; }));
  const pct = total ? Math.round((done / total) * 100) : 0;

  const pctEl = $('done-pct');
  const ring = $('done-ring-fg');
  const txt = $('done-text');
  if (pctEl) pctEl.textContent = pct + '%';
  if (ring) ring.style.strokeDashoffset = String(100 - pct);
  if (txt) {
    if (!total) txt.textContent = '还没有计划项，添加一行或问问教练';
    else if (done === total) txt.textContent = `已完成 ${done}/${total} 项，今日目标全部达成！`;
    else txt.textContent = `已完成 ${done}/${total} 项，点每行左侧圆圈打卡`;
  }
}

function renderPlan() {
  renderList('workout-list', 'workout-empty', state.plan.workout, '', [
    { key: 'name', placeholder: '动作名称（如平板卧推）' },
    { key: 'sets', type: 'number', unit: '组' },
    { key: 'reps', placeholder: '次/时长', unit: '次' },
    { key: 'cal', type: 'number', unit: '大卡' },
  ], 'workout');

  renderList('cardio-list', 'cardio-empty', state.plan.cardio, 'row-cardio', [
    { key: 'name', placeholder: '项目（如慢跑）' },
    { key: 'min', type: 'number', unit: '分钟' },
    { key: 'cal', type: 'number', unit: '大卡' },
  ], 'cardio');

  renderList('intake-list', 'intake-empty', state.plan.intake, 'row-intake', [
    { key: 'name', placeholder: '食物名称' },
    { key: 'qty', placeholder: '份量/克数' },
    { key: 'cal', type: 'number', unit: '大卡' },
  ], 'intake');

  renderCaloriePanel();
  renderCompletion();
  refreshNutriPanels();
}

// 添加空白行
document.querySelectorAll('.add-row-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.add;
    if (kind === 'workout') state.plan.workout.push({ name: '', sets: 0, reps: '', cal: 0 });
    if (kind === 'cardio') state.plan.cardio.push({ name: '', min: 0, cal: 0 });
    if (kind === 'intake') state.plan.intake.push({ name: '', qty: '', cal: 0 });
    savePlan();
    renderPlan();
  });
});

// ============ 聊天 ============
const chatLogEl = $('chat-log');
const inputEl = $('today-input');
const sendBtn = $('send-btn');
// 空状态节点引用：切教练时该节点可能脱离文档，getElementById 取不到
const ceSubEl = $('ce-sub');
const chipsEl = $('quick-chips');

// ---- 教练切换 ----
let toastTimer = null;
function showCoachToast(text) {
  const t = $('coach-toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

function applyCoachChrome() {
  const c = COACHES[state.coach];
  const root = $('subtab-coach');
  root.classList.toggle('coach-female', state.coach === 'tao');
  root.style.setProperty('--coach-img', `url("${c.img}")`);
  root.style.setProperty('--coach-accent', state.coach === 'tao' ? '#6b66c9' : '#ff5a1f');
  const heroImg = $('ch-avatar-img');
  const ceImg = $('ce-avatar-img');
  if (heroImg) heroImg.src = c.img;
  if (ceImg) ceImg.src = c.img;
  const name = $('ch-name');
  const status = $('ch-status-text');
  const greeting = $('ce-title');
  if (name) name.textContent = c.name;
  if (status) status.textContent = c.status;
  if (greeting) greeting.textContent = c.greeting;
  const tagsBox = $('ch-tags');
  if (tagsBox) {
    tagsBox.textContent = '';
    c.tags.forEach((t) => {
      const s = document.createElement('span');
      s.textContent = t;
      tagsBox.appendChild(s);
    });
  }
  const sub = ceSubEl;
  if (sub) sub.textContent = c.emptySub;
  if (inputEl) inputEl.placeholder = c.placeholder;
  const chipsBox = chipsEl;
  if (chipsBox) {
    chipsBox.textContent = '';
    c.chips.forEach(([q, label]) => {
      const b = document.createElement('button');
      b.className = 'quick-chip';
      b.dataset.q = q;
      b.textContent = label;
      chipsBox.appendChild(b);
    });
  }
}

function switchCoach(key) {
  if (!COACHES[key] || key === state.coach) return;
  if (state.sending) return;
  saveChat();
  state.coach = key;
  state.chatHistory = state.chats[key] || (state.chats[key] = []);
  saveProfile();
  applyCoachChrome();
  renderHistory();
  showCoachToast('已切换到' + COACHES[key].name);
}

$('coach-switch').addEventListener('click', () => {
  switchCoach(state.coach === 'awei' ? 'tao' : 'awei');
});
applyCoachChrome();

// 安全地创建气泡（不用 innerHTML，防止注入）
// keepScroll=true 时智能跟随：用户已上滑浏览历史就不强制拉回底部
function appendMsg(role, text, extraClass, keepScroll) {
  const empty = $('chat-empty');
  if (empty && empty.parentNode) empty.parentNode.removeChild(empty);
  const msg = document.createElement('div');
  msg.className = 'msg ' + role + (extraClass ? ' ' + extraClass : '');
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  msg.appendChild(bubble);
  chatLogEl.appendChild(msg);
  if (keepScroll) followChatBottom();
  else chatLogEl.scrollTop = chatLogEl.scrollHeight;
  return msg;
}

function appendTyping() {
  const msg = document.createElement('div');
  msg.className = 'msg coach loading';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
  msg.appendChild(bubble);
  chatLogEl.appendChild(msg);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
  return msg;
}

function renderHistory() {
  const empty = $('chat-empty');
  chatLogEl.innerHTML = '';
  if (state.chatHistory.length === 0) {
    if (empty) chatLogEl.appendChild(empty);
    return;
  }
  state.chatHistory.forEach((m) => {
    const text = m.role === 'assistant' ? extractPlanBlock(m.content).cleanText : m.content;
    if (text) appendMsg(m.role === 'user' ? 'user' : 'coach', text);
  });
  scrollChatToBottom();
}

// ============ 生成期间「发送按钮」变暂停按钮 ============
// 空闲：显示发送图标，点一下发送；
// 生成中：图标变为暂停 ⏸，点一下立刻中断这次 AI 生成（中止网络请求），之后恢复发送。
let abortCtrl = null;   // 当前生成的网络请求控制器
let genCancel = false;  // 当前生成是否被用户中断
function setSendIcon(mode) {
  const use = sendBtn.querySelector('use');
  if (!use) return;
  if (mode === 'send') {
    use.setAttribute('href', '#i-send');
    sendBtn.classList.remove('sending');
    sendBtn.title = '发送';
  } else {
    use.setAttribute('href', '#i-pause');
    sendBtn.classList.add('sending');
    sendBtn.title = '暂停生成';
  }
}
// 在 bubble 上逐字显示 text，全部显示完时回调 onDone；中断时立即结束并回调。
function startTypewriter(bubble, text, onDone) {
  let idx = 0;
  const tick = () => {
    if (genCancel) {         // 用户点了暂停 → 直接收尾
      clearInterval(timer);
      const cb = onDone; onDone = null; if (cb) cb();
      return;
    }
    idx = Math.min(text.length, idx + 2);
    bubble.textContent = text.slice(0, idx);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
    if (idx >= text.length) {
      clearInterval(timer);
      const cb = onDone; onDone = null; if (cb) cb();
    }
  };
  const timer = setInterval(tick, 40);
}

async function sendMessage() {
  if (state.sending) return;
  // 资料未完善：不允许使用，强制回「我的资料」第一步
  if (!hasProfileComplete()) { switchTab('mine'); return; }
  const text = inputEl.value.trim();
  if (!text) { inputEl.focus(); return; }

  appendMsg('user', text);
  state.chatHistory.push({ role: 'user', content: text });
  inputEl.value = '';
  saveChat();

  state.sending = true;
  genCancel = false;
  abortCtrl = new AbortController();
  setSendIcon('pause');           // 发送按钮 → 暂停按钮
  const typingEl = appendTyping();

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortCtrl.signal,   // 支持中断
      body: JSON.stringify({
        profile: buildProfile(),
        goal: state.goal,
        coach: state.coach,
        messages: state.chatHistory,
      }),
    });
    typingEl.remove();
    if (genCancel) return;        // 用户在等待响应首块时点了暂停

    const ct = resp.headers.get('Content-Type') || '';
    // 极端情况：服务端未走 SSE（如被代理/旧服务），退化为一次性 JSON 兼容
    if (!ct.includes('text/event-stream')) {
      const data = await resp.json();
      if (!resp.ok || !data.reply) throw new Error(data.error || '阿伟暂时不在线，稍后再试');
      const { cleanText, data: planData } = extractPlanBlock(data.reply);
      const finalText = cleanText || data.reply;
      if (finalText) appendMsg('coach', finalText);
      state.chatHistory.push({ role: 'assistant', content: data.reply });
      saveChat();
      if (planData) mergePlan(planData);
      return;
    }

    // 流式：边收边逐字显示，感知上立即开始输出
    // keepScroll=true：等待期间用户若上滑看历史，新回复不抢回视口底部，文字照常在下方继续生成
    const msg = appendMsg('coach', '', undefined, true);
    const bubble = msg.querySelector('.bubble');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let sseBuf = '';
    let fullRaw = '';      // 完整原文（含 [[PLAN]] 数据块），用于历史存储
    let dispAcc = '';      // 界面显示文本（已剔除数据块）
    let planData = null;
    let ended = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) { reader.releaseLock(); break; }
      sseBuf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = sseBuf.indexOf('\n\n')) >= 0) {
        const evt = sseBuf.slice(0, idx);
        sseBuf = sseBuf.slice(idx + 2);
        if (!evt) continue;
        const dline = evt.split('\n').find((l) => l.startsWith('data:'));
        if (!dline) continue;
        const data = dline.slice(5).trim();
        if (data === '[DONE]') { ended = true; break; }
        let o;
        try { o = JSON.parse(data); } catch (_) { continue; }
        if (o.error) throw new Error(o.error);
        if (o.t) {
          fullRaw += o.t;
          dispAcc = extractPlanBlock(fullRaw).cleanText || fullRaw;
          bubble.textContent = dispAcc || '…';
          followChatBottom();   // 用户上滑浏览时不再强制拉回底部，文字继续生成
        } else if (o.plan) {
          planData = o.plan;
        }
      }
      if (ended) break;
    }

    if (genCancel) return;        // 流式读取中被暂停
    bubble.textContent = dispAcc;
    state.chatHistory.push({ role: 'assistant', content: fullRaw });
    saveChat();
    if (planData) mergePlan(planData);
  } catch (e) {
    typingEl.remove();
    if (e.name === 'AbortError') {
      // 用户主动暂停，不算错误
      appendMsg('coach', '已暂停本次生成', 'muted');
    } else {
      const tip = e.message.includes('Failed to fetch')
        ? '连不上服务器！记得用 node server.js 启动，别直接双击 html。'
        : e.message;
      appendMsg('coach', '连接异常：' + tip, 'error');
    }
  } finally {
    state.sending = false;
    abortCtrl = null;
    genCancel = false;
    setSendIcon('send');          // 暂停按钮 → 发送按钮
    inputEl.focus();
  }
}

// 发送按钮：空闲发送；生成中变暂停，点击即中断
sendBtn.addEventListener('click', () => {
  if (state.sending) {
    genCancel = true;
    if (abortCtrl) abortCtrl.abort();
    return;
  }
  sendMessage();
});

// 快捷提问胶囊：点击直接发送
chatLogEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.quick-chip');
  if (!chip) return;
  inputEl.value = chip.dataset.q;
  sendMessage();
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage();
  }
});

// ============ PWA ============
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker?.register('sw.js').catch(() => {}); });
}

// ============ 初始化：默认空白，停留在第一页 ============
// 清理旧版本残留的 localStorage 数据
try {
  ['zhidong_chat_v1', 'zhidong_plan_v1'].forEach((k) => localStorage.removeItem(k));
} catch (e) {}
loadProfile();
loadChat();
loadPlan();
// 「份量/克数」缺失的行（教练漏字段 / 历史数据）：启动后静默补齐
state.plan.intake.forEach(queueQtyFill);

// ============ 取消完成确认弹窗（可在设置里关闭） ============
const CONFIRM_CANCEL_KEY = 'zhidong_confirm_cancel_v1';
let cancelDoneCb = null;
function askCancelDone(cb) {
  cancelDoneCb = cb;
  const mask = document.getElementById('cancel-done-mask');
  if (mask) mask.classList.remove('hide');
}
function closeAskCancelDone() {
  const mask = document.getElementById('cancel-done-mask');
  if (mask) mask.classList.add('hide');
  cancelDoneCb = null;
}
(function initCancelDone() {
  const mask = document.getElementById('cancel-done-mask');
  if (!mask) return;
  const yes = document.getElementById('cancel-done-yes');
  const no = document.getElementById('cancel-done-no');
  yes.addEventListener('click', () => {
    const cb = cancelDoneCb;
    closeAskCancelDone();
    if (cb) cb(); // 确认取消完成
  });
  no.addEventListener('click', closeAskCancelDone);
  mask.addEventListener('click', (e) => { if (e.target === mask) closeAskCancelDone(); });
  // 设置开关：控制是否弹确认框。默认开启。key 为 '0' 表示关闭弹窗（直接取消）。
  const toggle = document.getElementById('confirm-cancel-toggle');
  if (toggle) {
    toggle.checked = localStorage.getItem(CONFIRM_CANCEL_KEY) !== '0';
    toggle.addEventListener('change', () => {
      localStorage.setItem(CONFIRM_CANCEL_KEY, toggle.checked ? '1' : '0');
    });
  }
})();

// ============ 深色模式：跟随系统 / 浅色 / 深色 ============
const THEME_KEY = 'zhidong_theme_v1';
const darkMQ = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(pref) {
  const resolved = (pref === 'dark' || pref === 'light')
    ? pref
    : (darkMQ && darkMQ.matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', resolved);
  const sel = document.getElementById('theme-select');
  if (sel) sel.value = (pref === 'auto' || pref === 'light' || pref === 'dark') ? pref : 'auto';
}
// 系统深浅色变化时，仅在用户处于「跟随系统」时自动切换
if (darkMQ) darkMQ.addEventListener('change', () => {
  const pref = localStorage.getItem(THEME_KEY) || 'auto';
  if (pref === 'auto') applyTheme('auto');
});
const curTheme = localStorage.getItem(THEME_KEY) || 'auto';
applyTheme(curTheme);
const themeSel = document.getElementById('theme-select');
if (themeSel) themeSel.addEventListener('change', () => {
  localStorage.setItem(THEME_KEY, themeSel.value);
  applyTheme(themeSel.value);
});

// ============ 首次登录引导页（onboarding） ============
(function () {
  const ob = $('ob');
  if (!ob) return;
  const STEPS = 5;
  const steps = Array.from(ob.querySelectorAll('.ob-step'));
  const dots = Array.from(ob.querySelectorAll('.ob-dot'));
  let step = 0;

  const actMap = {
    '1.2': '久坐', '1.375': '轻度活动', '1.55': '中度活动', '1.725': '高度活动', '1.9': '极高活动',
  };
  const goalMap = { cut: '减脂', bulk: '增肌', sport: '运动表现' };

  function setErr(id, msg) {
    const e = $(id);
    if (!e) return;
    e.textContent = msg || '';
  }
  function setStep(n) {
    step = Math.max(0, Math.min(STEPS - 1, n));
    steps.forEach((s, i) => s.classList.toggle('active', i === step));
    dots.forEach((d, i) => d.classList.toggle('active', i <= step));
    $('ob-prev').classList.toggle('hide', step === 0);
    $('ob-next').textContent = step === STEPS - 1 ? '开始使用' : '下一步';
    if (step === 4) renderObSummary();
    if (step === 1) renderBmi();
    $('ob-body').scrollTop = 0;
  }
  function validate() {
    if (step === 0) {
      let ok = true;
      if (!state.nickname) { setErr('ob-err-name', '请填写昵称'); ok = false; }
      if (!state.gender) { setErr('ob-err-gender', '请选择性别'); ok = false; }
      return ok;
    }
    if (step === 1) {
      let ok = true;
      const h = state.height >= 120 && state.height <= 230;
      const w = state.weight >= 30 && state.weight <= 300;
      setErr('ob-err-height', h ? '' : '请填写有效身高'); if (!h) ok = false;
      setErr('ob-err-weight', w ? '' : '请填写有效体重'); if (!w) ok = false;
      return ok;
    }
    if (step === 2) {
      let ok = true;
      const a = state.age >= 10 && state.age <= 120;
      setErr('ob-err-age', a ? '' : '请填写有效年龄'); if (!a) ok = false;
      setErr('ob-err-activity', state.activity ? '' : '请选择活动水平'); if (!state.activity) ok = false;
      return ok;
    }
    if (step === 3) {
      setErr('ob-err-goal', state.goal ? '' : '请选择一个健身目标');
      return !!state.goal;
    }
    return true;
  }
  function renderBmi() {
    const el = $('ob-bmi');
    if (el) el.textContent = state.height && state.weight ? round(calcBMI(), 1) : '--';
  }
  function renderObSummary() {
    const s = $('ob-summary');
    if (!s) return;
    const rows = [
      ['性别', state.gender === 'female' ? '女' : '男'],
      ['年龄', state.age + ' 岁'],
      ['身高', state.height + ' cm'],
      ['体重', state.weight + ' kg'],
      ['活动', actMap[state.activity] || '--'],
      ['目标', goalMap[state.goal] || '--'],
    ];
    s.innerHTML = rows.map((r) =>
      `<span class="ob-sum-row"><b>${r[0]}</b><em>${r[1]}</em></span>`
    ).join('');
    const tc = targetCalories();
    const t = $('ob-target-cal');
    if (t) t.textContent = tc ? tc + ' 大卡' : '--';
  }

  // 输入监听：写回 state（与编辑表单一致）
  $('ob-name').addEventListener('input', (e) => {
    state.nickname = e.target.value; setErr('ob-err-name', ''); saveProfile();
  });
  ob.querySelectorAll('.ob-gender').forEach((b) => b.addEventListener('click', () => {
    state.gender = b.dataset.gender;
    ob.querySelectorAll('.ob-gender').forEach((x) => x.classList.toggle('active', x.dataset.gender === state.gender));
    setErr('ob-err-gender', ''); saveProfile();
  }));
  ['age', 'height', 'weight'].forEach((k) => {
    const el = $('ob-' + k);
    el.addEventListener('input', () => {
      state[k] = parseFloat(el.value) || 0;
      setErr('ob-err-' + k, ''); saveProfile();
      if (k === 'height' || k === 'weight') renderBmi();
    });
  });
  $('ob-activity').addEventListener('change', (e) => {
    state.activity = e.target.value ? parseFloat(e.target.value) : '';
    setErr('ob-err-activity', ''); saveProfile();
  });
  ob.querySelectorAll('.ob-goal').forEach((g) => g.addEventListener('click', () => {
    state.goal = g.dataset.goal;
    ob.querySelectorAll('.ob-goal').forEach((x) => x.classList.toggle('active', x.dataset.goal === state.goal));
    setErr('ob-err-goal', ''); saveProfile(); renderObSummary();
  }));

  // 头像上传（可选）
  const avBtn = $('ob-avatar-btn');
  const avIn = $('ob-avatar-in');
  const avInput = $('ob-avatar-input');
  if (avBtn && avInput) {
    avBtn.addEventListener('click', () => avInput.click());
    avInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f || !/^image\//.test(f.type)) return;
      const rd = new FileReader();
      rd.onload = () => {
        state.avatar = rd.result; saveProfile();
        if (avIn) avIn.innerHTML = `<img src="${state.avatar}" alt="头像" />`;
      };
      rd.readAsDataURL(f);
    });
  }

  // 回填已保存的初始值（如有）
  $('ob-name').value = state.nickname;
  ob.querySelectorAll('.ob-gender').forEach((x) => x.classList.toggle('active', x.dataset.gender === state.gender));
  ob.querySelectorAll('.ob-goal').forEach((x) => x.classList.toggle('active', x.dataset.goal === state.goal));
  if (state.avatar && avIn) avIn.innerHTML = `<img src="${state.avatar}" alt="头像" />`;

  function next() {
    if (!validate()) return;
    if (step < STEPS - 1) { setStep(step + 1); renderBmi(); }
    else finish();
  }
  function finish() {
    saveProfile();
    document.body.classList.remove('ob-lock');
    ob.setAttribute('aria-hidden', 'true');
    ob.classList.add('done');
    setTimeout(() => ob.remove(), 500);
    fillProfileForm();
    renderProfileInfo();
    renderHomeOverview();
    switchTab('home');
  }
  $('ob-prev').addEventListener('click', () => { if (step > 0) setStep(step - 1); });
  $('ob-next').addEventListener('click', next);

  // 供首次进入流程调用
  window.__openOnboarding = () => {
    document.body.classList.add('ob-lock');
    ob.setAttribute('aria-hidden', 'false');
    ob.classList.remove('done');
    setStep(0);
  };
  // 供手机返回手势调用：引导页内回上一步
  window.__obBack = () => { if (step > 0) setStep(step - 1); };
})();

// 启动屏：展示约 1.5 秒后淡出移除（填补远程加载时间）
const splashEl = document.getElementById('splash');
if (splashEl) {
  setTimeout(() => {
    splashEl.classList.add('done');
    setTimeout(() => splashEl.remove(), 470);
  }, 1500);
}
fillProfileForm();
applyCoachChrome();
renderHistory();
// 首次进入：资料不完整时打开 5 步引导页；完善后直接进首页
if (hasProfileComplete()) {
  switchTab('home');
} else if (window.__openOnboarding) {
  window.__openOnboarding();
} else {
  switchTab('mine');
  openRequiredProfile();
}

// 跨零点自动清空：应用常开时定时检查，从后台切回时也检查一次
function rolloverPlanIfNeeded() {
  if (state.plan.date && state.plan.date !== todayStr()) {
    state.plan = { date: todayStr(), workout: [], cardio: [], intake: [] };
    savePlan();
    renderPlan();
  }
}
setInterval(rolloverPlanIfNeeded, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) rolloverPlanIfNeeded(); });

// ============ 手机返回手势 / 返回键：分层返回，首页两次滑动退出 ============
// 层级顺序：弹层（引导页/确认框）→ 我的详情/资料编辑 → 计划子页 → 模块页 → 首页 → 再滑一次退出
const BACK_EXIT_WINDOW = 2500;   // 首页「两次返回退出」的判定窗口（毫秒）
let backSentinelOn = false;      // 历史栈是否已压入哨兵（保证返回总能被感知到）
let homeBackAt = 0;              // 上次在首页触发返回的时间
let homeRearmTimer = null;
let backToastTimer = null;

// 压入一条历史哨兵：系统返回先消费它（触发 popstate），而不是直接退出 App
function armBackSentinel() {
  if (backSentinelOn) return;
  try { history.pushState({ zdBack: true }, ''); backSentinelOn = true; } catch (e) { /* 个别环境不支持则忽略 */ }
}

function showBackToast() {
  const el = $('back-toast');
  if (!el) return;
  el.classList.add('show');
  clearTimeout(backToastTimer);
  backToastTimer = setTimeout(() => el.classList.remove('show'), BACK_EXIT_WINDOW);
}

function activeTabName() {
  const cur = document.querySelector('.tab-content.active');
  return cur ? cur.id.replace('tab-', '') : 'home';
}

// 返回上一级；true = 已在应用内处理（不允许退出）
function backOneLevel() {
  const ob = document.getElementById('ob');
  if (ob && ob.getAttribute('aria-hidden') === 'false') {          // 引导页：回上一步
    if (window.__obBack) window.__obBack();
    return true;
  }
  const gm = $('gap-modal');
  if (gm && !gm.classList.contains('hide')) { closeGapModal(true); return true; }         // AI 补缺方案小窗口：关闭
  const mask = $('cancel-done-mask');
  if (mask && !mask.classList.contains('hide')) { closeAskCancelDone(); return true; }   // 确认弹窗：关闭
  if (window.__poseModalBack && window.__poseModalBack()) return true;                    // 姿势跟练完成弹窗：关闭并结束本次跟练
  const edit = $('profile-edit');
  if (edit && !edit.classList.contains('hide')) { showProfileDisplay(); return true; }   // 资料编辑 → 资料展示
  const pd = $('mine-profile-detail');
  const sd = $('mine-setting-detail');
  if ((pd && !pd.classList.contains('hide')) || (sd && !sd.classList.contains('hide'))) { showMineMenu(); return true; }  // 详情页 → 我的菜单
  if (activeTabName() === 'supp' && suppState.view === 'compare') { showSuppList(); return true; }  // 营养优选：对比表 → 列表
  if (window.__aiOpen) { if (window.__aiClose) window.__aiClose(); return true; }  // AI 营养师浮层：先关掉
  if (activeTabName() === 'plan' && state.subtab !== 'coach') { switchSubtab('coach'); return true; }  // 计划子页 → 子菜单默认项
  if (activeTabName() !== 'home') { switchTab('home'); return true; }                    // 模块页 → 首页
  return false;                                                                          // 已在首页
}

window.addEventListener('popstate', () => {
  if (gapPopSuppress) {                                    // 小窗口自己退栈（点击关闭）：忽略这次事件
    gapPopSuppress = false;
    if (!backSentinelOn) armBackSentinel();
    return;
  }
  backSentinelOn = false;                                  // 哨兵已被消费
  if (backOneLevel()) { armBackSentinel(); return; }        // 返回上一级后重新布防
  const now = Date.now();
  // 第二次返回且仍在窗口内：历史已耗尽，这一下交给系统退出 App
  if (now - homeBackAt < BACK_EXIT_WINDOW) return;
  homeBackAt = now;
  showBackToast();
  clearTimeout(homeRearmTimer);
  // 窗口内不重新压哨兵（让下一次返回直接退出）；超时未再返回则重新布防
  homeRearmTimer = setTimeout(() => { homeBackAt = 0; armBackSentinel(); }, BACK_EXIT_WINDOW);
});

// 提示期间用户继续点按页面 → 重新布防并重置窗口，避免意料之外的退出
// 注意：用 click 而不是 pointerdown —— 边缘返回手势会先产生 pointerdown，否则会误重置
document.addEventListener('click', () => {
  if (!backSentinelOn) { clearTimeout(homeRearmTimer); homeBackAt = 0; armBackSentinel(); }
}, true);

// 初始化：当前条目本就是自己压的哨兵（如刷新）则复用，否则新压一条
if (history.state && history.state.zdBack) backSentinelOn = true;
else armBackSentinel();
// 从 bfcache 恢复时回到页面，重新布防
window.addEventListener('pageshow', () => {
  if (!backSentinelOn) { homeBackAt = 0; armBackSentinel(); }
});

// 安卓壳（Capacitor）里系统返回手势不经过浏览器历史：由原生层拦截后调用这里
// 返回 'handled' = 应用内已处理，不要退出；'exit' = 没有可返回的层级了，可以退出 App
window.zdAndroidBack = function () {
  if (backOneLevel()) { armBackSentinel(); return 'handled'; }
  const now = Date.now();
  // 首页第一次返回：提示「再滑一次退出应用」；窗口内第二次返回才允许退出
  if (now - homeBackAt < BACK_EXIT_WINDOW) return 'exit';
  homeBackAt = now;
  showBackToast();
  clearTimeout(homeRearmTimer);
  homeRearmTimer = setTimeout(() => { homeBackAt = 0; armBackSentinel(); }, BACK_EXIT_WINDOW);
  return 'handled';
};

// ============ 营养优选（横向比成分 / 比价格，选好再下单） ============
// 内置参考数据：品牌与产品为真实在售产品；含量为官方标称值（已按用法折算为「每日量」），价格为参考价，「去购买」跳转第三方搜索页核实
const SUPP_CATS = [
  { id: 'all', name: '全部' },
  { id: 'calcium', name: '补钙' },
  { id: 'vitamin', name: '维生素' },
  { id: 'protein', name: '蛋白粉' },
  { id: 'omega', name: '鱼油' },
  { id: 'mineral', name: '矿物质' },
];
const SUPPLEMENTS = [
  { id: 'cal-d3', kind: 'calcium', cat: 'calcium', ico: '钙', name: '钙尔奇 D3 咀嚼片', short: '钙尔奇', brand: '钙尔奇', form: '咀嚼片', price: 65, servings: 60, perDay: 1, pack: '60片/瓶', dose: '1片/天', facts: [{ k: '钙', n: 600, u: 'mg' }, { k: '维生素D3', n: 125, u: 'IU' }], fit: '信赖经典钙剂、日常补钙人群' },
  { id: 'cal-swi', kind: 'calcium', cat: 'calcium', ico: '钙', name: 'Swisse 钙 + 维生素D3 片', short: 'Swisse', brand: 'Swisse', form: '片剂', price: 119, servings: 150, perDay: 2, pack: '150片/瓶', dose: '2片/天', facts: [{ k: '钙', n: 666, u: 'mg' }, { k: '维生素D3', n: 666, u: 'IU' }], fit: '注重吸收率、进口品牌偏好人群' },
  { id: 'cal-tang', kind: 'calcium', cat: 'calcium', ico: '钙', name: '汤臣倍健 液体钙软胶囊', short: '汤臣倍健', brand: '汤臣倍健', form: '软胶囊', price: 98, servings: 100, perDay: 2, pack: '100粒/瓶', dose: '2粒/天', facts: [{ k: '钙', n: 500, u: 'mg' }, { k: '维生素D3', n: 400, u: 'IU' }], fit: '吞咽不便、偏好液体钙人群' },
  { id: 'vc-redoxon', kind: 'vc', cat: 'vitamin', ico: '维', name: '力度伸 维生素C泡腾片', short: '力度伸', brand: '力度伸', form: '泡腾片', price: 42, servings: 15, perDay: 1, pack: '15片/管', dose: '1片/天', facts: [{ k: '维生素C', n: 1000, u: 'mg' }], fit: '换季易感冒、需要高剂量维C人群' },
  { id: 'vc-swi', kind: 'vc', cat: 'vitamin', ico: '维', name: 'Swisse 维生素C泡腾片', short: 'Swisse', brand: 'Swisse', form: '泡腾片', price: 59, servings: 20, perDay: 1, pack: '20片/管', dose: '1片/天', facts: [{ k: '维生素C', n: 1000, u: 'mg' }], fit: '喜欢果味泡腾、日常补充人群' },
  { id: 'vc-tang', kind: 'vc', cat: 'vitamin', ico: '维', name: '汤臣倍健 维生素C咀嚼片', short: '汤臣倍健', brand: '汤臣倍健', form: '咀嚼片', price: 69, servings: 100, perDay: 2, pack: '100片/瓶', dose: '2片/天', facts: [{ k: '维生素C', n: 200, u: 'mg' }], fit: '日常小剂量补充、预算友好人群' },
  { id: 'vb-tang', kind: 'vb', cat: 'vitamin', ico: '维', name: '汤臣倍健 复合维生素B族片', short: '汤臣倍健', brand: '汤臣倍健', form: '薄膜衣片', price: 79, servings: 100, perDay: 1, pack: '100片/瓶', dose: '1片/天', facts: [{ k: '维生素B1', n: 1.2, u: 'mg' }, { k: '维生素B12', n: 2.4, u: 'μg' }], fit: '熬夜多、易疲劳人群' },
  { id: 'vb-swi', kind: 'vb', cat: 'vitamin', ico: '维', name: 'Swisse 复合维生素B族片', short: 'Swisse', brand: 'Swisse', form: '片剂', price: 99, servings: 60, perDay: 1, pack: '60片/瓶', dose: '1片/天', facts: [{ k: '维生素B1', n: 25, u: 'mg' }, { k: '维生素B12', n: 25, u: 'μg' }], fit: '高强度工作、需高剂量B族人群' },
  { id: 'vd3-ostelin', kind: 'vd3', cat: 'vitamin', ico: '维', name: 'Ostelin 维生素D3胶囊 1000IU', short: 'Ostelin', brand: 'Ostelin', form: '胶囊', price: 99, servings: 90, perDay: 1, pack: '90粒/瓶', dose: '1粒/天', facts: [{ k: '维生素D3', n: 1000, u: 'IU' }], fit: '日照少、维D不足人群' },
  { id: 'vd3-ddrops', kind: 'vd3', cat: 'vitamin', ico: '维', name: 'Ddrops 维生素D3滴剂 400IU', short: 'Ddrops', brand: 'Ddrops', form: '滴剂', price: 119, servings: 90, perDay: 2, pack: '90滴/瓶', dose: '2滴/天', facts: [{ k: '维生素D3', n: 800, u: 'IU' }], fit: '吞咽不便、全家共用人群' },
  { id: 'whey-on', kind: 'whey', cat: 'protein', ico: '蛋', name: 'ON 金标乳清蛋白粉 香草味', short: 'ON', brand: 'Optimum Nutrition', form: '粉剂', price: 349, servings: 28, perDay: 1, pack: '2磅（28份）', dose: '1勺/天', facts: [{ k: '蛋白质', n: 24, u: 'g' }, { k: '支链氨基酸', n: 5.5, u: 'g' }], fit: '力量训练、增肌人群' },
  { id: 'iso-myprotein', kind: 'whey', cat: 'protein', ico: '蛋', name: 'MyProtein 分离乳清蛋白粉', short: 'MyProtein', brand: 'MyProtein', form: '粉剂', price: 399, servings: 30, perDay: 1, pack: '1kg（30份）', dose: '1勺/天', facts: [{ k: '蛋白质', n: 25, u: 'g' }, { k: '支链氨基酸', n: 5.8, u: 'g' }], fit: '控糖控脂、乳糖敏感人群' },
  { id: 'fish-swi', kind: 'omega3', cat: 'omega', ico: '油', name: 'Swisse 深海鱼油软胶囊 1000mg', short: 'Swisse', brand: 'Swisse', form: '软胶囊', price: 159, servings: 400, perDay: 2, pack: '400粒/瓶', dose: '2粒/天', facts: [{ k: 'Omega-3', n: 600, u: 'mg' }, { k: 'EPA', n: 360, u: 'mg' }], fit: '日常护心脑、用脑多人群' },
  { id: 'fish-blackmores', kind: 'omega3', cat: 'omega', ico: '油', name: 'Blackmores 深海鱼油软胶囊 1000mg', short: 'Blackmores', brand: 'Blackmores', form: '软胶囊', price: 139, servings: 400, perDay: 2, pack: '400粒/瓶', dose: '2粒/天', facts: [{ k: 'Omega-3', n: 600, u: 'mg' }, { k: 'EPA', n: 360, u: 'mg' }], fit: '血脂偏高、追求性价比人群' },
  { id: 'fish-tang', kind: 'omega3', cat: 'omega', ico: '油', name: '汤臣倍健 鱼油软胶囊', short: '汤臣倍健', brand: '汤臣倍健', form: '软胶囊', price: 118, servings: 100, perDay: 2, pack: '100粒/瓶', dose: '2粒/天', facts: [{ k: 'Omega-3', n: 550, u: 'mg' }, { k: 'EPA', n: 330, u: 'mg' }], fit: '国内购买方便、日常Omega-3补充' },
  { id: 'mg-swi', kind: 'mg', cat: 'mineral', ico: '镁', name: 'Swisse 镁片', short: 'Swisse', brand: 'Swisse', form: '片剂', price: 89, servings: 60, perDay: 2, pack: '60片/瓶', dose: '2片/天', facts: [{ k: '镁', n: 250, u: 'mg' }], fit: '睡眠浅、易抽筋人群' },
  { id: 'mg-now', kind: 'mg', cat: 'mineral', ico: '镁', name: 'Now Foods 甘氨酸镁胶囊', short: 'Now Foods', brand: 'Now Foods', form: '胶囊', price: 109, servings: 90, perDay: 2, pack: '90粒/瓶', dose: '2粒/天', facts: [{ k: '镁', n: 200, u: 'mg' }], fit: '偏好甘氨酸镁、肠胃敏感人群' },
  { id: 'creatine-mp', kind: 'creatine', cat: 'mineral', ico: '肌', name: 'MyProtein 一水肌酸粉', short: 'MyProtein', brand: 'MyProtein', form: '粉剂', price: 95, servings: 50, perDay: 1, pack: '250g（50份）', dose: '1勺/天', facts: [{ k: '肌酸', n: 5, u: 'g' }], fit: '力量训练、追求性价比人群' },
  { id: 'creatine-on', kind: 'creatine', cat: 'mineral', ico: '肌', name: 'ON 一水肌酸粉', short: 'ON', brand: 'Optimum Nutrition', form: '粉剂', price: 149, servings: 60, perDay: 1, pack: '300g（60份）', dose: '1勺/天', facts: [{ k: '肌酸', n: 5, u: 'g' }], fit: '力量训练、偏好大牌人群' },
  { id: 'zn-tang', kind: 'zn', cat: 'mineral', ico: '锌', name: '汤臣倍健 锌硒片', short: '汤臣倍健', brand: '汤臣倍健', form: '片剂', price: 69, servings: 60, perDay: 1, pack: '60片/瓶', dose: '1片/天', facts: [{ k: '锌', n: 15, u: 'mg' }, { k: '硒', n: 55, u: 'μg' }], fit: '饮食单一、关注免疫人群' },
  { id: 'zn-swi', kind: 'zn', cat: 'mineral', ico: '锌', name: 'Swisse 锌片', short: 'Swisse', brand: 'Swisse', form: '片剂', price: 79, servings: 60, perDay: 1, pack: '60片/瓶', dose: '1片/天', facts: [{ k: '锌', n: 25, u: 'mg' }], fit: '关注皮肤与免疫人群' },
];
// 同一种补剂分组：只有同一 kind 的产品才能放进同一个对比（不同厂商、含量与价格不同才可比）
const SUPP_KINDS = { calcium: '钙类', vc: '维生素C', vb: 'B族维生素', vd3: '维生素D3', whey: '乳清蛋白', omega3: 'Omega-3', mg: '镁', creatine: '肌酸', zn: '锌硒' };
const suppKindName = (s) => (s && SUPP_KINDS[s.kind]) || '同类';

const suppState = { cat: 'all', picked: [], view: 'list', q: '' };
const suppById = (id) => SUPPLEMENTS.find((x) => x.id === id);
const suppDayCost = (s) => (s.price / s.servings) * s.perDay;
const suppFactsLine = (s) => s.facts.map((f) => f.k + ' ' + f.n + f.u).join(' · ');
// 购买跳转：第三方搜索页（用户自行选店下单）
const suppBuyURL = (s) => 'https://search.jd.com/Search?keyword=' + encodeURIComponent(s.name);

// 首页信息流里的补剂广告海报（产品图，按类别复用）
const SUPP_IMG = (prompt) =>
  'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=' +
  encodeURIComponent(prompt) + '&image_size=landscape_4_3';
const SUPP_AD_POSTERS = {
  calcium: SUPP_IMG('calcium supplement tablets and bottle on clean bright table, product photography, soft studio light, photorealistic, landscape'),
  vitamin: SUPP_IMG('vitamin capsules spilled from a bottle with orange slices, bright product photography, photorealistic, landscape'),
  protein: SUPP_IMG('whey protein powder scoop and shaker bottle on gym bench, bright product photography, photorealistic, landscape'),
  omega: SUPP_IMG('golden fish oil softgel capsules with lemon on white plate, product photography, photorealistic, landscape'),
  mineral: SUPP_IMG('mineral supplement tablets with nuts and banana on light table, product photography, photorealistic, landscape'),
};

function suppAdHTML(s) {
  return `
    <article class="feed-card feed-sad" data-cat="${s.cat}" data-sid="${s.id}">
      <span class="feed-adtag">广告</span>
      <div class="feed-sad-media"><img src="${SUPP_AD_POSTERS[s.cat] || SUPP_AD_POSTERS.calcium}" alt="${s.name}" loading="lazy" /></div>
      <div class="feed-sad-body">
        <span class="feed-sad-kicker">营养优选 · 精选</span>
        <h3 class="feed-ctitle">${s.name}</h3>
        <p class="feed-desc">${suppFactsLine(s)}</p>
        <div class="feed-sad-foot">
          <span class="feed-sad-price">¥${s.price}<i>约 ¥${suppDayCost(s).toFixed(1)}/天</i></span>
          <span class="feed-sad-cta">去对比</span>
        </div>
      </div>
    </article>`;
}

function suppCardHTML(s) {
  const on = suppState.picked.includes(s.id);
  // 托盘里已有其他类别时，非同类的产品不可加入（比对只针对同一种补剂）
  const cur = suppState.picked.map(suppById).filter(Boolean);
  const offKind = !on && cur.length > 0 && s.kind !== cur[0].kind;
  return `
    <article class="supp-card">
      <div class="supp-card-main">
        <span class="supp-ico">${s.ico}</span>
        <div class="supp-info">
          <div class="supp-name-row">
            <h3 class="supp-name">${s.name}</h3>
            <span class="supp-brand">${s.brand}</span>
          </div>
          <p class="supp-facts">${suppFactsLine(s)}</p>
          <div class="supp-price-row">
            <span class="supp-price">¥${s.price}</span>
            <span class="supp-spec">${s.pack}</span>
            <span class="supp-day">约 ¥${suppDayCost(s).toFixed(1)}/天</span>
          </div>
        </div>
      </div>
      <div class="supp-actions">
        <button class="supp-add${on ? ' on' : ''}${offKind ? ' off-kind' : ''}" data-add="${s.id}">
          <svg class="i"><use href="#i-${on ? 'check' : 'plus'}"/></svg>${on ? '已加入' : (offKind ? '仅限同类' : '加入比对')}
        </button>
        <a class="supp-buy" href="${suppBuyURL(s)}" target="_blank" rel="noopener">去购买</a>
      </div>
    </article>`;
}

let suppToastTimer = null;
function showSuppToast(msg) {
  const el = $('supp-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(suppToastTimer);
  suppToastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// 进入本模块（底部菜单 tab 页）；cat 可选：从信息流广告进入时按其类别筛选
function openSuppModule(cat) {
  if (window.__feedPause) window.__feedPause();   // 离开首页前暂停视频自动连播
  if (cat) suppState.cat = cat;
  switchTab('supp');
}
// 列表 ⇄ 对比 两个视图切换（返回手势 / 「返回列表」按钮共用）
function showSuppList() {
  suppState.view = 'list';
  $('supp-list-wrap').classList.remove('hide');
  $('supp-compare').classList.add('hide');
  $('supp-intro').classList.remove('hide');   // 列表页保留顶部说明文字
  renderSuppTray();   // 回到列表：有已选时恢复底部托盘
}
function showSuppCompare() {
  if (suppState.picked.length < 2) { showSuppToast('至少选 2 件才有对比意义'); return; }
  suppState.view = 'compare';
  renderSuppCompare();
  $('supp-list-wrap').classList.add('hide');
  $('supp-compare').classList.remove('hide');
  $('supp-intro').classList.add('hide');   // 对比页不再展示顶部说明文字
  renderSuppTray();   // 对比页收起底部托盘（不需要「开始对比」了）
  window.scrollTo(0, 0);
}
// 进入本页时渲染（保持上次的列表/对比状态），加入比对后也走这里
function renderSuppView() {
  renderSuppChips();
  renderSuppTray();
  renderSuppList();
  if (suppState.view === 'compare' && suppState.picked.length >= 2) {
    renderSuppCompare();
    $('supp-list-wrap').classList.add('hide');
    $('supp-compare').classList.remove('hide');
    $('supp-intro').classList.add('hide');
  } else {
    showSuppList();
  }
}

function renderSuppChips() {
  $('supp-chips').innerHTML = SUPP_CATS.map((c) =>
    `<button class="supp-chip${suppState.cat === c.id ? ' on' : ''}" data-cat="${c.id}">${c.name}</button>`
  ).join('');
}
function renderSuppList() {
  const q = suppState.q.trim().toLowerCase();
  const list = SUPPLEMENTS.filter((s) => {
    if (suppState.cat !== 'all' && s.cat !== suppState.cat) return false;
    if (!q) return true;
    const catName = (SUPP_CATS.find((c) => c.id === s.cat) || {}).name || '';
    const hay = [s.name, s.short, s.brand, s.form, s.dose, s.fit, catName,
      s.facts.map((f) => `${f.k}${f.n}${f.u}`).join(' ')].join(' ').toLowerCase();
    return hay.includes(q);
  });
  $('supp-list').innerHTML = list.length
    ? list.map(suppCardHTML).join('')
    : '<p class="supp-empty">没找到相关产品，换个词试试，或让 AI 营养师帮你挑</p>';
}
function renderSuppTray() {
  const n = suppState.picked.length;
  // 对比表页不显示底部托盘：已在对比中，避免遮挡表格与冗余的「开始对比」按钮
  $('supp-tray').classList.toggle('on', n > 0 && suppState.view !== 'compare');
  const cur = suppState.picked.map(suppById).filter(Boolean);
  const kindLbl = cur.length ? `<span class="tray-kind">${suppKindName(cur[0])} · 同类对比</span>` : '';
  $('supp-tray-items').innerHTML = kindLbl + suppState.picked.map((id) => {
    const s = suppById(id);
    return `<button class="tray-chip" data-rm="${id}" title="移出对比">${s.short}<svg class="i"><use href="#i-x"/></svg></button>`;
  }).join('');
  const go = $('supp-tray-go');
  go.disabled = n < 2;
  go.textContent = n > 1 ? `开始对比 (${n})` : '开始对比';
}

function toggleSuppPick(id) {
  const i = suppState.picked.indexOf(id);
  if (i >= 0) {
    suppState.picked.splice(i, 1);
  } else {
    const s = suppById(id);
    const cur = suppState.picked.map(suppById).filter(Boolean);
    // 比对对象必须是同一种补剂（不同厂商、含量和价格不同才需要比对）
    if (s && cur.length && s.kind !== cur[0].kind) {
      showSuppToast(`对比的是同一种补剂：已选「${suppKindName(cur[0])}」，先移出已选再换`);
      return;
    }
    if (suppState.picked.length >= 3) { showSuppToast('最多同时对比 3 件'); return; }
    suppState.picked.push(id);
  }
  renderSuppList();
  renderSuppTray();
}

// 详细横向对比表：列为所选补剂，行为「价格 / 规格 / 每日成本 / 剂型 / 用法 / 各成分指标 / 适合 / 购买」
function renderSuppCompare() {
  const items = suppState.picked.map(suppById).filter(Boolean);
  const n = items.length;
  const grid = $('supp-cmp-grid');
  grid.style.setProperty('--n', n);
  const cells = [];

  // 表头：补剂名称 + 品牌 + 移出
  cells.push('<div class="cmp-cell cmp-lbl cmp-head-cell">产品</div>');
  items.forEach((s) => {
    cells.push(`<div class="cmp-cell cmp-head-cell">
      <span class="cmp-name">${s.name}</span>
      <span class="cmp-brand">${s.brand}</span>
      <button class="cmp-rm" data-rm="${s.id}" aria-label="移出对比"><svg class="i"><use href="#i-x"/></svg></button>
    </div>`);
  });

  // 逐行渲染（隔行底色，长表格更清晰）
  let row = 0;
  const pushRow = (label, htmls) => {
    const alt = row % 2 === 1 ? ' cmp-alt' : '';
    cells.push(`<div class="cmp-cell cmp-lbl${alt}">${label}</div>`);
    htmls.forEach((h) => cells.push(`<div class="cmp-cell${alt}">${h}</div>`));
    row++;
  };

  // 厂家：不同厂商的同类产品，是比对的起点
  pushRow('厂家', items.map((s) => `<span class="cmp-maker">${s.brand}</span>`));

  pushRow('价格', items.map((s) => `<span class="cmp-num">¥${s.price}</span>`));
  pushRow('规格', items.map((s) => `<span class="cmp-faint">${s.pack}</span>`));

  // 每日成本（唯一最低者标「省」）
  const costs = items.map(suppDayCost);
  const minCost = Math.min(...costs);
  const minOnly = costs.filter((c) => c === minCost).length === 1;
  pushRow('每日成本', items.map((s, i) =>
    `<span class="cmp-num">¥${costs[i].toFixed(1)}</span><span class="cmp-faint">/天</span>${minOnly && costs[i] === minCost ? '<span class="cmp-best save">省</span>' : ''}`
  ));

  // 性价比：每 1 元（按每日成本）可获得的「主成分」量 —— 把含量和价格合在一起比
  const primaries = items.map((s) => s.facts[0]);
  if (n >= 2 && primaries.every((f) => f && f.k === primaries[0].k && f.u === primaries[0].u)) {
    const perYuan = primaries.map((f, i) => f.n / costs[i]);
    const maxPY = Math.max(...perYuan);
    const maxOnly = perYuan.filter((v) => v === maxPY).length === 1;
    const fmtPY = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
    pushRow('性价比', items.map((s, i) =>
      `<span class="cmp-num">${fmtPY(perYuan[i])}${primaries[0].u}</span><span class="cmp-faint">/元</span>${maxOnly && perYuan[i] === maxPY ? '<span class="cmp-best save">划算</span>' : ''}`
    ));
  }

  pushRow('剂型', items.map((s) => `<span class="cmp-faint">${s.form}</span>`));
  pushRow('用法', items.map((s) => `<span class="cmp-faint">${s.dose}</span>`));

  // 成分指标：取并集；同一单位下数值最高者标「优」
  const keys = [];
  items.forEach((s) => s.facts.forEach((f) => { if (!keys.includes(f.k)) keys.push(f.k); }));
  keys.forEach((k) => {
    const vals = items.map((s) => s.facts.find((f) => f.k === k) || null);
    const present = vals.filter(Boolean);
    const units = new Set(present.map((v) => v.u));
    const bestIdx = new Set();
    if (present.length === n && units.size === 1) {
      const max = Math.max(...vals.map((v) => v.n));
      vals.forEach((v, i) => { if (v.n === max) bestIdx.add(i); });
      if (bestIdx.size === n) bestIdx.clear();   // 全部相同 → 不标
    }
    pushRow(k, vals.map((v, i) => (v
      ? `<span class="cmp-num">${v.n}${v.u}</span>${bestIdx.has(i) ? '<span class="cmp-best">优</span>' : ''}`
      : '<span class="cmp-faint">—</span>'
    )));
  });

  pushRow('适合', items.map((s) => `<span class="cmp-faint">${s.fit}</span>`));
  pushRow('购买', items.map((s) => `<a class="cmp-buy" href="${suppBuyURL(s)}" target="_blank" rel="noopener">去购买</a>`));

  grid.innerHTML = cells.join('');
  // 最后一行去掉底部分隔线
  const all = grid.querySelectorAll('.cmp-cell');
  all.forEach((c, i) => { if (i >= all.length - n - 1) c.classList.add('cmp-last'); });
  const count = $('supp-cmp-count');
  const sameKind = n > 0 && items.every((s) => s.kind === items[0].kind);
  if (count) count.textContent = sameKind ? `同类对比 · ${suppKindName(items[0])} · 共 ${n} 款` : `共 ${n} 件 · 详细对比`;
}

// ---------- AI 营养师（浮层对话：说需求 → 只从清单内推荐 → 一键加入比对） ----------
const AI_QUICKS = ['想补钙', '健身增肌', '经常熬夜', '提升免疫力', '睡不好', '护心脑', '运动表现', '不太确定，帮我挑'];
const aiState = { msgs: [], sending: false, ctrl: null, greeted: false };

// 把当前清单压成紧凑文本，随首次提问发给营养师（服务端只让它照单推荐）
// 发送前随机洗牌：固定排列顺序会隐性影响模型推荐，洗牌保证各品牌权重一致
function aiCatalogText() {
  return [...SUPPLEMENTS].sort(() => Math.random() - 0.5).map((s) => {
    const facts = s.facts.map((f) => `${f.k}${f.n}${f.u}`).join('、');
    return `- ${s.name}（${s.brand}）｜${suppKindName(s)}｜${s.pack}｜¥${s.price}｜约¥${suppDayCost(s).toFixed(1)}/天｜${facts}｜适合：${s.fit}`;
  }).join('\n');
}

function aiScrollBottom() {
  const el = $('ai-log');
  if (el) el.scrollTop = el.scrollHeight;
}
function appendAiMsg(role, text) {
  const wrap = document.createElement('div');
  wrap.className = 'ai-msg ' + role;
  const b = document.createElement('div');
  b.className = 'ai-bubble';
  b.textContent = text;
  wrap.appendChild(b);
  $('ai-log').appendChild(wrap);
  aiScrollBottom();
  return wrap;
}

function openAiSheet() {
  window.__aiOpen = true;
  $('ai-mask').classList.remove('hide');
  $('ai-sheet').classList.remove('hide');
  $('ai-sheet').setAttribute('aria-hidden', 'false');
  if (!aiState.greeted) {
    aiState.greeted = true;
    appendAiMsg('bot', `你好，我是 AI 营养师小颖。\n我只推荐补剂：说说你缺什么、想补什么，我从这里的 ${SUPPLEMENTS.length} 款里帮你挑最合适的。\n如果营养不缺，我会直接告诉你不需要。`);
    $('ai-chips').innerHTML = AI_QUICKS.map((t) => `<button class="ai-chip">${t}</button>`).join('');
  }
  setTimeout(() => { const el = $('ai-input'); if (el && !aiState.sending) el.focus(); }, 80);
}
function closeAiSheet() {
  window.__aiOpen = false;
  if (aiState.ctrl) { try { aiState.ctrl.abort(); } catch (_) {} aiState.ctrl = null; }
  aiState.sending = false;
  $('ai-mask').classList.add('hide');
  $('ai-sheet').classList.add('hide');
  $('ai-sheet').setAttribute('aria-hidden', 'true');
}
window.__aiClose = closeAiSheet;

// 扫描文本里提到的产品，按「首次提及顺序」返回（公平：不按数组顺序取前几个）
// 匹配前去掉所有空白：AI 写的「钙+维生素D3片」与数据里的「钙 + 维生素D3 片」要能对上
function suppsMentionedIn(text) {
  const nt = String(text || '').replace(/\s+/g, '');
  const nrm = (x) => String(x).replace(/\s+/g, '');
  const named = [];
  const byBrand = new Map();   // 只说品牌没点名产品时：每品牌最多 1 个按钮，避免「Swisse」重复出现几遍
  SUPPLEMENTS.forEach((s) => {
    const iName = nt.indexOf(nrm(s.name));
    if (iName >= 0) { named.push({ s, idx: iName }); return; }
    const iBrand = nt.indexOf(nrm(s.brand));
    if (iBrand < 0) return;
    const score = s.facts.filter((f) => nt.includes(nrm(f.k))).length;   // 品牌内优先「成分名也被提到」的那款
    const rec = byBrand.get(s.brand);
    if (!rec || score > rec.score) byBrand.set(s.brand, { s, idx: iBrand, score });
  });
  const namedBrands = new Set(named.map((x) => x.s.brand));
  const rest = [...byBrand.values()].filter((x) => !namedBrands.has(x.s.brand));
  return [...named, ...rest].sort((a, b) => a.idx - b.idx).map((x) => x.s);
}

// 提及按钮的短标签：同一品牌出现在多款里时补上「·种类」，避免几个同名按钮分不清
function suppPickLabel(s, hit) {
  const dup = hit.some((x) => x !== s && x.short === s.short);
  return dup ? `${s.short}·${suppKindName(s)}` : s.short;
}

// 回复完成后：扫描文本里提到的产品 → 挂上「一键加入比对」按钮
function renderAiPicks(wrap, text) {
  const hit = suppsMentionedIn(text);
  if (!hit.length) return;
  const row = document.createElement('div');
  row.className = 'ai-picks';
  row.innerHTML = '<span class="ai-picks-lbl">一键加入比对：</span>' + hit.slice(0, 8).map((s) =>
    `<button class="ai-pick${suppState.picked.includes(s.id) ? ' on' : ''}" data-pick="${s.id}">${suppPickLabel(s, hit)}</button>`
  ).join('');
  wrap.appendChild(row);
  aiScrollBottom();
}

async function sendAiMsg(text) {
  text = (text || '').trim();
  if (!text || aiState.sending) return;
  appendAiMsg('user', text);
  // 首次提问把清单一起带上；服务端只挂短提示词，回复快且只推荐清单内产品
  const isFirst = aiState.msgs.length === 0;
  aiState.msgs.push({ role: 'user', content: isFirst ? `【可选产品清单】\n${aiCatalogText()}\n\n【今日营养情况】\n${nutriGapText()}\n\n【我的需求】${text}` : text });
  if (aiState.msgs.length > 8) aiState.msgs = aiState.msgs.slice(-8);
  $('ai-input').value = '';

  aiState.sending = true;
  aiState.ctrl = new AbortController();
  const wrap = appendAiMsg('bot', '正在想…');
  const bubble = wrap.querySelector('.ai-bubble');
  let full = '';
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: aiState.ctrl.signal,
      body: JSON.stringify({ mode: 'nutrition', profile: buildProfile(), goal: state.goal, messages: aiState.msgs }),
    });
    const ct = resp.headers.get('Content-Type') || '';
    if (!ct.includes('text/event-stream')) {
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'AI 营养师暂时不在线');
      full = data.reply || '';
      bubble.textContent = extractPlanBlock(full).cleanText;
    } else {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const evt = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const dline = evt.split('\n').find((l) => l.startsWith('data:'));
          if (!dline) continue;
          const payload = dline.slice(5).trim();
          if (payload === '[DONE]') continue;
          let o;
          try { o = JSON.parse(payload); } catch (_) { continue; }
          if (o.error) throw new Error(o.error);
          if (o.t) { full += o.t; bubble.textContent = extractPlanBlock(full).cleanText; aiScrollBottom(); }
        }
      }
    }
    if (!full) throw new Error('没有收到回复，再试一次？');
    // 浮层只显示正文：万一模型夹带 [[PLAN]] 数据块，显示前统一剥离
    const clean = extractPlanBlock(full).cleanText || '这次没生成有效回复，换个说法再问一次？';
    bubble.textContent = clean;
    aiState.msgs.push({ role: 'assistant', content: clean });
    renderAiPicks(wrap, clean);
  } catch (e) {
    wrap.remove();
    if (e.name === 'AbortError') return;   // 关闭浮层等主动中断，不算错误
    const tip = e.message.includes('Failed to fetch') ? '连不上服务器，确认后端已启动后再试。' : e.message;
    appendAiMsg('bot', '连接异常：' + tip);
  } finally {
    aiState.sending = false;
    aiState.ctrl = null;
  }
}

(function bindSuppModule() {
  if (!$('tab-supp')) return;
  // 对比表 → 返回列表
  $('supp-cmp-back').addEventListener('click', showSuppList);
  // 搜索栏：实时过滤 + 一键清空
  const searchInput = $('supp-search-input');
  const searchClear = $('supp-search-clear');
  searchInput.addEventListener('input', () => {
    suppState.q = searchInput.value;
    searchClear.classList.toggle('hide', !searchInput.value);
    renderSuppList();
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    suppState.q = '';
    searchClear.classList.add('hide');
    renderSuppList();
    searchInput.focus();
  });
  // AI 营养师：打开 / 关闭 / 快捷提问 / 发送 / 回复内一键加入比对
  $('ai-cta').addEventListener('click', openAiSheet);
  $('ai-close').addEventListener('click', closeAiSheet);
  $('ai-mask').addEventListener('click', closeAiSheet);
  $('ai-chips').addEventListener('click', (e) => {
    const c = e.target.closest('.ai-chip');
    if (c) sendAiMsg(c.textContent);
  });
  $('ai-send').addEventListener('click', () => sendAiMsg($('ai-input').value));
  $('ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendAiMsg($('ai-input').value); }
  });
  $('ai-log').addEventListener('click', (e) => {
    const p = e.target.closest('[data-pick]');
    if (!p) return;
    const id = p.dataset.pick;
    const s = suppById(id);
    const cur = suppState.picked.map(suppById).filter(Boolean);
    if (!suppState.picked.includes(id) && cur.length && s && s.kind !== cur[0].kind) {
      appendAiMsg('bot', `比对的是同一种补剂：托盘里已选「${suppKindName(cur[0])}」，先移出一件再加其他类别吧。`);
      return;
    }
    if (!suppState.picked.includes(id) && suppState.picked.length >= 3) {
      appendAiMsg('bot', '对比托盘最多放 3 件，先在托盘里移出一件再加吧。');
      return;
    }
    toggleSuppPick(id);
    p.classList.toggle('on', suppState.picked.includes(id));
  });
  $('supp-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.supp-chip');
    if (!chip) return;
    suppState.cat = chip.dataset.cat;
    renderSuppChips();
    renderSuppList();
  });
  $('supp-list').addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) toggleSuppPick(add.dataset.add);
  });
  $('supp-tray-items').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) toggleSuppPick(rm.dataset.rm);
  });
  $('supp-tray-go').addEventListener('click', showSuppCompare);
  // 对比表内移出某件：只剩 1 件时退回列表
  $('supp-cmp-grid').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    toggleSuppPick(rm.dataset.rm);
    if (suppState.picked.length < 2) { showSuppList(); return; }
    renderSuppCompare();
  });
  // 首页入口 / 信息流广告 → 切到「优选」模块页（广告按其类别筛选）
  const entry = $('feed-supp-entry');
  if (entry) entry.addEventListener('click', () => openSuppModule());
  const feedList = $('feed-list');
  if (feedList) feedList.addEventListener('click', (e) => {
    const sad = e.target.closest('.feed-sad');
    if (sad) openSuppModule(sad.dataset.cat || undefined);
  });
})();

// ============ 今日计划 · 训练 / 饮食 / 营养 三视图 ============
// 视图切换（记住上次选择） + 营养摄入估算 + 每日补剂打卡 + AI 营养建议
const PLAN_VIEW_KEY = 'zhidong_plan_view_v1';
const TAKEN_KEY = 'zhidong_supp_taken_v1';
const ADVICE_KEY = 'zhidong_supp_advice_v1';
const MICRO_AI_KEY = 'zhidong_food_micro_ai_v1';   // AI 兜底估算的食物营养缓存（每 100g）

// 每日参考量（近似成人推荐值，仅作趋势参考；蛋白质、碳水、脂肪按档案动态估算）
const MICRO_TARGETS = [
  { k: '蛋白质', unit: 'g', ref: 60 },
  { k: '碳水', unit: 'g', ref: 300 },
  { k: '脂肪', unit: 'g', ref: 65 },
  { k: '钙', unit: 'mg', ref: 800 },
  { k: '铁', unit: 'mg', ref: 15 },
  { k: '锌', unit: 'mg', ref: 12.5 },
  { k: '镁', unit: 'mg', ref: 330 },
  { k: '钾', unit: 'mg', ref: 2000 },
  { k: '维生素C', unit: 'mg', ref: 100 },
  { k: '维生素D', unit: 'μg', ref: 10 },
  { k: '膳食纤维', unit: 'g', ref: 25 },
  { k: 'Omega-3', unit: 'mg', ref: 250 },
];
// 蛋白质目标：减脂 1.8g/kg、增肌 1.6g/kg、运动表现 1.5g/kg；没有体重资料时给 60g 保底
function proteinTarget() {
  const w = Number(state.weight) || 0;
  if (!w) return 60;
  const per = state.goal === 'cut' ? 1.8 : (state.goal === 'bulk' ? 1.6 : 1.5);
  return Math.round(w * per);
}
// 碳水/脂肪目标：按每日目标摄入热量拆分——脂肪约占 25%，碳水吃掉剩余热量
function macroRef(kind) {
  const cal = targetCalories();
  if (!cal) return kind === '碳水' ? 300 : 65;   // 没有档案数据时的保底参考值
  const fatG = Math.round(cal * 0.25 / 9);
  if (kind === '脂肪') return fatG;
  return Math.max(50, Math.round((cal - proteinTarget() * 4 - fatG * 9) / 4));
}
function microRef(t) {
  if (t.k === '蛋白质') return proteinTarget();
  if (t.k === '碳水' || t.k === '脂肪') return macroRef(t.k);
  return t.ref;
}
// 缺口提示：某几项偏低时给一句可执行的吃法
const MICRO_TIPS = {
  '蛋白质': '每餐加一掌心肉蛋豆制品，或一勺蛋白粉',
  '碳水': '主食别一味少吃，优先全谷物、杂粮和薯类',
  '脂肪': '每天一小把坚果，或每周 2 次深海鱼',
  '钙': '加一份奶制品或豆腐，配合钙+D3 更省事',
  '铁': '红肉、动物肝脏每周安排 2 次',
  '锌': '贝类、瘦肉、坚果都不错',
  '镁': '坚果、深绿色蔬菜、全谷物',
  '钾': '香蕉、薯类、深色蔬菜',
  '维生素C': '每天一份新鲜水果（橙子、猕猴桃）',
  '维生素D': '深海鱼、蛋黄，晒 15 分钟太阳或补维D3',
  '膳食纤维': '把一半主食换成全谷物，多吃蔬菜',
  'Omega-3': '每周 2 次深海鱼，或鱼油补剂',
};
// 常见食物近似含量：v 为「参考重量 g」下的大致数值；食物名命中 kw 时折算
const FOOD_MICRO = [
  { kw: ['牛奶', '纯牛奶', '鲜奶', '高钙奶'], g: 250, v: { '蛋白质': 7.5, '碳水': 12, '脂肪': 8, '钙': 260, '维生素D': 1.3, '锌': 0.9, '钾': 380, '镁': 25 } },
  { kw: ['酸奶'], g: 200, v: { '蛋白质': 6, '碳水': 20, '脂肪': 6, '钙': 240, '锌': 0.8, '钾': 300, '镁': 22 } },
  { kw: ['奶酪', '芝士'], g: 30, v: { '蛋白质': 7, '碳水': 1, '脂肪': 8, '钙': 220, '钾': 30, '镁': 8 } },
  { kw: ['豆浆', '豆奶'], g: 250, v: { '蛋白质': 7.5, '碳水': 5, '脂肪': 4, '钙': 30, '钾': 300, '镁': 30 } },
  { kw: ['豆腐', '豆干', '腐竹'], g: 150, v: { '蛋白质': 12, '碳水': 4, '脂肪': 6, '钙': 240, '铁': 2.4, '锌': 1.2, '钾': 200, '镁': 40, '膳食纤维': 1 } },
  { kw: ['鸡蛋', '水煮蛋', '煎蛋', '蛋'], g: 50, v: { '蛋白质': 6.5, '碳水': 0.6, '脂肪': 5, '铁': 1.2, '锌': 0.7, '维生素D': 1.1, '钾': 70, '镁': 6 } },
  { kw: ['菠菜'], g: 100, v: { '蛋白质': 2.6, '碳水': 3, '脂肪': 0.3, '铁': 2.7, '钙': 99, '维生素C': 32, '钾': 310, '镁': 58, '膳食纤维': 1.7 } },
  { kw: ['西兰花'], g: 100, v: { '蛋白质': 4, '碳水': 4, '脂肪': 0.6, '维生素C': 51, '钙': 47, '钾': 300, '镁': 20, '膳食纤维': 2.6 } },
  { kw: ['青菜', '生菜', '小白菜', '油菜', '蔬菜', '沙拉'], g: 100, v: { '蛋白质': 1.8, '碳水': 2.5, '脂肪': 0.3, '钙': 100, '维生素C': 30, '铁': 1.5, '钾': 250, '镁': 20, '膳食纤维': 1.5 } },
  { kw: ['黄瓜', '青瓜'], g: 100, v: { '蛋白质': 0.8, '碳水': 2.9, '脂肪': 0.2, '膳食纤维': 0.5, '钙': 16, '铁': 0.3, '锌': 0.2, '钾': 150, '镁': 13, '维生素C': 9 } },
  { kw: ['牛肉', '瘦肉', '里脊', '牛排'], g: 100, v: { '蛋白质': 20, '碳水': 1, '脂肪': 5, '铁': 3.3, '锌': 4.7, '钾': 300, '镁': 20 } },
  { kw: ['鸡胸', '鸡腿', '鸡肉'], g: 100, v: { '蛋白质': 22, '碳水': 1, '脂肪': 4, '铁': 1, '锌': 1.3, '钾': 340, '镁': 28 } },
  { kw: ['猪肝', '鸡肝', '肝'], g: 50, v: { '蛋白质': 10, '碳水': 2.5, '脂肪': 1.5, '铁': 11, '锌': 2.5, '维生素C': 10, '钾': 120, '镁': 12 } },
  { kw: ['三文鱼', '鲑鱼'], g: 100, v: { '蛋白质': 20, '碳水': 0.2, '脂肪': 8, '维生素D': 11, 'Omega-3': 1800, '钾': 350, '镁': 30, '锌': 0.6, '钙': 12 } },
  { kw: ['带鱼', '鲈鱼', '鳕鱼', '鱼'], g: 100, v: { '蛋白质': 18, '碳水': 0.5, '脂肪': 4, '维生素D': 5, 'Omega-3': 400, '钾': 330, '镁': 28, '锌': 1, '钙': 30 } },
  { kw: ['虾', '蛤', '贝', '生蚝', '牡蛎'], g: 100, v: { '蛋白质': 18, '碳水': 1, '脂肪': 1, '锌': 2.4, '钙': 90, '钾': 250, '镁': 30 } },
  { kw: ['海带', '紫菜'], g: 50, v: { '蛋白质': 1.5, '碳水': 5, '脂肪': 0.3, '钙': 170, '铁': 1.5, '钾': 150, '镁': 60, '膳食纤维': 3 } },
  { kw: ['米饭', '白饭'], g: 200, v: { '蛋白质': 5, '碳水': 52, '脂肪': 0.6, '膳食纤维': 0.6, '镁': 24, '钾': 60, '锌': 1 } },
  { kw: ['面条', '挂面', '拉面', '刀削面'], g: 250, v: { '蛋白质': 11, '碳水': 62, '脂肪': 1.2, '膳食纤维': 2.5, '镁': 38, '钾': 150 } },
  { kw: ['馒头', '花卷'], g: 100, v: { '蛋白质': 7, '碳水': 47, '脂肪': 1, '膳食纤维': 1.3, '钙': 18, '钾': 80 } },
  { kw: ['面包', '吐司'], g: 100, v: { '蛋白质': 8, '碳水': 50, '脂肪': 5, '膳食纤维': 2.5, '钙': 40, '钾': 100 } },
  { kw: ['粥'], g: 250, v: { '蛋白质': 2.5, '碳水': 25, '脂肪': 0.5, '膳食纤维': 0.5 } },
  { kw: ['土豆', '红薯', '紫薯', '山药'], g: 100, v: { '蛋白质': 1.5, '碳水': 18, '脂肪': 0.2, '膳食纤维': 1.2, '维生素C': 15, '钾': 300, '镁': 20 } },
  { kw: ['燕麦', '糙米', '全麦', '杂粮', '荞麦'], g: 100, v: { '蛋白质': 9, '碳水': 65, '脂肪': 6, '铁': 2.2, '锌': 2.5, '钾': 300, '镁': 110, '膳食纤维': 8 } },
  { kw: ['坚果', '杏仁', '核桃', '花生', '芝麻'], g: 30, v: { '蛋白质': 6, '碳水': 6, '脂肪': 15, '锌': 1, '铁': 0.6, '钾': 200, '镁': 80, '膳食纤维': 2.5 } },
  { kw: ['橙', '橘', '猕猴桃', '柠檬', '草莓'], g: 150, v: { '蛋白质': 1.5, '碳水': 18, '脂肪': 0.5, '维生素C': 50, '钾': 250, '镁': 15, '膳食纤维': 3 } },
  { kw: ['香蕉'], g: 120, v: { '蛋白质': 1.3, '碳水': 27, '脂肪': 0.3, '维生素C': 8, '钾': 330, '镁': 32, '膳食纤维': 2.6 } },
  { kw: ['香菇', '蘑菇', '木耳'], g: 100, v: { '蛋白质': 2, '碳水': 5, '脂肪': 0.4, '维生素D': 2, '锌': 0.7, '钾': 300, '镁': 18, '膳食纤维': 3 } },
];
// 补剂成分 → 营养项（维生素D3 的 IU 按 0.025 折算成 μg）
const FACT_TO_MICRO = { '钙': '钙', '铁': '铁', '锌': '锌', '镁': '镁', '维生素C': '维生素C', '维生素D3': '维生素D', '蛋白质': '蛋白质', 'Omega-3': 'Omega-3' };

let planView = 'train';
try { const savedView = localStorage.getItem(PLAN_VIEW_KEY); if (['train', 'diet', 'micro'].includes(savedView)) planView = savedView; } catch (e) {}

function setPlanView(v) {
  planView = v;
  try { localStorage.setItem(PLAN_VIEW_KEY, v); } catch (e) {}
  document.querySelectorAll('#plan-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.pview === v));
  ['train', 'diet', 'micro'].forEach((k) => {
    const el = $('pview-' + k);
    if (el) el.classList.toggle('hide', k !== v);
  });
  // 进入饮食视图：对仍缺份量的行再补一次（补全失败后的兜底；已在排队的行自动去重）
  if (v === 'diet') state.plan.intake.forEach(queueQtyFill);
}

// 「今天服用了」补剂打卡（按日持久化，跨零点自动清空打卡记录）
// 取消打卡不消失：变灰保留（点一下可恢复），超过 7 天自动清理
const TAKEN_CANCEL_TTL = 7 * 24 * 60 * 60 * 1000;   // 灰色取消记录保留 7 天
let takenState = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(TAKEN_KEY) || '{}');
    if (Array.isArray(raw.ids)) {
      return {
        date: todayStr(),
        ids: raw.date === todayStr() ? raw.ids : [],   // 打卡按天算，过期清空；灰色记录跨天保留
        canceled: Array.isArray(raw.canceled) ? raw.canceled : [],
      };
    }
  } catch (e) {}
  return { date: todayStr(), ids: [], canceled: [] };
})();
function purgeTakenCanceled() {
  const now = Date.now();
  takenState.canceled = takenState.canceled.filter(
    (c) => c && typeof c.id === 'string' && isFinite(Number(c.at)) && now - Number(c.at) < TAKEN_CANCEL_TTL
  );
}
purgeTakenCanceled();   // 启动即清理超期的灰色记录
function saveTakenState() {
  purgeTakenCanceled();
  try { localStorage.setItem(TAKEN_KEY, JSON.stringify(takenState)); } catch (e) {}
}

// ---------- AI 兜底估算：关键词表未收录的食物，让 AI 估出每 100g 营养 ----------
// 同一食物只问一次，结果本地缓存复用；单飞队列，避免并发打爆接口
let microAiCache = null;            // { 食物名: { 营养项: 数值(每100g) } }
const microAiPending = new Set();   // 正在请求中的（避免重复发起）
const microAiFailed = new Set();    // 本次会话估算失败的（避免反复重试，下次打开再试）
const microAiQueue = [];
let microAiBusy = false;

function microAiLoad() {
  if (microAiCache) return microAiCache;
  try { microAiCache = JSON.parse(localStorage.getItem(MICRO_AI_KEY) || '{}'); } catch (e) { microAiCache = {}; }
  if (!microAiCache || typeof microAiCache !== 'object' || Array.isArray(microAiCache)) microAiCache = {};
  return microAiCache;
}
function microAiEntry(name) {
  const v = microAiLoad()[String(name || '').trim()];
  return v && typeof v === 'object' ? { g: 100, v, ai: true } : null;
}
function microAiPrompt(name) {
  return `请估算中式日常食物“${name}”每100克（可食部）的营养含量，只返回一个JSON对象，不要解释、不要代码块。`
    + `单位：蛋白质、碳水、脂肪、膳食纤维用“克”；钙、铁、锌、镁、钾、维生素C、Omega-3用“毫克”；维生素D用“微克”。`
    + `数值为0的项请省略不写。示例：{"蛋白质":5,"碳水":26,"脂肪":0.3,"钙":10,"膳食纤维":1.3}`;
}
function requestMicroAi(name) {
  const key = String(name || '').trim();
  if (!key || microAiLoad()[key] || microAiPending.has(key) || microAiFailed.has(key)) return;
  microAiPending.add(key);
  microAiQueue.push(key);
  microAiPump();
}
function microAiPump() {
  if (microAiBusy) return;
  const key = microAiQueue.shift();
  if (!key) return;
  microAiBusy = true;
  doMicroAiFill(key).finally(() => { microAiBusy = false; microAiPump(); });
}
async function doMicroAiFill(name) {
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'fill', messages: [{ role: 'user', content: microAiPrompt(name) }] }),
    });
    let fullRaw = '';
    const ct = resp.headers.get('Content-Type') || '';
    if (ct.includes('text/event-stream')) {
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = chunk.split('\n').find((l) => l.indexOf('data:') === 0);
          if (!line) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') break;
          let o; try { o = JSON.parse(data); } catch (_) { continue; }
          if (o.t) fullRaw += o.t;
        }
        // 增量解析：JSON 一凑齐立即采用并取消流
        if (parseJsonBlock(fullRaw)) { try { reader.cancel(); } catch (_) {} break; }
      }
    } else {
      const j = await resp.json();
      fullRaw = (j && j.reply) || '';
    }
    const obj = parseJsonBlock(fullRaw);
    if (!obj) throw new Error('no-json');
    const v = {};
    MICRO_TARGETS.forEach((t) => {
      const n = Number(obj[t.k]);
      if (isFinite(n) && n > 0) v[t.k] = n;   // 只收有效数值，0 视为不含
    });
    if (!Object.keys(v).length) throw new Error('empty');
    microAiLoad()[name] = v;
    try { localStorage.setItem(MICRO_AI_KEY, JSON.stringify(microAiCache)); } catch (e) {}
  } catch (e) {
    microAiFailed.add(name);   // 失败静默：本次会话不再重试，等下次打开再试，不打扰用户手填
  } finally {
    microAiPending.delete(name);
  }
  refreshNutriPanels();   // 成功→计入统计；失败→刷新去掉「AI 估算中」提示
}

// 份量 → 克数近似：带克/ml 直接按重量；纯数字时大数（≥10）按克、小数按份数；个/份/碗/杯按一份的参考重量
function microGrams(qty, entry) {
  const s = String(qty || '');
  const m = s.match(/(\d+(?:\.\d+)?)/);
  let num = m ? parseFloat(m[1]) : 1;
  if (!(num > 0)) num = 1;
  if (/克|g|毫升|ml|毫|升/i.test(s)) return num;                      // 明确带重量/体积单位
  if (!/[^\d.\s]/.test(s)) return num >= 10 ? num : num * entry.g;    // 纯数字：250 按克，2 按份
  return num * entry.g;                                               // 个/份/碗/杯等按份数折算
}

function microEstimate() {
  const totals = {};
  const sources = {};   // 每项的主要贡献来源（食物 / 补剂），用于「主要来自」展示
  MICRO_TARGETS.forEach((t) => { totals[t.k] = 0; sources[t.k] = []; });
  // 已打卡的食物
  state.plan.intake.forEach((row) => {
    if (!row.done || !row.name) return;
    const name = String(row.name);
    let entry = FOOD_MICRO.find((f) => f.kw.some((k) => name.includes(k)));
    if (!entry) {
      // 关键词表未收录：用 AI 估算（每 100g）；先发起请求，出结果后自动重算
      entry = microAiEntry(name);
      if (!entry) { requestMicroAi(name); return; }
    }
    const mult = microGrams(row.qty, entry) / entry.g;
    const label = (name.length > 6 ? name.slice(0, 6) : name) + (entry.ai ? '·AI' : '');
    Object.keys(entry.v).forEach((k) => {
      if (totals[k] === undefined) return;
      const add = entry.v[k] * mult;
      totals[k] += add;
      sources[k].push({ name: label, add });
    });
  });
  // 今天已服用的补剂
  takenState.ids.forEach((id) => {
    const s = suppById(id);
    if (!s) return;
    s.facts.forEach((f) => {
      const k = FACT_TO_MICRO[f.k];
      if (!k || totals[k] === undefined) return;
      const add = f.u === 'IU' ? f.n * 0.025 : f.n;   // IU → μg
      totals[k] += add;
      sources[k].push({ name: s.short, add });
    });
  });
  return { totals, sources };
}

// 数值格式化：≥100 取整，否则保留 1 位小数
const microNum = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);

// 小结：列出最需要补的 1-2 项 + 一句建议
function microSummaryHTML(hasData, totals) {
  if (!hasData) return '';
  const gaps = MICRO_TARGETS.map((t) => {
    const ref = microRef(t);
    return { k: t.k, ratio: (totals[t.k] || 0) / ref, pct: Math.round(((totals[t.k] || 0) / ref) * 100) };
  }).filter((x) => x.ratio < 0.9).sort((a, b) => a.ratio - b.ratio).slice(0, 2);
  if (!gaps.length) return '<p class="micro-sum ok">今天各项都接近或达到参考量，保持这个节奏就好。</p>';
  const names = gaps.map((x) => `${x.k} ${x.pct}%`).join('、');
  const tip = MICRO_TIPS[gaps[0].k] || '';
  return `<p class="micro-sum">最需补：${names}。建议：${tip}</p>`;
}

function renderMicroPanel() {
  const list = $('micro-list');
  if (!list) return;
  if (takenState.date !== todayStr()) {   // 跨零点：清空今日打卡，灰色取消记录继续保留
    takenState.date = todayStr();
    takenState.ids = [];
    saveTakenState();
  }
  const { totals, sources } = microEstimate();
  const hasData = state.plan.intake.some((r) => r.done) || takenState.ids.length > 0;
  const sub = $('micro-sub');
  if (sub) sub.textContent = (hasData ? '已按今日打卡饮食 + 补剂折算 · 蛋白质/碳水/脂肪目标随档案动态计算' : '暂无已打卡数据，先记录饮食或勾选上方补剂') + (microAiPending.size ? ' · AI 估算中…' : '');
  list.innerHTML = MICRO_TARGETS.map((t) => {
    const ref = microRef(t);
    const v = totals[t.k] || 0;
    const pct = Math.min(100, Math.round((v / ref) * 100));
    const level = pct >= 90 ? 'ok' : (pct >= 50 ? 'mid' : 'low');
    const tag = hasData ? (pct >= 90 ? '充足' : (pct >= 50 ? '待补' : '偏低')) : '待记录';
    const src = (sources[t.k] || []).slice().sort((a, b) => b.add - a.add).slice(0, 3)
      .map((x) => `${x.name} +${microNum(x.add)}${t.unit}`);
    return `<div class="micro-row">
      <div class="micro-top">
        <span class="micro-k">${t.k}</span>
        <span class="micro-v">${microNum(v)}<i>${t.unit}</i> / ${ref}${t.unit}</span>
        <span class="micro-tag ${hasData ? level : ''}">${tag}</span>
      </div>
      <div class="micro-bar"><span class="micro-fill ${level}" style="width:${hasData ? Math.max(3, pct) : 0}%"></span></div>
      ${hasData && src.length ? `<p class="micro-src">主要来自 ${src.join('、')}</p>` : ''}
    </div>`;
  }).join('') + microSummaryHTML(hasData, totals);
}

// 打卡以「搜索填入」为准：已打卡橙色显示，点一下取消（变灰保留 7 天）；灰色记录点一下恢复
function renderTakenChips() {
  const box = $('taken-chips');
  if (!box) return;
  const on = takenState.ids.map(suppById).filter(Boolean);
  const off = takenState.canceled.map((c) => suppById(c.id)).filter(Boolean);
  if (!on.length && !off.length) {
    box.innerHTML = '<p class="taken-empty">还没有打卡的补剂，搜索后点选即可</p>';
    return;
  }
  box.innerHTML =
    on.map((s) => `<button type="button" class="taken-chip on" data-taken="${s.id}" title="再点一下取消打卡">${s.name}</button>`).join('') +
    off.map((s) => `<button type="button" class="taken-chip off" data-taken="${s.id}" title="已取消打卡，点一下恢复；一周后自动清理">${s.name}</button>`).join('');
}

// 搜索补剂 → 下拉列出文本相近的产品（名称/品牌/成分/类别都能搜，支持「维D3」这类简称），点选即打卡
function takenMatches(q) {
  const s = String(q || '').replace(/\s+/g, '').toLowerCase();
  if (!s) return [];
  return SUPPLEMENTS.filter((x) => {
    const catName = (SUPP_CATS.find((c) => c.id === x.cat) || {}).name || '';
    const facts = x.facts.map((f) => `${f.k}${f.k.replace(/维生素/g, '维')}${f.k.replace(/维生素/g, '')}${f.n}${f.u}`).join('');
    const hay = [x.name, x.short, x.brand, x.form, x.dose, x.fit, suppKindName(x), catName, facts].join('').toLowerCase();
    return hay.includes(s);
  });
}
function renderTakenDrop() {
  const wrap = $('taken-drop');
  const input = $('taken-search');
  if (!wrap || !input) return;
  const q = input.value.trim();
  if (!q) { wrap.classList.add('hide'); wrap.innerHTML = ''; return; }
  const hit = takenMatches(q);
  wrap.classList.remove('hide');
  wrap.innerHTML = hit.length
    ? hit.map((x) => {
        const on = takenState.ids.includes(x.id);
        const off = takenState.canceled.some((c) => c.id === x.id);
        return `<button type="button" class="taken-item${on ? ' on' : ''}" data-taken="${x.id}">
          <span class="taken-item-name">${x.name}</span>
          <span class="taken-item-meta">${x.brand} · ¥${suppDayCost(x).toFixed(1)}/天</span>
          <span class="taken-item-tag">${on ? '已打卡' : (off ? '已取消' : '+ 打卡')}</span>
        </button>`;
      }).join('')
    : '<p class="taken-drop-empty">没找到相关补剂，换个词试试</p>';
}
// 打卡切换（chips 与下拉共用）：写入后同步营养统计与下拉状态
// 取消打卡 = 变灰保留（默认弹窗确认，与训练/饮食取消共用设置里的开关）
function toggleTaken(id) {
  if (takenState.ids.includes(id)) {
    const doCancel = () => {
      const i = takenState.ids.indexOf(id);
      if (i >= 0) takenState.ids.splice(i, 1);
      takenState.canceled = takenState.canceled.filter((c) => c.id !== id);
      takenState.canceled.push({ id, at: Date.now() });   // 灰色记录：点一下可恢复，超 7 天自动清理
      saveTakenState();
      renderTakenChips();
      renderMicroPanel();
      renderTakenDrop();
    };
    if (localStorage.getItem(CONFIRM_CANCEL_KEY) === '0') {
      doCancel(); // 设置里已关闭确认弹窗，直接取消
    } else {
      askCancelDone(doCancel); // 弹出"是否取消完成"确认
    }
    return;
  }
  // 未打卡（含灰色记录）：点选即打卡，同时移出灰色记录
  takenState.canceled = takenState.canceled.filter((c) => c.id !== id);
  takenState.ids.push(id);
  saveTakenState();
  renderTakenChips();
  renderMicroPanel();
  renderTakenDrop();
}

// ---------- AI 营养建议（只看今日营养缺口，只推荐补剂；不缺会直接说不需要） ----------
let adviceState = { sending: false, ctrl: null };

function loadAdviceCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(ADVICE_KEY) || '{}');
    if (raw.date === todayStr() && raw.text) return raw;
  } catch (e) {}
  return null;
}

function todayNutritionContext() {
  const goalMap = { cut: '减脂', bulk: '增肌', sport: '运动表现' };
  const est = microEstimate();
  const microLine = MICRO_TARGETS.map((t) => `${t.k}约${microNum(est.totals[t.k] || 0)}${t.unit}（参考${microRef(t)}${t.unit}）`).join('、');
  const taken = takenState.ids.map((id) => (suppById(id) || {}).short).filter(Boolean);
  return [
    `目标：${goalMap[state.goal] || state.goal}`,
    `营养摄入估算：${microLine}`,
    `今天已服用补剂：${taken.length ? taken.join('、') : '无'}`,
  ].join('\n');
}

// 给 AI 营养师看的「今日营养缺口」小结：低于参考量 85% 才算缺，与补缺方案判定一致
function nutriGapText() {
  const est = microEstimate();
  const hasData = state.plan.intake.some((r) => r.done) || takenState.ids.length > 0;
  if (!hasData) return '今日暂无打卡记录，无法判断缺口。';
  const gaps = MICRO_TARGETS.map((t) => {
    const ref = microRef(t);
    return { k: t.k, unit: t.unit, ref, v: est.totals[t.k] || 0 };
  }).filter((x) => x.v / x.ref < 0.85).sort((a, b) => a.v / a.ref - b.v / b.ref);
  if (!gaps.length) return '今日各项营养都已达到参考量的 85% 以上，没有缺口。';
  return gaps.map((x) => `${x.k}：已摄入约${microNum(x.v)}${x.unit}，参考${x.ref}${x.unit}，还差约${microNum(x.ref - x.v)}${x.unit}`).join('\n');
}

// 回复里提到的产品 → 一键放进对比托盘（按提及顺序，公平不偏袒）
function renderAdvicePicks(container, text) {
  const hit = suppsMentionedIn(text);
  if (!hit.length) return;
  const row = document.createElement('div');
  row.className = 'advice-picks';
  row.innerHTML = '<span class="advice-picks-lbl">提到的产品：</span>' + hit.slice(0, 8).map((s) => {
    const on = suppState.picked.includes(s.id);
    const lbl = suppPickLabel(s, hit);
    return `<button type="button" class="advice-pick${on ? ' on' : ''}" data-apick="${s.id}" data-lbl="${lbl}">${on ? '已加入 ' : '+ '}${lbl}</button>`;
  }).join('') + '<span class="advice-picks-tip"></span>';
  container.appendChild(row);
}

function renderAdviceCard() {
  const body = $('advice-body');
  const acts = $('advice-actions');
  if (!body || !acts || adviceState.sending) return;   // 流式生成中不覆盖
  const cached = loadAdviceCache();
  body.innerHTML = '';
  acts.innerHTML = '';
  if (!cached) {
    const p = document.createElement('p');
    p.className = 'advice-text empty';
    p.textContent = '还没有建议。小颖只看你的营养缺口：需要补时只推荐补剂，不缺会直接告诉你不需要。';
    body.appendChild(p);
    const b = document.createElement('button');
    b.className = 'advice-btn';
    b.textContent = '让 AI 营养师给建议';
    b.addEventListener('click', () => askPlanAdvice());
    acts.appendChild(b);
    return;
  }
  const p = document.createElement('p');
  p.className = 'advice-text';
  p.textContent = cached.text;
  body.appendChild(p);
  renderAdvicePicks(body, cached.text);
  const re = document.createElement('button');
  re.className = 'advice-refresh';
  re.textContent = '重新生成';
  re.addEventListener('click', () => askPlanAdvice(true));
  acts.appendChild(re);
  const when = document.createElement('span');
  when.className = 'advice-when';
  when.textContent = '今日已生成 · 数据有变化可重新生成';
  acts.appendChild(when);
}

async function askPlanAdvice(force) {
  if (adviceState.sending) return;
  if (!force && loadAdviceCache()) { renderAdviceCard(); return; }
  adviceState.sending = true;
  adviceState.ctrl = new AbortController();
  const body = $('advice-body');
  const acts = $('advice-actions');
  if (!body || !acts) return;
  acts.innerHTML = '';
  body.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'advice-text';
  p.textContent = '正在核对你的营养缺口…';
  body.appendChild(p);
  const messages = [{
    role: 'user',
    content: `【可选产品清单】\n${aiCatalogText()}\n\n【今日营养情况】\n${nutriGapText()}\n\n【我的今日情况】\n${todayNutritionContext()}\n\n请只推荐补剂（不要食物、饮食或训练建议）：针对仍缺的营养给出补剂建议；若各项都达标，直接回复今天不缺少、不需要额外补剂，不要推荐产品。`,
  }];
  let full = '';
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: adviceState.ctrl.signal,
      body: JSON.stringify({ mode: 'nutrition', profile: buildProfile(), goal: state.goal, messages }),
    });
    const ct = resp.headers.get('Content-Type') || '';
    if (!ct.includes('text/event-stream')) {
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'AI 营养师暂时不在线');
      full = data.reply || '';
    } else {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const evt = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const dline = evt.split('\n').find((l) => l.startsWith('data:'));
          if (!dline) continue;
          const payload = dline.slice(5).trim();
          if (payload === '[DONE]') continue;
          let o;
          try { o = JSON.parse(payload); } catch (_) { continue; }
          if (o.error) throw new Error(o.error);
          if (o.t) { full += o.t; p.textContent = extractPlanBlock(full).cleanText; }
        }
      }
    }
    if (!full) throw new Error('没有收到回复，再试一次？');
    // 只展示正文：万一模型夹带 [[PLAN]] 数据块，显示与缓存前统一剥离
    const clean = extractPlanBlock(full).cleanText || '这次没生成有效回复，可以点「重新生成」再试。';
    p.textContent = clean;
    try { localStorage.setItem(ADVICE_KEY, JSON.stringify({ date: todayStr(), text: clean })); } catch (e) {}
    adviceState.sending = false;
    adviceState.ctrl = null;
    renderAdviceCard();   // 渲染产品快捷按钮 + 重新生成按钮
  } catch (e) {
    adviceState.sending = false;
    adviceState.ctrl = null;
    if (e.name === 'AbortError') { renderAdviceCard(); return; }
    const tip = e.message.includes('Failed to fetch') ? '连不上服务器，确认后端已启动后再试。' : e.message;
    p.textContent = '连接异常：' + tip;
    const b = document.createElement('button');
    b.className = 'advice-btn';
    b.textContent = '重试';
    b.addEventListener('click', () => askPlanAdvice(true));
    acts.innerHTML = '';
    acts.appendChild(b);
  }
}

// ---------- AI 补缺方案（按今日缺口算食物组合，一键加入今日饮食） ----------
const GAP_KEY = 'zhidong_gap_advice_v1';
let gapState = { sending: false, ctrl: null, foods: [] };

function loadGapCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(GAP_KEY) || '{}');
    if (raw.date === todayStr() && raw.text) return raw;
  } catch (e) {}
  return null;
}

// 补缺方案的「数据指纹」：饮食/补剂打卡一变，旧方案即视为过时（打开窗口时自动重新生成）
function gapSignature() {
  const est = microEstimate();
  const nums = MICRO_TARGETS.map((t) => Math.round((est.totals[t.k] || 0) * 10) / 10);
  const cal = Math.round(sumDoneCal(state.plan.intake));
  const burn = Math.round(sumDoneCal(state.plan.workout) + sumDoneCal(state.plan.cardio));
  return JSON.stringify([todayStr(), nums, cal, burn]);
}

// 今日营养缺口：按「参考量 − 已摄入」列出还差的项（约 85% 以上视为差不多达标），并带上热量情况
function gapContext() {
  const goalMap = { cut: '减脂', bulk: '增肌', sport: '运动表现' };
  const est = microEstimate();
  const gaps = MICRO_TARGETS.map((t) => {
    const ref = microRef(t);
    const v = est.totals[t.k] || 0;
    return { k: t.k, unit: t.unit, ref, v, pct: Math.round((v / ref) * 100), need: ref - v };
  }).filter((x) => x.pct < 85).sort((a, b) => a.pct - b.pct).slice(0, 5);
  const doneIntake = state.plan.intake.filter((r) => r.done)
    .map((r) => `${r.name}${r.qty ? ' ' + r.qty : ''}（约${Math.round(Number(r.cal) || 0)}kcal）`);
  const target = targetCalories();
  const intake = Math.round(sumDoneCal(state.plan.intake));
  const burn = Math.round(sumDoneCal(state.plan.workout) + sumDoneCal(state.plan.cardio));
  let calLine = '热量：个人资料未完善，暂无目标';
  if (target) {
    const diff = target - intake;
    if (diff <= 0) calLine = `热量：今日已超出目标约${-diff}kcal（已达标，严禁再建议加餐或增加热量）`;
    else if (diff <= target * 0.1) calLine = `热量：距目标还差${diff}kcal，视为差不多达标（不必再补热量）`;
    else calLine = `热量：距目标还差约${diff}kcal（目标${target}kcal，已摄入约${intake}kcal）`;
  }
  return [
    `目标：${goalMap[state.goal] || state.goal}；体重：${state.weight || '未填'}kg`,
    `${calLine}；今日运动消耗约${burn}kcal`,
    `今日饮食（已打卡${doneIntake.length}项）：${doneIntake.length ? doneIntake.join('、') : '暂无记录'}`,
    '【今日营养缺口】（达到参考量约 85% 即视为差不多达标，不算缺口）',
    gaps.length
      ? gaps.map((x) => `${x.k}：已${microNum(x.v)}${x.unit} / 参考${x.ref}${x.unit}，还缺约${microNum(x.need)}${x.unit}`).join('\n')
      : '各项都已差不多达标，无需刻意补缺，可给饮食均衡的提醒',
  ].join('\n');
}

// 建议食物 → 每行「+ 加入」；已在今日饮食里的显示「已加入」，避免重复添加
function renderGapFoods(container, foods) {
  const list = (Array.isArray(foods) ? foods : []).filter((f) => f && f.name);
  gapState.foods = list;
  if (!list.length) {
    const tip = document.createElement('p');
    tip.className = 'advice-picks-tip';
    tip.textContent = '本次没有需要加入的食物。';
    container.appendChild(tip);
    return;
  }
  const row = document.createElement('div');
  row.className = 'advice-picks';
  row.innerHTML = '<span class="advice-picks-lbl">建议食物：</span>' + list.map((f, i) => {
    const on = state.plan.intake.some((r) => r.name === f.name);
    return `<button type="button" class="advice-pick${on ? ' on' : ''}" data-gapfood="${i}">${on ? '已加入 ' : '+ '}${f.name}${f.qty ? ' ' + f.qty : ''}</button>`;
  }).join('') + '<span class="advice-picks-tip"></span>';
  container.appendChild(row);
}

// 小窗口开关：点入口打开；点窗口外或手机滑边框返回关闭
// 打开时往历史栈压一层专属哨兵：手机滑边框返回会先消费它（只关窗口），不会继续往回直接退出 App
let gapSentinelOn = false;      // 小窗口的专属哨兵是否已在历史栈上
let gapPopSuppress = false;     // 点击关闭（窗口外/关闭按钮）自己退栈时，忽略随之而来的 popstate
function openGapModal() {
  const m = $('gap-modal');
  if (!m) return;
  m.classList.remove('hide');
  if (!gapSentinelOn) {
    try { history.pushState({ zdGap: true }, ''); gapSentinelOn = true; } catch (e) {}
  }
  // 打卡数据有变化：打开时自动按最新数据重新生成，避免显示过时的「还缺」方案
  const cached = loadGapCache();
  if (cached && cached.sig !== gapSignature()) { askGapAdvice(true); return; }
  renderGapCard();
}

// fromBack=true 表示本次关闭是返回手势消费掉专属哨兵后触发的，历史已退过一层，无需再退
function closeGapModal(fromBack) {
  const m = $('gap-modal');
  if (m) m.classList.add('hide');
  if (gapSentinelOn) {
    gapSentinelOn = false;
    if (!fromBack) {
      gapPopSuppress = true;
      try { history.back(); } catch (e) { gapPopSuppress = false; }
    }
  }
}

function renderGapCard() {
  const body = $('gap-body');
  const acts = $('gap-actions');
  if (!body || !acts || gapState.sending) return;   // 流式生成中不覆盖
  const cached = loadGapCache();
  body.innerHTML = '';
  acts.innerHTML = '';
  if (!cached) {
    const p = document.createElement('p');
    p.className = 'advice-text empty';
    p.textContent = '让 AI 对照上面的缺口，算出今天吃什么补、吃多少；点「+ 加入」放进今日饮食，打卡后统计自动补上。';
    body.appendChild(p);
    const b = document.createElement('button');
    b.className = 'advice-btn';
    b.textContent = '让 AI 算一下怎么补';
    b.addEventListener('click', () => askGapAdvice());
    acts.appendChild(b);
    return;
  }
  const p = document.createElement('p');
  p.className = 'advice-text';
  p.textContent = cached.text;
  body.appendChild(p);
  if (cached.sig !== gapSignature()) {
    // 打卡数据已变化：不展示过时的「建议食物」，提示重新生成
    const tip = document.createElement('p');
    tip.className = 'gap-stale';
    tip.textContent = '饮食或补剂已更新，这份方案已过时，点「重新生成」看最新方案。';
    body.appendChild(tip);
  } else {
    renderGapFoods(body, cached.plan);
  }
  const re = document.createElement('button');
  re.className = 'advice-refresh';
  re.textContent = '重新生成';
  re.addEventListener('click', () => askGapAdvice(true));
  acts.appendChild(re);
  const when = document.createElement('span');
  when.className = 'advice-when';
  when.textContent = '今日已生成 · 饮食有变化可重新生成';
  acts.appendChild(when);
}

async function askGapAdvice(force) {
  if (gapState.sending) return;
  if (!force && loadGapCache()) { renderGapCard(); return; }
  const body = $('gap-body');
  const acts = $('gap-actions');
  if (!body || !acts) return;
  gapState.sending = true;
  gapState.ctrl = new AbortController();
  acts.innerHTML = '';
  body.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'advice-text';
  p.textContent = '正在对照今天的缺口算食物搭配…';
  body.appendChild(p);
  const messages = [{
    role: 'user',
    content: `【我的今日情况】\n${gapContext()}\n\n请按上面的数据给建议（标注「差不多达标/已超出」的不要再算进缺口），并在最后附上 [[PLAN]] 数据块。`,
  }];
  const sig = gapSignature();   // 记录本次生成时的数据指纹
  let full = '';
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: gapState.ctrl.signal,
      body: JSON.stringify({ mode: 'gap', profile: buildProfile(), goal: state.goal, messages }),
    });
    const ct = resp.headers.get('Content-Type') || '';
    if (!ct.includes('text/event-stream')) {
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'AI 营养师暂时不在线');
      full = data.reply || '';
    } else {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const evt = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const dline = evt.split('\n').find((l) => l.startsWith('data:'));
          if (!dline) continue;
          const payload = dline.slice(5).trim();
          if (payload === '[DONE]') continue;
          let o;
          try { o = JSON.parse(payload); } catch (_) { continue; }
          if (o.error) throw new Error(o.error);
          if (o.t) { full += o.t; p.textContent = extractPlanBlock(full).cleanText; }   // 流式显示不带数据块
        }
      }
    }
    const parsed = extractPlanBlock(full);
    const text = parsed.cleanText || '';
    if (!text) throw new Error('没有收到回复，再试一次？');
    p.textContent = text;
    const plan = parsed.data && Array.isArray(parsed.data.intake)
      ? parsed.data.intake.map((x) => normItem(x, ['cal'])).filter(Boolean)
        .map((x) => ({ name: x.name, qty: x.qty || '', cal: x.cal || 0 }))
      : [];
    try { localStorage.setItem(GAP_KEY, JSON.stringify({ date: todayStr(), text, plan, sig })); } catch (e) {}
    gapState.sending = false;
    gapState.ctrl = null;
    renderGapCard();   // 渲染「+ 加入」按钮 + 重新生成按钮
  } catch (e) {
    gapState.sending = false;
    gapState.ctrl = null;
    if (e.name === 'AbortError') { renderGapCard(); return; }
    const tip = e.message.includes('Failed to fetch') ? '连不上服务器，确认后端已启动后再试。' : e.message;
    p.textContent = '连接异常：' + tip;
    const b = document.createElement('button');
    b.className = 'advice-btn';
    b.textContent = '重试';
    b.addEventListener('click', () => askGapAdvice(true));
    acts.innerHTML = '';
    acts.appendChild(b);
  }
}

// 供今日计划的打卡 / 编辑流程调用（补剂数据在文件后段定义，未就绪时跳过）
function refreshNutriPanels() {
  if (!window.__nutriReady) return;
  renderMicroPanel();
  renderTakenChips();
  renderAdviceCard();
  renderGapCard();
}

(function bindPlanViews() {
  if (!$('plan-seg')) return;
  $('plan-seg').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (b) setPlanView(b.dataset.pview);
  });
  $('taken-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-taken]');
    if (b) toggleTaken(b.dataset.taken);
  });
  // 搜索打卡：输入即看下拉，点选打卡；回车快捷打卡第一条匹配；点空白处收起
  const tSearch = $('taken-search');
  if (tSearch) {
    tSearch.addEventListener('input', renderTakenDrop);
    tSearch.addEventListener('focus', renderTakenDrop);
    tSearch.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const first = takenMatches(tSearch.value)[0];
      if (first) toggleTaken(first.id);
    });
    $('taken-drop').addEventListener('click', (e) => {
      const b = e.target.closest('[data-taken]');
      if (b) toggleTaken(b.dataset.taken);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.taken-search-wrap')) $('taken-drop').classList.add('hide');
    });
  }
  $('advice-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-apick]');
    if (!b) return;
    const id = b.dataset.apick;
    const row = b.closest('.advice-picks');
    const tip = row ? row.querySelector('.advice-picks-tip') : null;
    const s = suppById(id);
    const cur = suppState.picked.map(suppById).filter(Boolean);
    if (!suppState.picked.includes(id) && cur.length && s && s.kind !== cur[0].kind) {
      if (tip) tip.textContent = `只能比对同一种补剂（当前：${suppKindName(cur[0])}），先去「优选」移出已选`;
      return;
    }
    if (!suppState.picked.includes(id) && suppState.picked.length >= 3) {
      if (tip) tip.textContent = '对比最多 3 件，先去「优选」移出一件';
      return;
    }
    toggleSuppPick(id);
    const on = suppState.picked.includes(id);
    b.classList.toggle('on', on);
    b.textContent = (on ? '已加入 ' : '+ ') + (b.dataset.lbl || (suppById(id) || {}).short);
    if (tip) tip.textContent = on ? '已放进对比托盘，去「优选」看对比表' : '';
  });
  // AI 补缺方案小窗口：入口打开，点窗口外 / 右上角 × 关闭
  $('gap-entry').addEventListener('click', openGapModal);
  $('gap-modal').addEventListener('click', (e) => { if (e.target === $('gap-modal')) closeGapModal(); });
  $('gap-close').addEventListener('click', () => closeGapModal());
  // AI 补缺方案：建议食物一键加入今日饮食（同名不重复添加）
  $('gap-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-gapfood]');
    if (!b) return;
    const f = gapState.foods[Number(b.dataset.gapfood)];
    if (!f || !f.name) return;
    if (!state.plan.intake.some((r) => r.name === f.name)) {
      const newRow = { name: f.name, qty: f.qty || '', cal: Number(f.cal) || 0, done: false };
      state.plan.intake.push(newRow);
      queueQtyFill(newRow);   // 方案里没带份量时，后台静默补上
      savePlan();
    }
    renderPlan();   // 刷新饮食列表 + 营养统计，按钮同步变「已加入」
    const row = $('gap-body').querySelector('.advice-picks');
    const tip = row ? row.querySelector('.advice-picks-tip') : null;
    if (tip) tip.textContent = '已加入今日饮食，去「饮食」视图打卡后计入统计';
  });
  window.__nutriReady = true;
  setPlanView(planView);
  refreshNutriPanels();
})();

// ============ 首页精选信息流（健身内容 + 广告，下滑加载新内容，不刷新页面） ============
(function () {
  const feedList = document.getElementById('feed-list');
  const sentinel = document.getElementById('feed-sentinel');
  const loadingEl = document.getElementById('feed-loading');
  if (!feedList || !sentinel) return;

  // 海报图统一走项目约定的文生图接口（真实图片、可离线加载于服务器也是国内源）
  const IMG = (prompt) =>
    'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=' +
    encodeURIComponent(prompt) + '&image_size=landscape_4_3';

  // 精选海报池：少量复用以减少加载请求次数，依旧每张卡风格鲜明
  const POSTERS = {
    hiit: IMG('gym, athlete doing high intensity interval training with battle ropes, dramatic rim light, photorealistic, landscape'),
    cardio: IMG('person running outdoors on a path at golden hour, fitness, energetic, photorealistic, landscape'),
    yoga: IMG('tranquil yoga studio, woman holding tree pose on green mat, soft window light, photorealistic, landscape'),
    stretch: IMG('athlete stretching arms and back with yoga band in bright gym, warm tones, photorealistic, landscape'),
    food: IMG('healthy meal prep bowls with chicken breast brown rice and greens, top view, bright, photorealistic, landscape'),
    protein: IMG('fitness protein shake bottle next to eggs walnuts and salmon, food photography, bright, landscape'),
    weights: IMG('barbell bench press, athlete training chest in moody gym, steam, photorealistic, landscape'),
    adsport: IMG('sports product advertisement, running shoes and pink dumbbells on gradient studio background, cinematography, landscape'),
    rest: IMG('cozy rest corner with mat and water bottle after workout, soft morning light, photorealistic, landscape'),
  };

  // 真正可自托管的示例视频（离线可播，先放通用 CC0 短片，后续可替换为专属健身跟练视频）
  const FEED_VIDEOS = [
    { f: 'tim-barbell-back-squat.mp4',       title: '深蹲 · 强化臀腿力量', tag: '下肢' },
    { f: 'tim-barbell-bench-press.mp4',      title: '卧推 · 练出厚实胸肌', tag: '胸' },
    { f: 'tim-barbell-deadlift.mp4',         title: '硬拉 · 激活全身力量', tag: '背' },
    { f: 'tim-dumbbell-lateral-raise.mp4',   title: '侧平举 · 打造肩部线条', tag: '肩' },
    { f: 'tim-hammer-curls.mp4',             title: '锤式弯举 · 手臂增肌', tag: '臂' },
    { f: 'tim-kettlebell-swing.mp4',         title: '壶铃摆动 · 高效燃脂', tag: '燃脂' },
  ];

  // 信息流数据（分多批，滚动到底自动追加下一批；测试时可循环刷出新内容）
  const F = (title, poster, tag) => ({ type: 'image', title, poster, tag });
  const V = (vi) => ({ type: 'video', vi });
  const A = (title, desc) => ({ type: 'ad', title, desc });
  const FEED_BATCHES = [
    [F('每天十分钟，告别久坐腰酸', POSTERS.stretch, '久坐救星'), V(1), F('练前一顿这样吃，状态翻倍', POSTERS.food, '练前饮食'), A('月卡限时 5 折', '专业私教陪你度过新手期')],
    [V(0), F('核心不弱，动作才稳', POSTERS.hiit, '核心训练'), F('蛋白质这样搭，增肌不白练', POSTERS.protein, '营养'), V(3)],
    [A('跑步装备上新', '透气速干，专为夜跑设计'), F('体态矫正：别再含胸驼背', POSTERS.yoga, '体态'), V(2), F('强度训练后，这样放松更快', POSTERS.rest, '恢复')],
    [F('想瘦得快，先学会吃', POSTERS.food, '减脂'), V(1), A('7 天燃脂跟练营', '每天 20 分钟，燃脂不掉肌肉'), F('肩背线条，从板凳俯卧撑开始', POSTERS.hiit, '上肢')],
    [V(0), F('睡前 5 分钟，睡得更香', POSTERS.yoga, '助眠'), F('心率区间怎么定？一文讲透', POSTERS.cardio, '科普'), A('智能手环特惠', '记录每日心率与睡眠')],
    [F('新手到底该练什么？', POSTERS.weights, '新手必看'), V(3), F('增肌与减脂，差在哪一步', POSTERS.protein, '知识'), F('练腿日，这样安排更高效', POSTERS.weights, '下肢')],
    [A('高蛋白轻食外卖', '优质蛋白 + 粗粮，吃了不负担'), V(2), F('久坐肩颈僵？试试这组拉伸', POSTERS.stretch, '肩颈'), F('早餐这样吃，一整天不饿', POSTERS.food, '早餐')],
    [F('力量训练前后，该不该加餐', POSTERS.food, '营养'), V(1), A('首单立减 30 元', '健身营养品一站购齐'), F('摄影级健身房，今日拍摄花絮', POSTERS.rest, '幕后')],
  ];

  let batchIdx = 0;
  let loading = false;
  let suppAdSeq = Math.floor(Math.random() * SUPPLEMENTS.length);   // 补剂广告轮换序号：随机起点，保证每款产品长期曝光均匀（不偏袒靠前品牌）
  // 信息流卡片的累计序号：用于在无限下滑时裁掉最旧的卡片，控制页面上保留的数量
  let feedSeq = 0;
  const MAX_FEED_CARDS = 100; // 下滑太多就删去顶部旧内容，页面上最多保留约 100 条
  const cardVi = (c) => { const b = c.querySelector('.feed-play'); return (b && b.dataset.vi !== undefined) ? parseInt(b.dataset.vi, 10) : -1; };

  function cardHTML(it) {
    if (it.type === 'ad') {
      return `
        <article class="feed-card feed-ad">
          <span class="feed-adtag">广告</span>
          <div class="feed-adsrc">
            <h3 class="feed-ctitle">${it.title}</h3>
            <p class="feed-desc">${it.desc}</p>
          </div>
          <button class="feed-adbtn">去了解</button>
        </article>`;
    }
    if (it.type === 'video') {
      const v = FEED_VIDEOS[it.vi % FEED_VIDEOS.length];
      const pk = ['stretch', 'yoga', 'weights', 'hiit'][it.vi % 4];
      return `
        <article class="feed-card feed-video">
          <div class="feed-media">
            <div class="feed-poster">
              <img src="${POSTERS[pk]}" alt="${v.title}" loading="lazy" />
              <button class="feed-play" data-vi="${it.vi % FEED_VIDEOS.length}" aria-label="播放"><svg class="i"><use href="#i-play"/></svg></button>
            </div>
            <video class="feed-vp" controls preload="none" playsinline></video>
          </div>
          <div class="feed-body">
            <h3 class="feed-ctitle">${v.title}</h3>
            <div class="feed-meta"><span class="feed-tag">${v.tag}</span><span class="feed-tag">可播放视频</span></div>
          </div>
        </article>`;
    }
    return `
      <article class="feed-card feed-img">
        <div class="feed-media">
          <img src="${it.poster}" alt="${it.title}" loading="lazy" />
          <span class="feed-poster-tag">${it.tag}</span>
        </div>
        <div class="feed-body">
          <h3 class="feed-ctitle">${it.title}</h3>
          <div class="feed-meta"><span class="feed-tag">${it.tag}</span><span>精选内容</span></div>
        </div>
      </article>`;
  }

  function appendFeedBatch() {
    if (loading) return;
    loading = true;
    loadingEl.classList.add('on');
    const resolve = () => {
      try {
        const batch = FEED_BATCHES[batchIdx % FEED_BATCHES.length];
        batchIdx++;
        const parts = batch.map(cardHTML);
        // 补剂广告：权重较低——每 2 批穿插 1 条，随机落在中部位置，避免刷屏
        if (batchIdx % 2 === 0) {
          const s = SUPPLEMENTS[suppAdSeq % SUPPLEMENTS.length];
          suppAdSeq++;
          const pos = 1 + Math.floor(Math.random() * Math.max(1, parts.length - 1));
          parts.splice(pos, 0, suppAdHTML(s));
        }
        const frag = document.createRange().createContextualFragment(parts.join(''));
        // 左右两列按实际高度均分（谁矮放谁），追加后再微调，保证两列底边对齐
        const colL = $('feed-col-l');
        const colR = $('feed-col-r');
        Array.from(frag.children).forEach((el) => {
          el.dataset.seq = String(feedSeq++);   // 给每个卡片标记递增序号，便于按新旧裁掉顶部旧内容
          const hL = colL.scrollHeight, hR = colR.scrollHeight;
          (hL <= hR ? colL : colR).appendChild(el);
        });
        for (let g = 0; g < 8 && colL.lastElementChild && colR.lastElementChild; g++) {
          const hL = colL.scrollHeight, hR = colR.scrollHeight;
          if (Math.abs(hL - hR) < 44) break;
          if (hL > hR) colR.appendChild(colL.lastElementChild);
          else colL.appendChild(colR.lastElementChild);
        }
        pruneFeed(); // 下滑多了就删掉顶部最旧的卡片，保留最近约 100 条
      } finally {
        loadingEl.classList.remove('on');
        loading = false;
      }
      // 若追加后底部哨兵仍在加载触发区内（首批太短没铺满首屏），继续追加直到铺满，
      // 避免“只在加载瞬间触发一次就不再增长”的边界问题
      if (sentinelNear()) appendFeedBatch();
    };
    // 模拟一次轻量加载动画，绝不是整页刷新；时间短、内容原地追加
    setTimeout(resolve, 350 + Math.round(Math.random() * 350));
  }
  function sentinelNear() {
    const r = sentinel.getBoundingClientRect();
    return r.top < (window.innerHeight + 120);
  }

  // 当页面上信息流卡片超过保留上限时，按加载序号删掉最旧的卡片，只保留最近 N 条
  function pruneFeed() {
    const cards = Array.from(feedList.querySelectorAll('.feed-video'));
    if (cards.length <= MAX_FEED_CARDS) return;
    const removeCount = cards.length - MAX_FEED_CARDS;
    cards.sort((a, b) => parseInt(a.dataset.seq || '0', 10) - parseInt(b.dataset.seq || '0', 10));
    for (let i = 0; i < removeCount; i++) cards[i].remove();
  }

  // 播放完毕自动连播：提示 + 同一播放器切换到下一篇
  const toast = document.getElementById('feed-toast');
  let toastTimer = null;
  const showToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  };

  // 自动连播：记录最近一次用户操作；停止操作 3s 且视频放完则恢复连播
  let lastInteract = 0;
  let autoTimer = null;
  const userInteracted = () => {
    lastInteract = Date.now();
    clearTimeout(autoTimer);
  };

  // 已加载内容里没有下一张未播视频 → 下滑加载更多，再播放新出现的视频
  const playAfterLoadMore = (fromCard, tries) => {
    if (tries >= 6) {
      // 兜底：所有视频都看过且加载不出新内容，原地缓存下一批待续看
      return;
    }
    appendFeedBatch(); // 追加新一批内容（自带加载动画，非页面刷新）
    // 自动播放的下滑时间：在原有基础上加 1s，确保先刷新完成再播放
    autoTimer = setTimeout(() => {
      let nxt = null;
      for (const c of feedList.querySelectorAll('.feed-video')) {
        const cvi = cardVi(c);
        const pp = c.querySelector('.feed-poster');
        if (c !== fromCard && cvi >= 0 && pp && !pp.classList.contains('hide')) { nxt = c; break; }
      }
      if (nxt) {
        const t = nxt.querySelector('.feed-ctitle').textContent;
        nxt.scrollIntoView({ behavior: 'smooth', block: 'center' });
        autoTimer = setTimeout(() => { const b = nxt.querySelector('.feed-play'); if (b) b.click(); }, 350);
      } else {
        playAfterLoadMore(fromCard, tries + 1);
      }
    }, 1600);
  };

  // 播放：点击海报 → 原地替换成真实可播放的 <video>
  feedList.addEventListener('click', (e) => {
    const btn = e.target.closest('.feed-play');
    if (!btn) return;
    const card = btn.closest('.feed-video');
    const poster = card.querySelector('.feed-poster');
    const video = card.querySelector('.feed-vp');
    const vi = parseInt(btn.dataset.vi, 10) % FEED_VIDEOS.length;
    const v = FEED_VIDEOS[vi];
    video.dataset.vi = vi;
    video.src = '/media/feeds/' + v.f;
    poster.classList.add('hide');
    video.classList.remove('hide');
    video.play().catch(() => {});
    // 用户主动点了播放：视为一次操作
    lastInteract = Date.now();
    // 用户暂停或拖动进度：记录操作时间，进入「3s 无操作才恢复连播」
    video.onpause = () => userInteracted();
    video.onseeked = () => userInteracted();

    // 播放完毕：仅当首页当前可见才自动连播；离开首页/切后台则保持原位
    video.onended = () => {
      if (!homeActive()) return;
      const wait = Math.max(0, 3000 - (Date.now() - lastInteract));
      autoTimer = setTimeout(() => {
        if (!homeActive() || Date.now() - lastInteract < 3000) return; // 期间又有操作或已离开首页，放弃本次
        const cards = Array.from(feedList.querySelectorAll('.feed-video'));
        // 以当前卡片为锚，按屏幕垂直距离找最近的、内容还没看过的视频卡
        const ar = card.getBoundingClientRect();
        const ay = ar.top + ar.height / 2;
        const ax = ar.left + ar.width / 2;
        let best = null, bestDy = Infinity, bestScore = Infinity;
        for (const c of cards) {
          if (c === card) continue;
          const cvi = cardVi(c);
          if (cvi < 0) continue;
          const pp = c.querySelector('.feed-poster');
          if (pp && pp.classList.contains('hide')) continue; // 该内容块已看过，同一卡不重复看
          const r = c.getBoundingClientRect();
          const dy = r.top + r.height / 2 - ay;
          const score = Math.abs(dy) + Math.abs((r.left + r.width / 2) - ax) * 0.5; // 同屏水平偏移轻量加权
          const win = !best || score < bestScore - 0.5 ||
                      (Math.abs(score - bestScore) <= 0.5 && bestDy < 0 && dy >= 0);
          if (win) { best = c; bestScore = score; bestDy = dy; }
        }
        if (best) {
          const title = best.querySelector('.feed-ctitle').textContent;
          best.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          showToast(title);
          // 若这张需要下滑较多才能看到，则给足下滑+播放缓冲（约 +1s）
          const farBelow = best.getBoundingClientRect().top > innerHeight * 0.6;
          autoTimer = setTimeout(() => { const b = best.querySelector('.feed-play'); if (b) b.click(); }, farBelow ? 1400 : 400);
        } else {
          // 附近都看完 → 先下滑加载新内容，再播放（见 playAfterLoadMore）
          playAfterLoadMore(card, 0);
        }
      }, wait);
    };
  });

  // 底部哨兵可见 → 追加下一批；保持旧内容在上、可上滑回看
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) appendFeedBatch(); });
  }, { rootMargin: '120px 0px' });
  observer.observe(sentinel);

        // 一键回到顶部：下滑超过一屏才显示，点击平滑回到顶部
        const topBtn = document.getElementById('feed-top');
        const showTopBtn = () => {
          const y = window.scrollY || document.documentElement.scrollTop || 0;
          topBtn.classList.toggle('show', y > window.innerHeight * 0.8 && y > 120);
        };
        window.addEventListener('scroll', showTopBtn, { passive: true });
        topBtn.addEventListener('click', () => {
          const startY = window.scrollY || document.documentElement.scrollTop || 0;
          if (startY <= 0) return;
          // 自定义快速上滑：原生 smooth 速度不可调，这里用 rAF 在 ~260ms 内快速回到顶部
          const dur = 260;
          const t0 = performance.now();
          const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const step = (now) => {
            const p = Math.min((now - t0) / dur, 1);
            window.scrollTo(0, Math.round(startY * (1 - ease(p))));
            if (p < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });

        // 任何用户操作（点击 / 触摸滚动 / 滚轮翻页）都立即停止自动连播。
        // 注意：自动连播内部用的是 scrollIntoView + programmatic .click()，
        // 它们不会触发 pointerdown / touchstart / wheel，因此不会被误判为「用户操作」。
        document.addEventListener('pointerdown', userInteracted, { passive: true });
        document.addEventListener('touchstart', userInteracted, { passive: true });
        document.addEventListener('wheel', userInteracted, { passive: true });

  // 首页当前是否可见（显示中且未被切后台）——只有此时才允许自动连播
  const homeActive = () => document.getElementById('tab-home') && document.getElementById('tab-home').classList.contains('active') && !document.hidden;

  // 暂停首页所有正在播放的视频并取消自动连播定时器
  const pauseFeed = () => {
    feedList.querySelectorAll('video.feed-vp').forEach((vd) => { if (!vd.paused) vd.pause(); });
    clearTimeout(autoTimer);
    lastInteract = Date.now(); // 记录原操作，避免后台回归后自动续播
  };
  window.__feedPause = pauseFeed;
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseFeed(); });

  // 首屏先来一批，避免空白；之后完全靠下滑触发，不再刷新页面
  appendFeedBatch();
})();

// ============ 姿势识别（选今日力量训练 → 摄像头跟练 → 语音提示，纯前端 MediaPipe） ============
(function () {
  const video = $('pose-video');
  const canvas = $('pose-canvas');
  const toggle = $('pose-toggle');
  const loading = $('pose-loading');
  const placeholder = $('pose-placeholder');
  const pickCard = $('pose-pick');
  const liveCard = $('pose-live');
  const resultCard = $('pose-result');
  if (!video || !canvas || !toggle) return; // 页面缺失则不初始化

  let landmarker = null;      // PoseLandmarker 实例
  let stream = null;          // 摄像头 MediaStream
  let rafId = null;           // 检测循环 rAF
  let running = false;
  let ctx2d = canvas.getContext('2d');
  const CIR = 314.16;
  const ring = $('pose-ring');
  const scoreEl = $('pose-score');
  const statusEl = $('pose-status');
  const hintEl = $('pose-hint');
  let lastTs = 0, fps = 0;

  // ---------- 跟练会话状态 ----------
  const VOICE_KEY = 'zhidong_pose_voice_v1';
  const FORM_PASS = 65;     // 单帧标准度及格线（计时模式累计、语音纠错）
  const SESSION_PASS = 70;  // 整组平均标准度达标线
  let voiceOn = (() => { try { return localStorage.getItem(VOICE_KEY) !== '0'; } catch (e) { return true; } })();
  const POSE = {
    stage: 'pick',   // pick 选动作 | live 跟练
    idx: -1,         // 当前任务在 state.plan.workout 的下标
    mode: 'reps',    // reps 计次 | hold 计时
    target: 0,       // 目标次数 / 目标秒数
    done: 0,         // 已完成次数 / 已完成达标秒数
    scoreSum: 0, scoreN: 0,
    extraCount: 0,   // 因标准度不足而追加次数的轮数（上限 2）
    finished: false,
  };
  let prevTs = 0;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 计次用的候选关节角：左右腿(髋-膝-踝)、左右臂(肩-肘-腕)、左右体侧(肩-髋-膝)
  const REP_JOINTS = [
    { a: 23, b: 25, c: 27 },
    { a: 24, b: 26, c: 28 },
    { a: 11, b: 13, c: 15 },
    { a: 12, b: 14, c: 16 },
    { a: 11, b: 23, c: 25 },
    { a: 12, b: 24, c: 26 },
  ];
  const WIN_MS = 1200;
  const sig = REP_JOINTS.map(() => ({ sm: null, win: [] }));
  let repState = null, downAt = 0, lastRepAt = 0;

  // MediaPipe 骨架连接（Index 对的参考线）
  const CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
    [11,12],[11,13],[13,15],[12,14],[14,16],
    [11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],
    [24,26],[26,28],[28,30],[30,32],
  ];

  function angle(a, b, c) {
    const v1 = { x: a.x - b.x, y: a.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const d = Math.sqrt((v1.x*v1.x+v1.y*v1.y)*(v2.x*v2.x+v2.y*v2.y));
    if (!d) return 180;
    let ang = Math.acos(Math.max(-1, Math.min(1, (v1.x*v2.x+v1.y*v2.y)/d))) * 180 / Math.PI;
    return ang;
  }

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'pr-tag' + (cls ? ' ' + cls : '');
  }
  function setScore(v) {
    const n = Math.max(0, Math.min(100, Math.round(v)));
    scoreEl.textContent = n;
    ring.style.strokeDashoffset = String(CIR * (1 - n / 100));
    ring.style.stroke = n >= 80 ? 'var(--green)' : (n >= 55 ? 'var(--accent)' : 'var(--red)');
  }

  // 通用指标：垂直度 + 平衡 → 综合标准度
  function analyze(landmarks) {
    const mid = (...ids) => {
      const p = ids.map((i) => landmarks[i]);
      return {
        x: p.reduce((s, q) => s + q.x, 0) / p.length,
        y: p.reduce((s, q) => s + q.y, 0) / p.length,
      };
    };
    const vis = (i) => (landmarks[i] && landmarks[i].visibility > 0.4);

    const need = [11,12,23,24,25,26,27,28].every(vis); // 肩、髋、膝、踝
    if (!need) return null;

    const sh = mid(11,12), hip = mid(23,24), ank = mid(27,28);
    const hipL = landmarks[23], hipR = landmarks[24];
    const shL = landmarks[11], shR = landmarks[12];

    // 用画面高度归一化横向偏移（侧身看：肩/髋/踝应尽量在一条竖线）
    const extent = Math.max(0.15, Math.abs(sh.y - ank.y));
    // 脊柱角（肩-髋-踝 三点角，接近 180 为最直）
    const spine = angle(sh, hip, ank);
    const upright = Math.max(0, Math.min(100, (180 - Math.abs(180 - spine)) / 60 * 100));

    // 平衡：左右髋/肩高度差是否对称
    const hipDiff = Math.abs(hipL.y - hipR.y);
    const shDiff = Math.abs(shL.y - shR.y);
    const asym = Math.max(0, Math.min(1, (hipDiff + shDiff) / (extent * 0.18)));
    const balance = (1 - asym) * 100;

    return { upright: Math.round(upright), balance: Math.round(balance) };
  }

  // 视频用 object-fit: cover 填满显示框，骨架必须按同一套裁剪/缩放映射才不会错位
  function mapPoint(p, W, H) {
    const vw = video.videoWidth || 0, vh = video.videoHeight || 0;
    if (!vw || !vh) return { x: p.x * W, y: p.y * H };
    const boxAR = W / H, vidAR = vw / vh;
    if (vidAR > boxAR) {           // 视频比框更宽：左右两侧被裁掉
      const k = boxAR / vidAR;
      return { x: ((p.x - 0.5) * k + 0.5) * W, y: p.y * H };
    }
    const k = vidAR / boxAR;       // 视频比框更高：上下两侧被裁掉
    return { x: p.x * W, y: ((p.y - 0.5) * k + 0.5) * H };
  }

  function draw(landmarks) {
    const W = canvas.width, H = canvas.height;
    ctx2d.clearRect(0, 0, W, H);
    if (!landmarks) return;

    // 连线
    ctx2d.strokeStyle = 'rgba(255, 90, 31, 0.95)';
    ctx2d.lineWidth = Math.max(3, W / 150);
    ctx2d.lineJoin = 'round';
    ctx2d.beginPath();
    CONNECTIONS.forEach(([a, b]) => {
      if ((landmarks[a].visibility || 0) > 0.3 && (landmarks[b].visibility || 0) > 0.3) {
        const p1 = mapPoint(landmarks[a], W, H), p2 = mapPoint(landmarks[b], W, H);
        ctx2d.moveTo(p1.x, p1.y);
        ctx2d.lineTo(p2.x, p2.y);
      }
    });
    ctx2d.stroke();

    // 关节点
    landmarks.forEach((p, i) => {
      if ((p.visibility || 0) < 0.4) return;
      const q = mapPoint(p, W, H);
      ctx2d.beginPath();
      ctx2d.arc(q.x, q.y, Math.max(4, W / 190), 0, Math.PI * 2);
      ctx2d.fillStyle = i <= 10 ? '#fff' : '#ff5a1f';
      ctx2d.fill();
      ctx2d.strokeStyle = 'rgba(255,255,255,.85)';
      ctx2d.lineWidth = 1.5;
      ctx2d.stroke();
    });
  }

  function loop(ts) {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (!landmarker || video.readyState < 2) return;

    try {
      const res = landmarker.detectForVideo(video, ts);
      const lm = res.landmarks && res.landmarks[0];
      if (ts && lastTs) fps = Math.round(fps * 0.7 + (1000 / Math.max(1, ts - lastTs)) * 0.3);
      lastTs = ts;
      $('m-fps').textContent = fps + ' 帧';

      if (!lm) {
        draw(null);
        setScore(0);
        setStatus('未检测到人体', 'warn');
        $('m-upright').textContent = '--';
        $('m-balance').textContent = '--';
        hintEl.textContent = '全身进入画面，保持侧身、光线充足。';
        resetRepSignal();
        maybeSpeak(null, 0);
        prevTs = ts;
        return;
      }
      draw(lm);

      // 计次只依赖可见的候选关节，不因完整人体评分不可用而中断
      if (POSE.mode === 'reps') {
        const n = countRep(lm, ts);
        if (n) {
          POSE.done += n; updateProgress(); speakRep();
        }
      }

      const m = analyze(lm);
      if (!m) {
        setScore(0);
        setStatus('识别中…', 'warn');
        $('m-upright').textContent = '--';
        $('m-balance').textContent = '--';
        hintEl.textContent = '转身面对侧方，让肩、髋、踝都在画面里。';
        maybeSpeak({ upright: 100, balance: 100, incomplete: true }, 0);
        checkTarget();
        prevTs = ts;
        return;
      }
      $('m-upright').textContent = m.upright;
      $('m-balance').textContent = m.balance;
      const overall = Math.round(m.upright * 0.6 + m.balance * 0.4);
      setScore(overall);
      setStatus(overall >= 80 ? '姿势标准' : (overall >= 55 ? '需要调整' : '塌陷明显'), overall >= 80 ? 'ok' : 'warn');
      if (overall >= 80) hintEl.textContent = '很棒！身体直立、左右对称，继续保持。';
      else if (m.balance < 70) hintEl.textContent = '重心偏斜，双脚站稳，左右髋尽量同一水平。';
      else if (m.upright < 70) hintEl.textContent = '躯干前倾过大，收紧核心、挺直背部。';
      else hintEl.textContent = '基本标准，细节再稳一点会更棒。';

      // 累计标准度，供整组平均分判定
      POSE.scoreSum += overall;
      POSE.scoreN += 1;

      // 计时只在标准度达标时累计
      if (POSE.mode === 'hold') {
        const dt = prevTs ? Math.min(300, Math.max(0, ts - prevTs)) : 0;
        if (overall >= FORM_PASS) POSE.done += dt / 1000;
        updateProgress();
      }
      prevTs = ts;

      maybeSpeak(m, overall);
      checkTarget();
    } catch (e) {
      setStatus('检测异常', 'warn');
    }
  }

  function stopCamera() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    video.srcObject = null;
    placeholder.classList.remove('hide');
    toggle.classList.remove('on', 'ghost');
    toggle.querySelector('use').setAttribute('href', '#i-camera');
    toggle.querySelector('span').textContent = '开启摄像头';
    setStatus('等待开启', '');
    $('pose-score').textContent = '--';
    $('m-upright').textContent = '--';
    $('m-balance').textContent = '--';
    $('m-fps').textContent = '--';
  }

  let MP = null; // 自托管 MediaPipe 库（ESM）
  async function getMP() {
    if (!MP) MP = await import('/mediapipe/vision.mjs');
    return MP;
  }

  async function ensureLandmarker() {
    if (landmarker) return true;
    if (!window.crossOriginIsolated) { /* 无妨，跳过提示 */ }
    try {
      const lib = await getMP();
      const vision = await lib.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      landmarker = await lib.PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/mediapipe/pose_landmarker_lite.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      return true;
    } catch (e) {
      setStatus('模型加载失败', 'warn');
      hintEl.textContent = '加载失败：' + e.message + '，请稍后重试。';
      return false;
    }
  }

  async function getCameraStream() {
    // 多级降级取流：桌面 webcam 常不支持 facingMode(手机前置约束) 会抛 OverconstrainedError，
    // 因此先试无 facingMode 的通用参数，失败再逐级退到最宽松的 video:true / 后置 / 前置。
    const attempts = [
      () => navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 } } }),
      () => navigator.mediaDevices.getUserMedia({ audio: false, video: true }),
      () => navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } }),
      () => navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user' } }),
    ];
    let lastErr = null;
    for (const f of attempts) {
      try { return await f(); } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  function syncCanvasSize() {
    // canvas 后备尺寸跟显示尺寸（含 DPR）对齐，绘制才不糊
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round((rect.width || 320) * dpr));
    canvas.height = Math.max(1, Math.round((rect.height || 426) * dpr));
  }

  async function startCamera() {
    loading.style.display = 'inline-flex';
    toggle.style.display = 'none';
    const ready = await ensureLandmarker();
    loading.style.display = 'none';
    toggle.style.display = 'inline-flex';
    if (!ready) return false;

    try {
      stream = await getCameraStream();
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      console.error('摄像头完整错误:', e);
      setStatus('摄像头启动失败', 'warn');
      const msg = (e && e.name) ? e.name : String(e);
      if (msg === 'NotAllowedError' || msg === 'PermissionDeniedError') {
        hintEl.textContent = '摄像头权限被拒绝，请在地址栏/系统设置里允许（需 HTTPS 或 localhost）。';
      } else if (msg === 'NotFoundError' || msg === 'OverconstrainedError') {
        hintEl.textContent = '没有检测到可用摄像头，或用的是锁定的远程/虚拟机环境。请插上摄像头后再试。';
      } else if (msg === 'NotReadableError') {
        hintEl.textContent = '摄像头被其他程序占用，请关闭再用（报错 NotReadableError）。';
      } else {
        hintEl.textContent = '摄像头启动失败：' + msg + '。';
      }
      speak('摄像头打不开，检查一下权限', true);
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      return false;
    }
    placeholder.classList.add('hide');
    running = true;
    toggle.classList.add('on');
    toggle.querySelector('use').setAttribute('href', '#i-shield');
    toggle.querySelector('span').textContent = '关闭摄像头';
    syncCanvasSize();
    setStatus('检测中', 'ok');
    rafId = requestAnimationFrame(loop);
    return true;
  }

  toggle.addEventListener('click', async () => {
    if (running) { stopCamera(); return; }
    warmVoice();
    await startCamera();
  });

  // 离开页面时自动关闭摄像头
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

  // ---------- 语音（本地预置话术 + 浏览器语音合成） ----------
  let zhVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = window.speechSynthesis.getVoices() || [];
    zhVoice = vs.find((v) => /^zh[-_]?CN/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null;
  }
  let lastSpeakAt = 0;
  const spokenAt = {};
  function speak(text, force) {
    if (!voiceOn || !text || !('speechSynthesis' in window)) return;
    const now = Date.now();
    if (!force && now - lastSpeakAt < 4000) return;
    if (!force && spokenAt[text] && now - spokenAt[text] < 8000) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN'; u.rate = 1; u.pitch = 1;
      if (zhVoice) u.voice = zhVoice;
      window.speechSynthesis.speak(u);
      lastSpeakAt = now; spokenAt[text] = now;
    } catch (e) {}
  }
  function warmVoice() {
    if (!('speechSynthesis' in window)) return;
    try {
      pickVoice();
      const u = new SpeechSynthesisUtterance(' ');
      u.lang = 'zh-CN'; u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    if (window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener('voiceschanged', pickVoice);
  }
  function speakRep() {
    if (POSE.mode !== 'reps' || POSE.done >= POSE.target) return;
    if (POSE.done % 3 === 0) speak(POSE.done + ' 次，保持这个节奏');
  }
  function maybeSpeak(m, overall) {
    if (!m) { speak('看不到你了，站到画面中间来'); return; }
    if (m.incomplete) { speak('转身面对侧方，让全身都在画面里'); return; }
    if (m.upright < 70) { speak('背部挺直，别往前倾'); return; }
    if (m.balance < 70) { speak('重心偏了，左右站稳一点'); return; }
    if (overall >= 85) { speak('很好，就是这个感觉'); return; }
    if (overall >= 70) speak('不错，再稳一点会更好');
  }
  function syncVoiceBtn() {
    const b = $('pose-voice-toggle');
    if (!b) return;
    b.classList.toggle('off', !voiceOn);
    const use = b.querySelector('use');
    if (use) use.setAttribute('href', voiceOn ? '#i-volume' : '#i-volume-x');
    const sp = b.querySelector('span');
    if (sp) sp.textContent = voiceOn ? '语音开' : '语音关';
  }

  // ---------- 计次（通用动作节奏检测） ----------
  function resetRepSignal() {
    sig.forEach((s) => { s.sm = null; s.win.length = 0; });
    repState = null; downAt = 0; lastRepAt = 0;
  }
  function countRep(lm, ts) {
    let bestI = -1, bestAmp = 0;
    sig.forEach((s, i) => {
      const j = REP_JOINTS[i];
      const pts = [lm[j.a], lm[j.b], lm[j.c]];
      if (!pts.every((q) => q && (q.visibility || 0) > 0.4)) { s.win.length = 0; return; }
      const a = angle(pts[0], pts[1], pts[2]);
      s.sm = s.sm == null ? a : s.sm * 0.65 + a * 0.35;
      s.win.push({ t: ts, v: s.sm });
      while (s.win.length && ts - s.win[0].t > WIN_MS) s.win.shift();
      if (s.win.length < 6) return;
      const vs = s.win.map((w) => w.v);
      const amp = Math.max(...vs) - Math.min(...vs);
      if (amp > bestAmp) { bestAmp = amp; bestI = i; }
    });
    if (bestI < 0 || bestAmp < 32) {
      repState = null; return 0;
    }
    const w = sig[bestI].win.map((x) => x.v);
    const lo = Math.min(...w), hi = Math.max(...w);
    const low = lo + bestAmp * 0.35, high = lo + bestAmp * 0.65;
    const v = sig[bestI].sm;
    if (repState == null) { repState = v >= (lo + hi) / 2 ? 'up' : 'down'; return 0; }
    if (repState === 'up' && v <= low) { repState = 'down'; downAt = ts; return 0; }
    if (repState === 'down' && v >= high) {
      repState = 'up';
      const dur = (ts - downAt) / 1000;
      if (dur >= 0.5 && ts - lastRepAt >= 600) { lastRepAt = ts; return 1; }
    }
    return 0;
  }

  // ---------- 进度 / 目标 ----------
  function updateProgress() {
    const shown = POSE.mode === 'hold' ? Math.floor(POSE.done) : POSE.done;
    $('pose-reps').textContent = String(shown);
    $('pose-target').textContent = String(POSE.target);
    const pct = POSE.target ? Math.min(100, Math.round((POSE.done / POSE.target) * 100)) : 0;
    $('pose-bar').style.width = pct + '%';
  }
  function avgScore() { return POSE.scoreN ? Math.round(POSE.scoreSum / POSE.scoreN) : 0; }
  function checkTarget() {
    if (POSE.stage !== 'live' || POSE.finished) return;
    if (POSE.done < POSE.target) return;
    if (POSE.mode === 'reps' && POSE.scoreN >= 20 && avgScore() < SESSION_PASS && POSE.extraCount < 2) {
      POSE.extraCount += 1;
      POSE.target += 3;
      updateProgress();
      speak('次数够了，动作再标准一点，再加 3 次', true);
      return;
    }
    completeTask();
  }

  // ---------- 任务列表 ----------
  function parseTarget(reps) {
    const s = String(reps == null ? '' : reps).trim();
    const m = s.match(/(\d+(?:\.\d+)?)/);
    const num = m ? parseFloat(m[1]) : NaN;
    const n = Number.isFinite(num) && num > 0 ? Math.round(num) : 10;
    if (/秒|分钟/.test(s)) {
      const secs = /分/.test(s) && !/秒/.test(s) ? n * 60 : n;
      return { mode: 'hold', n: secs };
    }
    return { mode: 'reps', n };
  }
  function taskList() {
    return state.plan.workout
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r && String(r.name || '').trim());
  }
  function renderPoseTasks() {
    const box = $('pose-task-list');
    if (!box) return;
    const all = taskList();
    const rest = all.filter(({ r }) => !r.done).length;
    const cnt = $('pose-pick-count');
    if (cnt) cnt.textContent = all.length ? '共 ' + all.length + ' 个 · 已完成 ' + (all.length - rest) + ' 个' : '';
    const empty = $('pose-pick-empty');
    if (empty) empty.classList.toggle('hide', all.length > 0);
    box.innerHTML = '';
    all.slice().sort((a, b) => (a.r.done ? 1 : 0) - (b.r.done ? 1 : 0)).forEach(({ r, i }) => {
      const t = parseTarget(r.reps);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pose-task' + (r.done ? ' pt-done' : '');
      el.innerHTML =
        '<span class="pt-main"><span class="pt-name">' + esc(r.name) + '</span>' +
        '<span class="pt-meta">' + (r.sets ? r.sets + ' 组 × ' : '') +
        (t.mode === 'hold' ? t.n + ' 秒' : t.n + ' 次') + '</span></span>' +
        '<span class="pt-act">' + (r.done ? '已完成' : '开始') + '</span>';
      el.addEventListener('click', () => startTask(i));
      box.appendChild(el);
    });
  }

  // ---------- 阶段切换 / 会话 ----------
  function setStage(s) {
    POSE.stage = s;
    if (pickCard) pickCard.classList.toggle('hide', s !== 'pick');
    if (liveCard) liveCard.classList.toggle('hide', s !== 'live');
    if (resultCard) resultCard.classList.toggle('hide', s !== 'live');
  }
  async function startTask(idx) {
    const row = state.plan.workout[idx];
    if (!row) return;
    const t = parseTarget(row.reps);
    POSE.idx = idx; POSE.mode = t.mode; POSE.target = t.n;
    POSE.done = 0; POSE.scoreSum = 0; POSE.scoreN = 0; POSE.extraCount = 0; POSE.finished = false;
    resetRepSignal();
    updateProgress();
    $('pose-live-name').textContent = String(row.name || '');
    $('pose-live-goal').textContent = (row.sets ? row.sets + ' 组 × ' : '') + (t.mode === 'hold' ? t.n + ' 秒' : t.n + ' 次');
    $('pose-unit').textContent = t.mode === 'hold' ? '秒' : '次';
    setStage('live');
    warmVoice();
    speak('开始 ' + row.name + '，我帮你看着动作', true);
    if (!running) await startCamera();
  }
  function completeTask() {
    POSE.finished = true;
    const row = state.plan.workout[POSE.idx];
    if (row) { row.done = true; savePlan(); renderPlan(); renderCompletion(); }
    const avg = avgScore();
    const rest = taskList().filter(({ r }) => !r.done);
    if (!rest.length) {
      $('pose-done-sub').textContent = '平均标准度 ' + avg + ' 分。每一组都认真练完了，恢复和饮食也别落下。';
      $('pose-done-mask').classList.remove('hide');
      speak('今天的训练全部完成，做得不错', true);
      return;
    }
    $('pose-next-sub').textContent = (row && row.name ? row.name + '：' : '') + '平均标准度 ' + avg + ' 分，达标！还剩 ' + rest.length + ' 个动作，继续吗？';
    $('pose-next-mask').classList.remove('hide');
    speak('这一组完成，做得不错', true);
  }
  function endSession() {
    stopCamera();
    POSE.idx = -1;
    setStage('pick');
    renderPoseTasks();
  }

  // ---------- 交互绑定 ----------
  $('pose-plus-one').addEventListener('click', () => {
    if (POSE.stage !== 'live' || POSE.finished) return;
    POSE.done += 1;
    updateProgress();
    checkTarget();
  });
  $('pose-exit').addEventListener('click', () => { endSession(); speak('先到这里，随时可以再练', true); });
  $('pose-next-go').addEventListener('click', () => {
    $('pose-next-mask').classList.add('hide');
    const rest = taskList().filter(({ r }) => !r.done);
    if (!rest.length) { endSession(); return; }
    startTask(rest[0].i);
  });
  $('pose-next-stop').addEventListener('click', () => { $('pose-next-mask').classList.add('hide'); endSession(); });
  $('pose-done-ok').addEventListener('click', () => { $('pose-done-mask').classList.add('hide'); endSession(); });
  $('pose-voice-toggle').addEventListener('click', () => {
    voiceOn = !voiceOn;
    try { localStorage.setItem(VOICE_KEY, voiceOn ? '1' : '0'); } catch (e) {}
    if (!voiceOn && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    syncVoiceBtn();
    if (voiceOn) { warmVoice(); speak('语音已开启', true); }
  });
  syncVoiceBtn();

  // 供切换底部标签时调用
  window.__poseEnter = () => { if (POSE.stage === 'pick') renderPoseTasks(); };
  window.__poseStop = () => { if (running) stopCamera(); };
  // 系统返回键/边缘滑返回：先关掉完成弹窗，并结束本次跟练回到选动作列表
  window.__poseModalBack = () => {
    const nm = $('pose-next-mask'), dm = $('pose-done-mask');
    if (nm && !nm.classList.contains('hide')) { nm.classList.add('hide'); endSession(); return true; }
    if (dm && !dm.classList.contains('hide')) { dm.classList.add('hide'); endSession(); return true; }
    return false;
  };
  renderPoseTasks();
})();
