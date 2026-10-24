'use strict';

// ===================== 定数 =====================
const MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-3.5-flash-lite'];

const EQUIPMENT = [
  ['free', 'フリーウェイト（ダンベル・バーベル・ベンチ）'],
  ['machine', 'マシン'],
  ['cable', 'ケーブルマシン'],
  ['smith', 'スミスマシン・パワーラック'],
];

const MEAL_TYPES = [['breakfast', '朝食'], ['lunch', '昼食'], ['dinner', '夕食'], ['snack', '間食']];

const BODY_FIELDS = [
  ['weight', '体重', 'kg'],
  ['fatPct', '体脂肪率', '%'],
  ['skeletalMuscle', '骨格筋量', 'kg'],
  ['muscle', '筋肉量', 'kg'],
  ['fatMass', '体脂肪量', 'kg'],
  ['bmr', '基礎代謝', 'kcal'],
  ['visceral', '内臓脂肪レベル', ''],
  ['water', '体水分量', 'kg'],
  ['score', 'InBody点数', '点'],
];

const SOURCES = { inbody: 'InBody', tanita: 'タニタ', manual: '手入力' };

const MODES = [
  ['cut', '引き締め（脂肪を落とす）'],
  ['maintain', '維持しながら筋肉をつける'],
  ['bulk', '増量（筋肉を大きくする）'],
];

const ACTIVITY = [
  [1.2, 'ほとんど座っている（デスクワーク中心）'],
  [1.375, '軽く動く＋週2〜3回トレーニング'],
  [1.55, 'よく動く＋週3〜5回トレーニング'],
  [1.725, '立ち仕事・肉体労働＋トレーニング'],
];

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: MODELS[0],
  profile: { sex: '', birthYear: '', height: '', activity: 1.375 },
  goals: ['12月までに腹筋を割る', '丸みのある胸板をつくる'],
  targetDate: '2026-12-31',
  mode: 'cut',
  daysPerWeek: 3,
  equipment: ['free', 'machine', 'cable', 'smith'],
  override: { kcal: '', protein: '' },
};

// ===================== 保存（iPhoneの中のデータベース） =====================
const S = { settings: null, body: [], meals: [], favorites: [], plan: null, workouts: [], analyses: [] };
let dbPromise;

function db() {
  return dbPromise ||= new Promise((ok, ng) => {
    const r = indexedDB.open('bodymake', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ng(r.error);
  });
}
async function idbGet(k) {
  const d = await db();
  return new Promise((ok, ng) => {
    const r = d.transaction('kv').objectStore('kv').get(k);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ng(r.error);
  });
}
async function idbSet(k, v) {
  const d = await db();
  return new Promise((ok, ng) => {
    const t = d.transaction('kv', 'readwrite');
    t.objectStore('kv').put(v, k);
    t.oncomplete = () => ok();
    t.onerror = () => ng(t.error);
  });
}
async function save(...keys) {
  for (const k of keys) await idbSet(k, S[k]);
}
function mergeSettings(saved = {}) {
  const d = structuredClone(DEFAULT_SETTINGS);
  return { ...d, ...saved, profile: { ...d.profile, ...saved.profile }, override: { ...d.override, ...saved.override } };
}
async function loadAll() {
  for (const k of Object.keys(S)) {
    const v = await idbGet(k);
    if (v !== undefined) S[k] = v;
  }
  S.settings = mergeSettings(S.settings || {});
}

// ===================== 小さな道具 =====================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const num = v => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const firstNum = v => { const m = String(v ?? '').match(/\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const r0 = n => (n == null ? '–' : Math.round(n));
const r1 = n => (n == null ? '–' : Math.round(n * 10) / 10);
const sum = (arr, k) => arr.reduce((a, x) => a + (num(x[k]) || 0), 0);

function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function jpDate(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`;
}
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function daysUntil(s) { return Math.round((parseYmd(s) - parseYmd(ymd())) / 86400000); }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}
function openSheet(title, html) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  $('.sheet-panel').scrollTop = 0;
  document.body.classList.add('noscroll');
}
function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-body').innerHTML = '';
  document.body.classList.remove('noscroll');
  draft = null;
}
function busy(on, msg = 'AIが分析中…') {
  $('#busy').hidden = !on;
  $('#busy-msg').textContent = msg;
}

// ===================== 写真 =====================
function pickPhotos(multiple = false, accept = 'image/*') {
  return new Promise(ok => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multiple;
    i.style.display = 'none';
    i.onchange = () => { ok([...i.files]); i.remove(); };
    document.body.appendChild(i);
    i.click();
  });
}
function loadImage(src) {
  return new Promise((ok, ng) => { const img = new Image(); img.onload = () => ok(img); img.onerror = ng; img.src = src; });
}
async function resizeImage(src, max, quality = 0.8) {
  const img = await loadImage(src);
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
async function fileToJpeg(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try { return await resizeImage(url, max); } finally { URL.revokeObjectURL(url); }
}
const b64 = dataUrl => dataUrl.split(',')[1];

// 画面収録の動画から、一定間隔でコマを切り出す
async function videoFrames(file, maxFrames = 16, max = 1600) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await new Promise((ok, ng) => {
      v.onloadeddata = ok;
      v.onerror = () => ng(new Error('動画を読み込めませんでした'));
      v.load();
    });
    const dur = v.duration;
    const n = Math.min(maxFrames, Math.max(2, Math.ceil(dur / 1.2)));
    const s = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * s);
    c.height = Math.round(v.videoHeight * s);
    const frames = [];
    for (let i = 0; i < n; i++) {
      await new Promise(ok => { v.onseeked = ok; v.currentTime = (dur * (i + 0.5)) / n; });
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      frames.push(c.toDataURL('image/jpeg', 0.8));
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}
// 写真・スクショ・画面収録をまとめてAIに送れる画像に変える
async function filesToImages(files, max = 1600, maxFrames = 16, cap = 20) {
  const out = [];
  for (const f of files) {
    if (f.type.startsWith('video/')) out.push(...await videoFrames(f, maxFrames, max));
    else out.push(await fileToJpeg(f, max));
  }
  return out.slice(0, cap);
}

// ===================== AI（Google Gemini） =====================
function parseJSON(text) {
  const t = text.replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('AIの返事を読み取れませんでした');
  return JSON.parse(t.slice(a, b + 1));
}

async function gemini(prompt, images = []) {
  const key = S.settings.apiKey.trim();
  if (!key) throw new Error('NO_KEY');
  const models = [S.settings.model, ...MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
  const body = JSON.stringify({
    contents: [{
      parts: [
        { text: prompt },
        ...images.map(d => ({ inline_data: { mime_type: 'image/jpeg', data: b64(d) } })),
      ],
    }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
  });
  let lastErr;
  for (const m of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body,
    });
    if (res.ok) {
      const j = await res.json();
      const text = (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
      return parseJSON(text);
    }
    lastErr = new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
    // モデルが無い・混雑・回数上限のときは次のモデルで再挑戦
    if (![404, 429, 500, 503].includes(res.status)) break;
  }
  throw lastErr;
}

function aiErrorMessage(e) {
  const m = String(e?.message || e);
  if (m === 'NO_KEY') return '設定画面で Gemini の「APIキー」を入れてください。';
  if (/^(400|401|403)/.test(m)) return 'APIキーが正しくないか、使えない状態のようです。設定画面で確認してください。';
  if (m.startsWith('429')) return '無料で使える回数の上限に達したようです。しばらく（翌日など）時間をおいてください。';
  if (/Failed to fetch|NetworkError|Load failed/.test(m)) return '通信できませんでした。電波を確認してください。';
  return 'AIの処理に失敗しました。\n' + m.slice(0, 150);
}

async function runAI(msg, fn) {
  busy(true, msg);
  try { return await fn(); }
  catch (e) { console.error(e); alert(aiErrorMessage(e)); return null; }
  finally { busy(false); }
}

// ===================== 体のデータ・目標の計算 =====================
const sortedBody = () => [...S.body].sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));
const latestBody = () => sortedBody().at(-1) || null;
const latestWith = field => sortedBody().reverse().find(b => num(b[field]) != null) || null;

function age() {
  const y = num(S.settings.profile.birthYear);
  return y ? new Date().getFullYear() - y : null;
}

function targets() {
  const st = S.settings, p = st.profile;
  const w = num(latestWith('weight')?.weight);
  const fat = num(latestWith('fatPct')?.fatPct);
  let bmr = num(latestWith('bmr')?.bmr), how = '体組成計の基礎代謝';
  if (!bmr && w && fat) { bmr = 370 + 21.6 * w * (1 - fat / 100); how = '体重と体脂肪率から計算'; }
  if (!bmr && w && num(p.height) && age() && p.sex) {
    bmr = 10 * w + 6.25 * num(p.height) - 5 * age() + (p.sex === 'male' ? 5 : -161);
    how = '体重・身長・年齢から計算';
  }
  if (!bmr || !w) return null;
  const tdee = bmr * (num(p.activity) || 1.375);
  let kcal = st.mode === 'cut' ? Math.max(tdee - 400, bmr) : st.mode === 'bulk' ? tdee + 250 : tdee;
  let protein = w * 2.0;
  if (num(st.override.kcal)) kcal = num(st.override.kcal);
  if (num(st.override.protein)) protein = num(st.override.protein);
  const fatG = (kcal * 0.25) / 9;
  const carbs = Math.max(0, (kcal - protein * 4 - fatG * 9) / 4);
  return { bmr, tdee, kcal, protein, fat: fatG, carbs, how };
}

// 腹筋が見えてくる体脂肪率の目安までの距離
function absGuide() {
  const sex = S.settings.profile.sex;
  const b = latestWith('fatPct');
  if (!sex || !b || !num(b.weight)) return null;
  const goalPct = sex === 'male' ? 11 : 18;
  const w = num(b.weight), pct = num(b.fatPct);
  const lean = w * (1 - pct / 100);
  const goalW = lean / (1 - goalPct / 100);
  const toLose = Math.max(0, w - goalW);
  const weeks = Math.max(1, daysUntil(S.settings.targetDate) / 7);
  const perWeek = toLose / weeks;
  return { goalPct, pct, toLose, perWeek, weeks, safe: perWeek <= w * 0.007, source: b.source };
}

function profileText() {
  const p = S.settings.profile, b = latestBody();
  const lines = [];
  lines.push(`性別: ${p.sex === 'male' ? '男性' : p.sex === 'female' ? '女性' : '未設定'} / 年齢: ${age() ?? '未設定'} / 身長: ${p.height || '未設定'}cm`);
  if (b) {
    const vals = BODY_FIELDS.filter(([k]) => num(b[k]) != null).map(([k, l, u]) => `${l} ${b[k]}${u}`).join('、');
    lines.push(`最新の測定（${b.date}・${SOURCES[b.source] || ''}）: ${vals}`);
    const seg = b.extra && Object.keys(b.extra).length ? JSON.stringify(b.extra) : '';
    if (seg) lines.push(`その他の測定値: ${seg}`);
  }
  const ib = sortedBody().reverse().find(x => x.source === 'inbody');
  if (ib && ib !== b) {
    const vals = BODY_FIELDS.filter(([k]) => num(ib[k]) != null).map(([k, l, u]) => `${l} ${ib[k]}${u}`).join('、');
    lines.push(`直近のInBody（${ib.date}）: ${vals}${ib.extra && Object.keys(ib.extra).length ? ' / ' + JSON.stringify(ib.extra) : ''}`);
  }
  const first = sortedBody()[0];
  if (first && b && first !== b) lines.push(`最初の記録（${first.date}）: 体重 ${first.weight ?? '-'}kg、体脂肪率 ${first.fatPct ?? '-'}%`);
  return lines.join('\n');
}
function goalsText() {
  const st = S.settings;
  return `${st.goals.map(g => '- ' + g).join('\n')}\n期限: ${st.targetDate}（あと${daysUntil(st.targetDate)}日）\n今の方針: ${MODES.find(m => m[0] === st.mode)?.[1]}`;
}
const equipmentText = () => S.settings.equipment.map(k => EQUIPMENT.find(e => e[0] === k)?.[1]).filter(Boolean).join('、') || '自重のみ';

// ===================== 食事 =====================
const mealsOn = date => S.meals.filter(m => m.date === date).sort((a, b) => (a.created || 0) - (b.created || 0));
function dayTotals(date) {
  const ms = mealsOn(date);
  return { kcal: sum(ms, 'kcal'), protein: sum(ms, 'protein'), fat: sum(ms, 'fat'), carbs: sum(ms, 'carbs') };
}
function defaultMealType() {
  const hr = new Date().getHours();
  return hr < 10 ? 'breakfast' : hr < 15 ? 'lunch' : hr < 18 ? 'snack' : 'dinner';
}
function recalcMeal(m) {
  for (const k of ['kcal', 'protein', 'fat', 'carbs']) m[k] = Math.round(sum(m.items, k) * 10) / 10;
  return m;
}

const MEAL_JSON = '{"name":"食事全体の短い名前","items":[{"name":"料理・食品名","amount":"推定量（例: 茶碗1杯 150g）","kcal":数値,"protein":数値,"fat":数値,"carbs":数値}],"note":"推定の根拠や注意点を1〜2文"}';

function mealPhotoPrompt(hint) {
  return `あなたは日本の管理栄養士です。写真に写っている料理・食品をすべて特定し、見た目から量を推定して、カロリー(kcal)・たんぱく質(g)・脂質(g)・炭水化物(g)を見積もってください。
日本食品標準成分表や、よくある市販品・コンビニ・外食チェーンの値を参考にしてください。パッケージの栄養成分表示が写っていれば、その値を優先してください。
数値は「その人が1食で食べる分」です。
補足情報: ${hint || 'なし'}
次の形のJSONだけを返してください（数値は数字のみ）:
${MEAL_JSON}`;
}
function mealTextPrompt(text) {
  return `あなたは日本の管理栄養士です。次の食事内容から、料理・食品ごとにカロリー(kcal)・たんぱく質(g)・脂質(g)・炭水化物(g)を見積もってください。量の指定が無いものは日本の一般的な1人前とします。市販品・チェーン店の商品名があれば、その公表値に近い値にしてください。
食事内容: ${text}
次の形のJSONだけを返してください（数値は数字のみ）:
${MEAL_JSON}`;
}
function normalizeMeal(r) {
  const items = (r.items || []).map(i => ({
    name: String(i.name || '不明'),
    amount: String(i.amount || ''),
    kcal: num(i.kcal) || 0, protein: num(i.protein) || 0, fat: num(i.fat) || 0, carbs: num(i.carbs) || 0,
  }));
  return { name: r.name || items.map(i => i.name).join('・'), items, note: r.note || '' };
}

// ===================== トレーニング =====================
const ex = (name, sets, reps, rest, note = '') => ({ name, sets, reps, rest, weight: '', note });

function defaultPlan(n) {
  const A = { name: 'A 胸・肩・腹', focus: '胸の上部と全体を厚くする日（胸の丸み）', exercises: [
    ex('インクラインベンチプレス（スミスマシン）', 3, '8-10', '2分', 'ベンチは30度くらい。胸の上部は丸みの土台'),
    ex('チェストプレス（マシン）', 3, '10-12', '90秒', '胸を張ったまま押す'),
    ex('ケーブルクロスオーバー（下から上へ）', 3, '12-15', '60秒', '胸の上の方で手を寄せる'),
    ex('サイドレイズ（ダンベル）', 3, '12-15', '60秒', '肩幅が出ると胸板が厚く見える'),
    ex('ケーブルクランチ', 3, '12-15', '60秒', 'おへそをのぞき込むように丸める'),
    ex('レッグレイズ', 3, '10-15', '60秒', '腰が反らないように'),
  ] };
  const B = { name: 'B 脚・腹', focus: '大きい筋肉を使って脂肪を燃やしやすくする日', exercises: [
    ex('スクワット（スミスマシン or パワーラック）', 3, '8-10', '2分', '膝とつま先の向きをそろえる'),
    ex('レッグプレス', 3, '10-12', '90秒'),
    ex('ルーマニアンデッドリフト（ダンベル）', 3, '10-12', '90秒', '背中を丸めず、お尻を後ろへ引く'),
    ex('レッグカール（マシン）', 3, '12-15', '60秒'),
    ex('アブローラー（膝つき）', 3, '8-12', '60秒', '腰を反らせない範囲で転がす'),
    ex('プランク', 3, '45秒', '45秒', '頭からかかとまで一直線'),
  ] };
  const C = { name: 'C 背中・胸・腹', focus: '背中で体の厚みを出し、胸をもう一度刺激する日', exercises: [
    ex('ラットプルダウン', 3, '10-12', '90秒', '胸に向かって引く'),
    ex('シーテッドロー（マシン or ケーブル）', 3, '10-12', '90秒'),
    ex('インクラインダンベルプレス', 3, '8-12', '90秒', '下ろしたとき胸がしっかり伸びるところまで'),
    ex('ペックフライ（マシン）', 3, '12-15', '60秒'),
    ex('フェイスプル（ケーブル）', 3, '15', '60秒', '姿勢がよくなり胸が張って見える'),
    ex('リバースクランチ', 3, '12-15', '60秒', '下腹を意識'),
  ] };
  const two = [
    { name: 'A 上半身（胸重点）・腹', focus: '胸の丸みと上半身の厚みをつくる日', exercises: [
      A.exercises[0], A.exercises[1], A.exercises[2], C.exercises[0], C.exercises[1], A.exercises[3], A.exercises[4],
    ] },
    { name: 'B 脚・胸・腹', focus: '脚で代謝を上げつつ胸をもう一度刺激する日', exercises: [
      B.exercises[0], B.exercises[1], B.exercises[2], C.exercises[2], C.exercises[3], A.exercises[5], B.exercises[5],
    ] },
  ];
  return {
    source: 'default',
    createdAt: ymd(),
    days: n <= 2 ? two : [A, B, C],
    tips: [
      '腹筋を割るには「腹筋運動」より「体脂肪を減らす」ことが大事。食事の目標カロリーを守りましょう。',
      '胸の丸みは大胸筋の上部が決め手。インクライン（斜め）の種目を毎週欠かさずに。',
      '決めた回数が全セットできたら、次回は重さを少し（2.5kgほど）上げましょう。',
    ],
  };
}
const currentPlan = () => S.plan || defaultPlan(S.settings.daysPerWeek);
const sortedWorkouts = () => [...S.workouts].sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));

function nextPlanDay() {
  const days = currentPlan().days;
  const last = sortedWorkouts().at(-1);
  if (!last) return days[0];
  const i = days.findIndex(d => d.name === last.dayName);
  return days[(i + 1) % days.length];
}
function lastPerf(name, beforeId) {
  const ws = sortedWorkouts().reverse();
  for (const w of ws) {
    if (w.id === beforeId) continue;
    const e = w.exercises.find(x => x.name === name);
    if (e && e.sets.length) return { date: w.date, sets: e.sets };
  }
  return null;
}
const setsText = sets => sets.map(s => `${s.w ?? '-'}kg×${s.r ?? '-'}`).join(', ');
function overloadHint(e, last) {
  if (!last || /秒/.test(e.reps || '')) return '';
  const top = parseInt(String(e.reps || '').split(/[-〜~]/).pop(), 10);
  if (!top) return '';
  return last.sets.every(s => num(s.r) >= top) ? `前回は全セット${top}回できました → 今日は少し重くしてみましょう（+2.5kgほど）` : '';
}
// 推定の最大重量（1回だけ挙げられる重さ）: 重さ×(1+回数/30)
const e1rm = s => (num(s.w) > 0 && num(s.r) > 0 ? num(s.w) * (1 + num(s.r) / 30) : 0);
function strengthText() {
  const map = new Map();
  for (const w of sortedWorkouts()) {
    for (const e of w.exercises) {
      const m = map.get(e.name) || { n: 0, best: 0 };
      m.n++;
      m.best = Math.max(m.best, ...e.sets.map(e1rm));
      m.last = { date: w.date, sets: e.sets };
      map.set(e.name, m);
    }
  }
  if (!map.size) return 'まだ記録なし';
  return [...map].map(([name, m]) => `${name}: 最近 ${m.last.date} ${setsText(m.last.sets)} / 推定最大 ${m.best ? r1(m.best) + 'kg' : '-'} / 記録${m.n}回`).join('\n');
}
function recentWorkoutsText() {
  const ws = sortedWorkouts().slice(-12);
  if (!ws.length) return 'まだ記録なし';
  return ws.map(w => `${w.date} ${w.dayName}: ` + w.exercises.map(e => `${e.name} ${setsText(e.sets)}`).join(' / ')).join('\n');
}
function latestAnalysisText() {
  const a = S.analyses.at(-1);
  if (!a) return 'まだなし';
  const r = a.result;
  return `${a.date}の分析: ${r.overall}\n足りない部位: ${(r.weakPoints || []).map(w => `${w.part}（${w.detail}）`).join('、')}\n重点: ${(r.trainingFocus || []).join('、')}`;
}

// ===================== 画面の切り替え =====================
let tab = 'home';
let mealDate = ymd();
let draft = null; // 入力中のシートの中身

function render() {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const st = S.settings;
  const d = daysUntil(st.targetDate);
  $('#header-sub').textContent = d >= 0 ? `目標の期限まであと${d}日` : '';
  $('#view').innerHTML = VIEWS[tab]();
  window.scrollTo(0, 0);
}

const VIEWS = {
  home() {
    const st = S.settings;
    const t = targets();
    const tot = dayTotals(ymd());
    const b = latestBody();
    const g = absGuide();
    const next = nextPlanDay();
    const lastW = sortedWorkouts().at(-1);
    let html = '';
    if (!st.apiKey || !st.profile.sex || !st.profile.height) {
      html += `<div class="notice"><b>はじめに設定をしましょう</b><br>${!st.apiKey ? '・写真のAI分析に使う「APIキー」<br>' : ''}${!st.profile.sex || !st.profile.height ? '・性別と身長（カロリー計算に使います）<br>' : ''}
        <button class="btn sm" data-act="go" data-tab="settings" style="margin-top:6px">設定を開く</button></div>`;
    }
    html += `<div class="btn-grid">
      <button class="btn primary" data-act="mealPhoto">📷 食事を撮る</button>
      <button class="btn" data-act="mealText">✏️ 食事を文字で</button>
      <button class="btn" data-act="bodyQuick">⚖️ 体重を記録</button>
      <button class="btn" data-act="startWorkout">🏋️ トレーニング</button>
    </div>`;
    html += `<div class="card"><h3>今日の食事</h3>
      ${t ? bar('カロリー', tot.kcal, t.kcal, 'kcal') + bar('たんぱく質', tot.protein, t.protein, 'g')
        : '<p class="muted">体重を一度記録すると、1日の目標カロリーが出ます。</p>'}
      ${t ? `<p class="muted">あと ${r0(Math.max(0, t.kcal - tot.kcal))} kcal・たんぱく質 ${r0(Math.max(0, t.protein - tot.protein))} g</p>` : ''}
    </div>`;
    html += `<div class="card"><h3>目標</h3><ul class="plain">${st.goals.map(x => `<li>${h(x)}</li>`).join('')}</ul>
      ${g ? absGuideHtml(g) : '<p class="muted">性別と体脂肪率が入ると、腹筋が見えるまでの目安を出します。</p>'}</div>`;
    html += `<div class="card"><h3>体の最新データ</h3>${b ? `
      <div class="grid3">
        <div class="stat"><b>${r1(num(b.weight))}</b><span>体重 kg</span></div>
        <div class="stat"><b>${r1(num(b.fatPct))}</b><span>体脂肪率 %</span></div>
        <div class="stat"><b>${r1(num(b.skeletalMuscle ?? b.muscle))}</b><span>${b.skeletalMuscle != null ? '骨格筋量' : '筋肉量'} kg</span></div>
      </div><p class="muted">${jpDate(b.date)}・${SOURCES[b.source] || ''}</p>` : '<p class="muted">まだ記録がありません。</p>'}</div>`;
    html += `<div class="card"><h3>次のトレーニング</h3>
      <p><b>${h(next.name)}</b><br><span class="muted">${h(next.focus || '')}</span></p>
      ${lastW ? `<p class="muted">前回: ${jpDate(lastW.date)} ${h(lastW.dayName)}</p>` : ''}
      <button class="btn block" data-act="startWorkout">このメニューで記録を始める</button></div>`;
    return html;
  },

  meals() {
    const t = targets();
    const tot = dayTotals(mealDate);
    const ms = mealsOn(mealDate);
    let html = `<div class="datenav">
      <button class="btn sm" data-act="mealDay" data-d="-1">‹ 前の日</button>
      <b>${mealDate === ymd() ? '今日 ' : ''}${jpDate(mealDate)}</b>
      <button class="btn sm" data-act="mealDay" data-d="1" ${mealDate >= ymd() ? 'disabled' : ''}>次の日 ›</button>
    </div>`;
    html += `<div class="card">
      ${bar('カロリー', tot.kcal, t?.kcal, 'kcal')}
      ${bar('たんぱく質', tot.protein, t?.protein, 'g')}
      ${bar('脂質', tot.fat, t?.fat, 'g')}
      ${bar('炭水化物', tot.carbs, t?.carbs, 'g')}
    </div>`;
    html += `<div class="btn-grid">
      <button class="btn primary" data-act="mealPhoto">📷 写真で記録</button>
      <button class="btn" data-act="mealText">✏️ 文字で記録</button>
      <button class="btn" data-act="mealFav">⭐ お気に入りから</button>
      <button class="btn" data-act="mealManual">＋ 手で入力</button>
    </div>`;
    for (const [type, label] of MEAL_TYPES) {
      const list = ms.filter(m => m.type === type);
      if (!list.length) continue;
      html += `<div class="card"><div class="spread"><h3>${label}</h3><span class="muted">${r0(sum(list, 'kcal'))} kcal</span></div><ul class="list">
        ${list.map(m => `<li class="tap" data-act="mealEdit" data-id="${m.id}">
          ${m.thumb ? `<img class="thumb" src="${m.thumb}" alt="">` : '<div class="thumb"></div>'}
          <div class="grow"><div class="title">${h(m.name)}</div>
          <div class="muted">${r0(m.kcal)} kcal ・ P ${r0(m.protein)} / F ${r0(m.fat)} / C ${r0(m.carbs)}</div></div>
        </li>`).join('')}</ul></div>`;
    }
    if (!ms.length) html += '<p class="muted" style="text-align:center">この日の記録はまだありません。</p>';
    html += '<p class="muted">P＝たんぱく質、F＝脂質、C＝炭水化物（g）。写真からの推定は2〜3割ほどずれることがあります。</p>';
    return html;
  },

  body() {
    const list = sortedBody();
    const g = absGuide();
    let html = `<div class="btn-grid">
      <button class="btn primary" data-act="bodyReadPhoto" data-src="inbody">📱 InBodyを取り込む</button>
      <button class="btn" data-act="bodyReadPhoto" data-src="tanita">📷 タニタの画面を読む</button>
    </div>
    <button class="btn block" data-act="bodyManual" style="margin-bottom:12px">✏️ 数値を手で入力</button>`;
    if (g) html += `<div class="card"><h3>腹筋が見えるまでの目安</h3>${absGuideHtml(g)}</div>`;
    if (list.length >= 2) {
      const last = list.slice(-60);
      html += `<div class="card"><h3>体重の変化</h3>${lineChart(last.filter(b => num(b.weight) != null).map(b => ({ d: b.date, y: num(b.weight) })), 'kg', 'var(--accent)')}
        <h3 style="margin-top:12px">体脂肪率の変化</h3>
        <div class="legend"><span><i style="background:var(--accent)"></i>InBody</span><span><i style="background:var(--chart2)"></i>タニタ</span></div>
        ${lineChart(last.filter(b => num(b.fatPct) != null && b.source === 'inbody').map(b => ({ d: b.date, y: num(b.fatPct) })), '%', 'var(--accent)',
          last.filter(b => num(b.fatPct) != null && b.source !== 'inbody').map(b => ({ d: b.date, y: num(b.fatPct) })))}
        <p class="muted">InBodyとタニタは測り方が違うので、体脂肪率は同じ機械どうしで比べてください。</p></div>`;
    }
    html += `<div class="card"><div class="spread"><h3>体の写真で分析</h3></div>
      <p class="small">体の写真から、目標に対して足りない部位と、重点的にやるトレーニングをAIが提案します。月に1回くらい、同じ場所・同じ明るさで撮ると変化がわかりやすいです。</p>
      <button class="btn primary block" data-act="bodyAnalyze">📷 体の写真を撮って分析</button>
      ${S.analyses.length ? `<h4>これまでの分析</h4><ul class="list">${[...S.analyses].reverse().map(a => `
        <li class="tap" data-act="analysisView" data-id="${a.id}">
          ${a.photos?.[0] ? `<img class="thumb" src="${a.photos[0]}" alt="">` : '<div class="thumb"></div>'}
          <div class="grow"><div class="title">${jpDate(a.date)}</div><div class="muted">${h((a.result.overall || '').slice(0, 40))}…</div></div>
        </li>`).join('')}</ul>` : ''}
    </div>`;
    html += `<div class="card"><h3>測定の記録</h3>${list.length ? `<ul class="list">${[...list].reverse().map(b => `
      <li class="tap" data-act="bodyEdit" data-id="${b.id}"><div class="grow">
        <div class="title">${jpDate(b.date)} <span class="tag src-${b.source}">${SOURCES[b.source] || ''}</span></div>
        <div class="muted">${r1(num(b.weight))} kg ・ 体脂肪 ${r1(num(b.fatPct))} % ${num(b.skeletalMuscle) != null ? `・ 骨格筋 ${r1(num(b.skeletalMuscle))} kg` : num(b.muscle) != null ? `・ 筋肉 ${r1(num(b.muscle))} kg` : ''}</div>
      </div></li>`).join('')}</ul>` : '<p class="muted">まだ記録がありません。</p>'}</div>`;
    return html;
  },

  train() {
    const plan = currentPlan();
    const ws = sortedWorkouts().reverse();
    let html = `<button class="btn primary block" data-act="startWorkout" style="margin-bottom:12px">🏋️ 今日のトレーニングを記録</button>`;
    html += `<div class="card"><h3>筋トレメモから取り込む</h3>
      <p class="small">筋トレメモの記録画面を画面収録（またはスクショ）すると、AIが種目・重さ・回数を読み取ります。今の実力をもとに、AIが重さまで提案できるようになります。</p>
      <button class="btn block" data-act="kmemoGuide">📱 筋トレメモの記録を取り込む</button></div>`;
    html += `<div class="card"><div class="spread"><h3>今のメニュー</h3><span class="muted">${plan.source === 'ai' ? `AI作成 ${h(plan.createdAt)}` : '基本メニュー'}</span></div>
      ${plan.days.map(d => `<h4>${h(d.name)}</h4><p class="muted" style="margin:0 0 4px">${h(d.focus || '')}</p>
        ${d.exercises.map(e => `<div class="ex"><div class="ex-name">${h(e.name)}</div>
          <div class="small"><span class="tag">${h(e.sets)}セット × ${h(e.reps)}</span><span class="muted">休憩 ${h(e.rest || '-')}${e.weight ? ` ・ 目安 ${h(e.weight)}` : ''}</span></div>
          ${e.progression ? `<div class="small">📈 ${h(e.progression)}</div>` : ''}
          ${e.note ? `<div class="muted">${h(e.note)}</div>` : ''}</div>`).join('')}`).join('')}
      ${plan.tips?.length ? `<h4>アドバイス</h4><ul class="plain small">${plan.tips.map(t => `<li>${h(t)}</li>`).join('')}</ul>` : ''}
      <div class="grid2" style="margin-top:10px">
        <button class="btn primary" data-act="planAI">🤖 AIで作り直す</button>
        <button class="btn" data-act="planDefault">基本メニューに戻す</button>
      </div>
      <p class="muted">AIは、目標・体のデータ・体の写真の分析・これまでの記録・使える器具をもとにメニューを作ります。</p>
    </div>`;
    html += `<div class="card"><h3>トレーニングの記録</h3>${ws.length ? `<ul class="list">${ws.map(w => `
      <li class="tap" data-act="workoutEdit" data-id="${w.id}"><div class="grow">
        <div class="title">${jpDate(w.date)} ${h(w.dayName)}</div>
        <div class="muted">${w.exercises.length}種目 ・ ${w.exercises.reduce((a, e) => a + e.sets.length, 0)}セット</div>
      </div></li>`).join('')}</ul>` : '<p class="muted">まだ記録がありません。</p>'}</div>`;
    return html;
  },

  settings() {
    const st = S.settings, p = st.profile, t = targets();
    const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${h(l)}</option>`).join('');
    return `<div class="card"><h3>AI（Google Gemini）の設定</h3>
      <p class="small">写真の分析には Google の無料AI「Gemini」を使います。下の手順で「APIキー」（AIを使うための合言葉のような文字列）を取ってきて貼り付けてください。</p>
      <ol class="small">
        <li>下のボタンで Google AI Studio を開き、Googleアカウントでログイン</li>
        <li>「APIキーを作成（Create API key）」を押す</li>
        <li>出てきた文字列（AIza…で始まる）をコピーして、下の欄に貼り付け</li>
      </ol>
      <a class="btn sm" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio を開く</a>
      <label class="field">APIキー<input type="password" data-set="apiKey" value="${h(st.apiKey)}" placeholder="AIza..." autocomplete="off"></label>
      <label class="field">AIの種類（うまく動かないときに変えてみてください）<select data-set="model">${opt(MODELS.map(m => [m, m]), st.model)}</select></label>
      <button class="btn sm" data-act="testKey">接続テスト</button>
      <div class="notice">無料枠では、送った写真や文章がGoogleのAI改善に使われることがあります。体の写真は<b>顔を写さず</b>、トレーニングウェアなどで撮るのがおすすめです。APIキーはこのiPhoneの中にだけ保存されます。</div>
    </div>

    <div class="card"><h3>プロフィール</h3>
      <div class="grid2">
        <label class="field">性別（計算用）<select data-set="profile.sex">${opt([['', '選んでください'], ['male', '男性'], ['female', '女性']], p.sex)}</select></label>
        <label class="field">生まれた年<input type="number" inputmode="numeric" data-set="profile.birthYear" value="${h(p.birthYear)}" placeholder="例: 1995"></label>
      </div>
      <label class="field">身長（cm）<input type="number" inputmode="decimal" data-set="profile.height" value="${h(p.height)}" placeholder="例: 172"></label>
      <label class="field">ふだんの活動量<select data-set="profile.activity">${opt(ACTIVITY, p.activity)}</select></label>
    </div>

    <div class="card"><h3>目標</h3>
      <label class="field">なりたい体（1行に1つ）<textarea data-set="goals">${h(st.goals.join('\n'))}</textarea></label>
      <label class="field">期限<input type="date" data-set="targetDate" value="${h(st.targetDate)}"></label>
      <label class="field">今の方針<select data-set="mode">${opt(MODES, st.mode)}</select></label>
      <label class="field">週のトレーニング回数<select data-set="daysPerWeek">${opt([[2, '週2回'], [3, '週3回'], [4, '週4回']], st.daysPerWeek)}</select></label>
      <p class="muted">12月の目標を達成したら、ここを書き換えればそのまま使い続けられます（例: 方針を「増量」にして胸をさらに大きく）。</p>
    </div>

    <div class="card"><h3>1日の目標（自動計算）</h3>
      ${t ? `<div class="grid2 small">
        <div>カロリー: <b>${r0(t.kcal)} kcal</b></div><div>たんぱく質: <b>${r0(t.protein)} g</b></div>
        <div>脂質: <b>${r0(t.fat)} g</b></div><div>炭水化物: <b>${r0(t.carbs)} g</b></div>
      </div>
      <p class="muted">基礎代謝 ${r0(t.bmr)} kcal（${t.how}）× 活動量 → 1日の消費 約${r0(t.tdee)} kcal。${st.mode === 'cut' ? 'そこから約400kcal減らしています。' : st.mode === 'bulk' ? 'そこに約250kcal足しています。' : ''}たんぱく質は体重×2g。</p>`
        : '<p class="muted">体重を記録すると計算されます。</p>'}
      <h4>自分で決めたい場合（空欄なら自動）</h4>
      <div class="grid2">
        <label class="field">カロリー<input type="number" inputmode="numeric" data-set="override.kcal" value="${h(st.override.kcal)}" placeholder="自動"></label>
        <label class="field">たんぱく質 g<input type="number" inputmode="numeric" data-set="override.protein" value="${h(st.override.protein)}" placeholder="自動"></label>
      </div>
    </div>

    <div class="card"><h3>ジムで使える器具</h3>
      ${EQUIPMENT.map(([k, l]) => `<label class="check"><input type="checkbox" data-eq="${k}" ${st.equipment.includes(k) ? 'checked' : ''}>${h(l)}</label>`).join('')}
    </div>

    <div class="card"><h3>データの保存（バックアップ）</h3>
      <p class="small">記録はこのiPhoneの中だけに保存されています。機種変更や万一に備えて、ときどき書き出しておくと安心です。</p>
      <div class="grid2">
        <button class="btn" data-act="exportData">書き出す</button>
        <button class="btn" data-act="importData">読み込む</button>
      </div>
    </div>
    <p class="muted">このアプリの提案は一般的な目安で、医療的な診断ではありません。体調に不安があるときは専門家に相談してください。</p>`;
  },
};

function bar(label, val, target, unit) {
  const pct = target ? Math.min(100, (val / target) * 100) : 0;
  const over = target && val > target * 1.05;
  return `<div class="bar"><div class="bar-top"><span>${label}</span><span><b>${r0(val)}</b> / ${target ? r0(target) : '–'} ${unit}</span></div>
    <div class="bar-track"><div class="bar-fill ${over ? 'over' : ''}" style="width:${pct}%"></div></div></div>`;
}

function absGuideHtml(g) {
  if (g.toLose <= 0.1) return `<div class="hint">体脂肪率 ${r1(g.pct)}% で、腹筋が見えてくる目安（${g.goalPct}%前後）に届いています！ 腹筋種目で凹凸をはっきりさせましょう。</div>`;
  return `<div class="hint">腹筋が見えてくる目安は体脂肪率 <b>${g.goalPct}%前後</b>。今は ${r1(g.pct)}%（${SOURCES[g.source] || ''}）なので、あと<b>約${r1(g.toLose)}kg</b>の脂肪を落とすイメージです。<br>
    期限までだと<b>週${r1(g.perWeek)}kg</b>ペース。${g.safe ? '無理のないペースです。' : '少し急なペースです。期限までに全部は難しくても、近づけば腹筋の上の方から見えてきます。焦って食事を減らしすぎないように。'}</div>`;
}

function lineChart(pts, unit, color, pts2 = []) {
  const all = [...pts, ...pts2];
  if (all.length < 2) return '<p class="muted">2回以上記録するとグラフが出ます。</p>';
  const W = 320, H = 130, L = 34, R = 10, T = 10, B = 22;
  const dates = [...new Set(all.map(p => p.d))].sort();
  const ys = all.map(p => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const x = d => L + (dates.length === 1 ? 0 : (dates.indexOf(d) / (dates.length - 1)) * (W - L - R));
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = (ps, c) => ps.length ? `<polyline fill="none" stroke="${c}" stroke-width="2" points="${ps.map(p => `${x(p.d)},${y(p.y)}`).join(' ')}"/>
    ${ps.map(p => `<circle cx="${x(p.d)}" cy="${y(p.y)}" r="2.5" fill="${c}"/>`).join('')}` : '';
  const md = d => { const t = parseYmd(d); return `${t.getMonth() + 1}/${t.getDate()}`; };
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${unit}の変化">
    <line class="ax" x1="${L}" x2="${W - R}" y1="${y(hi)}" y2="${y(hi)}"/>
    <line class="ax" x1="${L}" x2="${W - R}" y1="${y(lo)}" y2="${y(lo)}"/>
    <text x="${L - 4}" y="${y(hi) + 3}" text-anchor="end">${r1(hi)}</text>
    <text x="${L - 4}" y="${y(lo) + 3}" text-anchor="end">${r1(lo)}</text>
    <text x="${L}" y="${H - 6}">${md(dates[0])}</text>
    <text x="${W - R}" y="${H - 6}" text-anchor="end">${md(dates.at(-1))}</text>
    ${line(pts, color)}${line(pts2, 'var(--chart2)')}
  </svg>`;
}

// ===================== 食事のシート =====================
function mealSheet(m, isNew) {
  draft = structuredClone(m);
  const opt = MEAL_TYPES.map(([v, l]) => `<option value="${v}" ${v === m.type ? 'selected' : ''}>${l}</option>`).join('');
  openSheet(isNew ? '食事を記録' : '食事を編集', `
    ${m.thumb ? `<img src="${m.thumb}" alt="" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px">` : ''}
    ${m.note ? `<div class="hint small">AIのメモ: ${h(m.note)}</div>` : ''}
    <div class="grid2">
      <label class="field">いつ<select id="m-type">${opt}</select></label>
      <label class="field">日付<input type="date" id="m-date" value="${m.date}"></label>
    </div>
    <label class="field">名前<input id="m-name" value="${h(m.name)}"></label>
    <div id="m-total" class="card" style="margin:8px 0"></div>
    <div class="spread"><b class="small">内訳（数字はタップして直せます）</b></div>
    <div class="row wrap" style="margin:6px 0">
      <span class="muted">量を調整:</span>
      ${[0.5, 0.75, 1.25, 1.5].map(f => `<button class="btn sm" data-act="mealScale" data-f="${f}">×${f}</button>`).join('')}
    </div>
    <table class="items"><tbody id="m-items"></tbody></table>
    <button class="btn sm" data-act="mealAddItem" style="margin:6px 0 12px">＋ 品目を追加</button>
    <button class="btn primary block" data-act="mealSave">保存する</button>
    <div class="grid2" style="margin-top:8px">
      <button class="btn" data-act="mealToFav">⭐ お気に入りに追加</button>
      ${isNew ? '<button class="btn" data-act="closeSheet">やめる</button>' : '<button class="btn danger" data-act="mealDelete">削除</button>'}
    </div>`);
  draft._isNew = isNew;
  renderMealItems();
}
function renderMealItems() {
  $('#m-items').innerHTML = `<tr class="muted"><td class="nm">品目</td><td>kcal</td><td>P</td><td>F</td><td>C</td><td></td></tr>` +
    draft.items.map((it, i) => `<tr>
      <td class="nm"><input data-in="mealItem" data-i="${i}" data-k="name" value="${h(it.name)}">${it.amount ? `<div class="muted">${h(it.amount)}</div>` : ''}</td>
      ${['kcal', 'protein', 'fat', 'carbs'].map(k => `<td><input type="number" inputmode="decimal" data-in="mealItem" data-i="${i}" data-k="${k}" value="${r1(it[k])}"></td>`).join('')}
      <td><button class="icon-btn" data-act="mealDelItem" data-i="${i}" aria-label="削除">✕</button></td>
    </tr>`).join('');
  renderMealTotal();
}
function renderMealTotal() {
  recalcMeal(draft);
  $('#m-total').innerHTML = `<div class="grid2 small"><div>カロリー <b>${r0(draft.kcal)} kcal</b></div><div>たんぱく質 <b>${r1(draft.protein)} g</b></div>
    <div>脂質 <b>${r1(draft.fat)} g</b></div><div>炭水化物 <b>${r1(draft.carbs)} g</b></div></div>`;
}
function newMeal(fields) {
  return { id: uid(), date: mealDate, type: defaultMealType(), name: '', items: [], note: '', thumb: '', ...fields };
}

// ===================== 体データのシート =====================
function bodySheet(b, isNew) {
  draft = structuredClone(b);
  draft._isNew = isNew;
  const shown = BODY_FIELDS.filter(([k]) => b.source !== 'tanita' || !['skeletalMuscle', 'score'].includes(k));
  openSheet(isNew ? '測定結果を記録' : '測定結果を編集', `
    ${b.note ? `<div class="hint small">AIのメモ: ${h(b.note)}</div>` : ''}
    <div class="grid2">
      <label class="field">日付<input type="date" id="b-date" value="${b.date}"></label>
      <label class="field">測った機械<select id="b-source">${Object.entries(SOURCES).map(([v, l]) => `<option value="${v}" ${v === b.source ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="grid2">${shown.map(([k, l, u]) => `<label class="field">${l}${u ? `（${u}）` : ''}<input type="number" inputmode="decimal" id="b-${k}" value="${b[k] ?? ''}"></label>`).join('')}</div>
    ${b.extra && Object.keys(b.extra).length ? `<p class="muted">その他の読み取り値: ${h(Object.entries(b.extra).map(([k, v]) => `${k} ${v}`).join('、'))}</p>` : ''}
    <button class="btn primary block" data-act="bodySave">保存する</button>
    ${isNew ? '' : '<button class="btn danger block" data-act="bodyDelete" style="margin-top:8px">削除</button>'}`);
}

function bodyReadPrompt(src, count) {
  const what = src === 'inbody' ? 'InBody（インボディ）の測定結果（スマホアプリの画面のスクリーンショット、または結果用紙）' : 'タニタの体組成計の表示画面（または記録アプリの画面）';
  const multi = count > 1 ? `画像は${count}枚あり、同じ結果画面をスクロールしながら撮ったもの（画面収録から切り出したコマを含む）です。重なっている部分は同じ値なので、すべての画像を見て各項目を1回ずつまとめてください。\n` : '';
  return `これは${what}の画像です。${multi}写っている数値を正確に読み取ってください。読み取れない項目は null にしてください。推測で数字を作らないでください。部位別（右腕・左腕・体幹・右脚・左脚）の筋肉量や体脂肪量、評価（標準・標準以上など）が写っていれば extra に入れてください。
次の形のJSONだけを返してください:
{"date":"測定日 YYYY-MM-DD（写っていなければ null）","weight":体重kg,"fatPct":体脂肪率%,"skeletalMuscle":骨格筋量kg,"muscle":筋肉量kg,"fatMass":体脂肪量kg,"bmr":基礎代謝kcal,"visceral":内臓脂肪レベル,"water":体水分量kg,"score":InBody点数,"extra":{"その他読み取れた項目名（部位別筋肉量、推定骨量、体内年齢、BMIなど）":"値と単位"},"note":"読み取りで気になった点があれば1文"}`;
}

// ===================== InBodyアプリのCSV取り込み =====================
// 列名（単位の手前まで）→ アプリの項目
const INBODY_COLS = {
  '体重': 'weight', '骨格筋量': 'skeletalMuscle', '筋肉量': 'muscle', '体脂肪量': 'fatMass', '体脂肪率': 'fatPct',
  '基礎代謝量': 'bmr', 'InBody点数': 'score', '内臓脂肪レベル': 'visceral', '体水分量': 'water',
};
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function parseInbodyCsv(text) {
  const [head, ...rows] = parseCsv(text.replace(/^\uFEFF/, ''));
  const names = head.map(x => x.trim());
  const dateCol = names.indexOf('日付');
  if (dateCol < 0 || !names.some(n => n.startsWith('体重'))) return null;
  return rows.map(r => {
    const stamp = (r[dateCol] || '').trim();
    const m = stamp.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/);
    if (!m) return null;
    const b = { id: 'inbody-' + stamp, source: 'inbody', date: `${m[1]}-${m[2]}-${m[3]}`, extra: {},
      created: new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() };
    names.forEach((n, i) => {
      const v = (r[i] || '').trim();
      if (i === dateCol || n === '測定機器' || !v || v === '-') return;
      const key = INBODY_COLS[n.replace(/\s*\(.*$/, '')];
      if (key) b[key] = num(v); else b.extra[n] = v;
    });
    return b.weight != null ? b : null;
  }).filter(Boolean);
}

// ===================== 体の写真分析 =====================
const SLOTS = [['front', '正面'], ['side', '横'], ['back', '後ろ']];
function analyzeSheet() {
  draft = { photos: {} };
  openSheet('体の写真で分析', `
    <p class="small">正面・横・後ろの写真を用意してください（正面だけでもOK）。</p>
    <ul class="plain small"><li>力を抜いた自然な姿勢で、全身〜太ももくらいまで</li><li>明るい場所で、毎回同じ場所・同じ時間帯に</li><li>顔は写さなくて大丈夫です</li></ul>
    <div class="slots">${SLOTS.map(([k, l]) => `<button class="slot" data-act="slotPick" data-k="${k}" id="slot-${k}">＋<br>${l}</button>`).join('')}</div>
    <div class="notice">写真はGoogleのAIに送られます（無料枠ではAIの改善に使われることがあります）。アプリ内には小さな写真だけ保存されます。</div>
    <button class="btn primary block" data-act="analyzeRun">分析する</button>`);
}
function analyzePrompt(labels) {
  return `あなたは経験豊富なパーソナルトレーナーです。添付は利用者の体の写真です（順に: ${labels.join('、')}）。
医学的な診断ではなく、トレーニングの方向性を決める参考として、見た目から筋肉の発達具合と体脂肪の付き方を分析してください。正直に、でも前向きな言葉で。
【利用者の情報】
${profileText()}
【なりたい体・目標】
${goalsText()}
【使える器具】${equipmentText()}
【トレーニング頻度】週${S.settings.daysPerWeek}回
【前回の分析】
${latestAnalysisText()}
次の形のJSONだけを返してください:
{"overall":"全体の印象（2〜3文。前回の分析があれば変化にも触れる）","bodyFatEstimate":"見た目からの体脂肪率の目安（例: 15〜18%）","strengths":["よく発達している部位"],"weakPoints":[{"part":"部位","detail":"目標に対してどう足りないか","priority":1}],"trainingFocus":["目標に近づくために重点的にやること（具体的な種目名を含める）"],"nutritionAdvice":"食事についての助言（1〜3文）","nextCheck":"次に写真を撮るときのアドバイス"}
priority は 1（最優先）〜3 の数字です。`;
}
function analysisHtml(a) {
  const r = a.result;
  return `${a.photos?.length ? `<div class="photos-row">${a.photos.map(p => `<img src="${p}" alt="">`).join('')}</div>` : ''}
    <p>${h(r.overall)}</p>
    ${r.bodyFatEstimate ? `<p class="small">見た目の体脂肪率の目安: <b>${h(r.bodyFatEstimate)}</b></p>` : ''}
    ${r.strengths?.length ? `<h4>よく発達している部位</h4><ul class="plain small">${r.strengths.map(s => `<li>${h(s)}</li>`).join('')}</ul>` : ''}
    ${r.weakPoints?.length ? `<h4>伸ばしたい部位</h4><ul class="plain small">${[...r.weakPoints].sort((x, y) => (x.priority || 3) - (y.priority || 3)).map(w => `<li><b>${h(w.part)}</b>${w.priority === 1 ? ' <span class="tag">最優先</span>' : ''}：${h(w.detail)}</li>`).join('')}</ul>` : ''}
    ${r.trainingFocus?.length ? `<h4>重点的にやること</h4><ul class="plain small">${r.trainingFocus.map(s => `<li>${h(s)}</li>`).join('')}</ul>` : ''}
    ${r.nutritionAdvice ? `<h4>食事</h4><p class="small">${h(r.nutritionAdvice)}</p>` : ''}
    ${r.nextCheck ? `<p class="muted">次回の撮影: ${h(r.nextCheck)}</p>` : ''}`;
}

// ===================== メニュー作成（AI） =====================
function planPrompt() {
  const st = S.settings;
  return `あなたは経験豊富なパーソナルトレーナーです。次の利用者のために、週${st.daysPerWeek}回・1回60〜75分のジムのトレーニングメニュー（${st.daysPerWeek}日分のローテーション）を作ってください。
アマチュアでも安全にできる種目を中心に、目標に直結する種目を優先し、腹筋の目標がある場合は毎回お腹の種目を入れてください。種目名は日本のジムで一般的な呼び方にしてください。
【重さの提案（重要）】
- すべての種目に、今日使う重さの目安（weight）を必ず書いてください。
- 記録がある種目は「種目ごとの実力」の最近の重さ×回数と推定最大重量から、指定の回数をフォームを崩さずできる重さにしてください（目標の回数ぎりぎりで2回ほど余力が残る程度）。
- 記録が無い種目は、近い種目の記録から推定し「◯kg前後（初回は軽めで確認）」のように書いてください。自重種目は「自重」と書いてください。
- 記録に同じ種目がある場合は、記録と同じ種目名を使ってください（記録とメニューをつなげるため）。
- progression には「何回できたら何kg上げるか」を書いてください。
【利用者の情報】
${profileText()}
【なりたい体・目標】
${goalsText()}
【使える器具】${equipmentText()}
【体の写真の分析】
${latestAnalysisText()}
【種目ごとの実力（重さの単位はkg）】
${strengthText()}
【最近のトレーニング記録】
${recentWorkoutsText()}
次の形のJSONだけを返してください:
{"days":[{"name":"A 胸・肩・腹 のような短い名前","focus":"この日の狙い（1文）","exercises":[{"name":"種目名","sets":3,"reps":"8-12","rest":"90秒","weight":"今日の重さの目安（例: 40kg）","progression":"重さを上げる条件（例: 3セットとも12回できたら42.5kg）","note":"フォームのコツを短く"}]}],"tips":["全体のアドバイス（2〜4個）"]}`;
}

function kmemoPrompt(count) {
  return `これはiPhoneの筋トレ記録アプリ「筋トレメモ」の画面の画像です（${count}枚。スクロールしながら撮ったもので、同じ内容が重なって写っていることがあります）。
写っているトレーニング記録を、日付ごとにまとめて読み取ってください。
- 重なって写っている同じ記録は1回にまとめる
- 読めない値は null。推測で数字を作らない
- 年が書かれていない日付は、今日（${ymd()}）以前で一番近い日付として解釈する。日付がまったく分からない場合は null
- 重さの単位が lb の場合は kg に換算する。自重の種目は w を 0 にする
- 1セットごとに重さ(w)と回数(r)を分けて入れる（「40kg × 10回 × 3セット」なら同じセットを3つ）
- 種目名は画面の表記のまま
次の形のJSONだけを返してください:
{"sessions":[{"date":"YYYY-MM-DD または null","exercises":[{"name":"種目名","sets":[{"w":40,"r":10}]}]}],"note":"読み取りで気になった点があれば1文"}`;
}

// ===================== トレーニング記録のシート =====================
function workoutSheet(w, isNew) {
  draft = structuredClone(w);
  draft._isNew = isNew;
  const days = currentPlan().days;
  openSheet(isNew ? 'トレーニングを記録' : '記録を編集', `
    <div>
      <label class="field">日付<input type="date" id="w-date" value="${w.date}"></label>
      ${isNew ? `<label class="field">メニュー<select data-in="workoutDay">${days.map((d, i) => `<option value="${i}" ${d.name === w.dayName ? 'selected' : ''}>${h(d.name)}</option>`).join('')}</select></label>` : `<label class="field">メニュー<input value="${h(w.dayName)}" disabled></label>`}
    </div>
    <div id="w-list"></div>
    <div class="row" style="margin:8px 0 12px"><input id="w-newex" placeholder="種目を追加（例: ディップス）"><button class="btn sm" data-act="workoutAddEx">追加</button></div>
    <button class="btn primary block" data-act="workoutSave">保存する</button>
    ${isNew ? '' : '<button class="btn danger block" data-act="workoutDelete" style="margin-top:8px">削除</button>'}`);
  renderWorkoutList();
}
function workoutFromPlanDay(day, date = ymd()) {
  return {
    id: uid(), date, dayName: day.name,
    exercises: day.exercises.map(e => {
      const last = lastPerf(e.name);
      const n = num(e.sets) || 3;
      const sets = Array.from({ length: n }, (_, i) => ({ w: last ? (last.sets[i] || last.sets.at(-1)).w : firstNum(e.weight), r: null }));
      return { name: e.name, reps: e.reps, weight: e.weight || '', target: `${n}×${e.reps}`, sets };
    }),
  };
}
function renderWorkoutList() {
  $('#w-list').innerHTML = draft.exercises.map((e, ei) => {
    const last = lastPerf(e.name, draft.id);
    const hint = overloadHint(e, last);
    return `<div class="ex">
      <div class="spread"><div class="ex-name">${h(e.name)}</div><button class="icon-btn" data-act="workoutDelEx" data-e="${ei}" aria-label="種目を削除">✕</button></div>
      <div class="small">${e.target ? `<span class="tag">目標 ${h(e.target)}${e.weight ? ` ・ ${h(e.weight)}` : ''}</span>` : ''}<span class="muted">${last ? `前回 ${jpDate(last.date)}: ${h(setsText(last.sets))}` : '前回の記録なし'}</span></div>
      ${hint ? `<div class="hint small">${h(hint)}</div>` : ''}
      <table class="sets"><tr><th>セット</th><th>重さ kg</th><th>回数</th><th></th></tr>
        ${e.sets.map((s, si) => `<tr><td>${si + 1}</td>
          <td><input type="number" inputmode="decimal" data-in="wset" data-e="${ei}" data-s="${si}" data-k="w" value="${s.w ?? ''}"></td>
          <td><input type="number" inputmode="numeric" data-in="wset" data-e="${ei}" data-s="${si}" data-k="r" value="${s.r ?? ''}" placeholder="${h(String(e.reps || '').split(/[-〜~]/).pop())}"></td>
          <td><button class="icon-btn" data-act="workoutDelSet" data-e="${ei}" data-s="${si}" aria-label="セットを削除">−</button></td></tr>`).join('')}
      </table>
      <button class="btn sm" data-act="workoutAddSet" data-e="${ei}">＋ セット</button>
    </div>`;
  }).join('');
}

// ===================== ボタンの動き =====================
const ACT = {
  go: el => { tab = el.dataset.tab; render(); },
  closeSheet,

  // ---- 食事 ----
  mealDay: el => { mealDate = addDays(mealDate, +el.dataset.d); render(); },
  async mealPhoto() {
    const [file] = await pickPhotos();
    if (!file) return;
    const img = await fileToJpeg(file, 1280);
    const thumb = await resizeImage(img, 360, 0.7);
    const hint = prompt('補足があれば入力（例: ご飯は半分残した / コンビニのサラダチキン）。無ければそのままOK', '') ?? '';
    const r = await runAI('AIが食事を分析中…', () => gemini(mealPhotoPrompt(hint), [img]));
    if (!r) return;
    mealSheet(newMeal({ ...normalizeMeal(r), thumb }), true);
  },
  async mealText() {
    const text = prompt('食べたものを入力してください\n（例: 牛丼並盛と味噌汁、ゆで卵1個）', '');
    if (!text?.trim()) return;
    const r = await runAI('AIが計算中…', () => gemini(mealTextPrompt(text)));
    if (!r) return;
    mealSheet(newMeal(normalizeMeal(r)), true);
  },
  mealManual: () => mealSheet(newMeal({ name: '', items: [{ name: '', amount: '', kcal: 0, protein: 0, fat: 0, carbs: 0 }] }), true),
  mealFav() {
    if (!S.favorites.length) { alert('お気に入りはまだありません。\n食事を記録するときに「⭐ お気に入りに追加」を押すと、次から1タップで記録できます。'); return; }
    openSheet('お気に入りから記録', `<ul class="list">${S.favorites.map(f => `
      <li><div class="grow tap" data-act="favUse" data-id="${f.id}"><div class="title">${h(f.name)}</div><div class="muted">${r0(f.kcal)} kcal ・ P ${r0(f.protein)} / F ${r0(f.fat)} / C ${r0(f.carbs)}</div></div>
      <button class="icon-btn" data-act="favDelete" data-id="${f.id}" aria-label="お気に入りから外す">🗑</button></li>`).join('')}</ul>`);
  },
  favUse(el) {
    const f = S.favorites.find(x => x.id === el.dataset.id);
    closeSheet();
    mealSheet(newMeal({ name: f.name, items: structuredClone(f.items), thumb: f.thumb || '' }), true);
  },
  async favDelete(el) {
    if (!confirm('このお気に入りを外しますか？（記録済みの食事は消えません）')) return;
    S.favorites = S.favorites.filter(x => x.id !== el.dataset.id);
    await save('favorites');
    ACT.mealFav();
  },
  mealEdit: el => mealSheet(S.meals.find(m => m.id === el.dataset.id), false),
  mealScale(el) {
    const f = +el.dataset.f;
    for (const it of draft.items) for (const k of ['kcal', 'protein', 'fat', 'carbs']) it[k] = Math.round(it[k] * f * 10) / 10;
    renderMealItems();
  },
  mealAddItem: () => { draft.items.push({ name: '', amount: '', kcal: 0, protein: 0, fat: 0, carbs: 0 }); renderMealItems(); },
  mealDelItem: el => { draft.items.splice(+el.dataset.i, 1); renderMealItems(); },
  async mealSave() {
    const m = recalcMeal({ ...draft, type: $('#m-type').value, date: $('#m-date').value || mealDate, name: $('#m-name').value.trim() || draft.items.map(i => i.name).join('・') || '食事' });
    delete m._isNew;
    if (draft._isNew) { m.created = Date.now(); S.meals.push(m); }
    else S.meals = S.meals.map(x => (x.id === m.id ? m : x));
    await save('meals');
    mealDate = m.date;
    closeSheet();
    toast(`保存しました（${r0(m.kcal)} kcal）`);
    render();
  },
  async mealDelete() {
    if (!confirm('この食事の記録を削除しますか？')) return;
    S.meals = S.meals.filter(x => x.id !== draft.id);
    await save('meals');
    closeSheet();
    render();
  },
  async mealToFav() {
    recalcMeal(draft);
    const name = $('#m-name').value.trim() || draft.items.map(i => i.name).join('・');
    S.favorites.push({ id: uid(), name, items: structuredClone(draft.items), kcal: draft.kcal, protein: draft.protein, fat: draft.fat, carbs: draft.carbs, thumb: draft.thumb || '' });
    await save('favorites');
    toast('お気に入りに追加しました');
  },

  // ---- 体 ----
  bodyReadPhoto(el) {
    const src = el.dataset.src;
    if (src === 'inbody') {
      openSheet('InBodyの結果を取り込む', `
        <h4>おすすめ: 画面収録で1回撮るだけ</h4>
        <ol class="small">
          <li>InBodyアプリで結果画面を開く</li>
          <li>画面の右上から下にスワイプして「コントロールセンター」を出し、⏺（画面収録）を押す</li>
          <li>3秒後に録画が始まるので、結果画面を<b>ゆっくり下までスクロール</b></li>
          <li>画面上の赤い部分をタップして録画を止める</li>
          <li>下のボタンで、その動画を選ぶ</li>
        </ol>
        <p class="muted">⏺が見つからないときは、iPhoneの「設定」→「コントロールセンター」で「画面収録」を追加してください。</p>
        <h4>スクリーンショットでもOK</h4>
        <p class="small">何枚かあっても、まとめて選べます。1枚目の画面（体重・骨格筋量・体脂肪率）だけでも記録できます。</p>
        <button class="btn primary block" data-act="bodyReadFiles" data-src="inbody">動画・スクショを選ぶ</button>
        <h4>過去の記録をまとめて取り込む</h4>
        <p class="small">InBodyアプリから書き出したCSVファイルを選ぶと、全部の記録をまとめて取り込みます（AIは使いません）。前に取り込んだ記録は重複しません。</p>
        <button class="btn block" data-act="inbodyCsv">📄 CSVファイルを選ぶ</button>`);
      return;
    }
    ACT.bodyReadFiles(el);
  },
  async bodyReadFiles(el) {
    const src = el.dataset.src;
    const files = await pickPhotos(true, src === 'inbody' ? 'image/*,video/*' : 'image/*');
    if (!files.length) return;
    let imgs;
    busy(true, '画像を準備中…');
    try { imgs = await filesToImages(files); }
    catch (e) { alert(e.message || '画像を読み込めませんでした'); return; }
    finally { busy(false); }
    const r = await runAI('AIが数値を読み取り中…', () => gemini(bodyReadPrompt(src, imgs.length), imgs));
    if (!r) return;
    const b = { id: uid(), source: src, date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : ymd(), note: r.note || '', extra: r.extra || {} };
    for (const [k] of BODY_FIELDS) b[k] = num(r[k]);
    bodySheet(b, true);
  },
  bodyQuick: () => openSheet('体重を記録', `
    <p class="small">タニタの体重計の画面（またはアプリの画面）を撮ると、AIが数値を読み取ります。</p>
    <button class="btn primary block" data-act="bodyReadPhoto" data-src="tanita">📷 画面を撮って読み取る</button>
    <button class="btn block" data-act="bodyReadPhoto" data-src="inbody" style="margin-top:8px">📱 InBodyを取り込む</button>
    <button class="btn block" data-act="bodyManual" style="margin-top:8px">✏️ 手で入力</button>`),
  async inbodyCsv() {
    const [file] = await pickPhotos(false, '.csv,text/csv,text/comma-separated-values');
    if (!file) return;
    const list = parseInbodyCsv(await file.text());
    if (!list) { alert('InBodyのCSVとして読み取れませんでした。InBodyアプリから書き出したファイルを選んでください。'); return; }
    const have = new Set(S.body.map(b => b.id));
    const fresh = list.filter(b => !have.has(b.id));
    if (!fresh.length) { alert(`${list.length}件の記録がありましたが、すべて取り込み済みです。`); return; }
    const dates = fresh.map(b => b.date).sort();
    if (!confirm(`${list.length}件の記録が見つかりました。\nそのうち新しい ${fresh.length}件（${jpDate(dates[0])}〜${jpDate(dates.at(-1))}）を取り込みますか？`)) return;
    S.body.push(...fresh);
    await save('body');
    closeSheet();
    toast(`${fresh.length}件取り込みました`);
    render();
  },
  bodyManual: () => bodySheet({ id: uid(), source: 'tanita', date: ymd(), extra: {} }, true),
  bodyEdit: el => bodySheet(S.body.find(b => b.id === el.dataset.id), false),
  async bodySave() {
    const b = { ...draft, date: $('#b-date').value || ymd(), source: $('#b-source').value };
    for (const [k] of BODY_FIELDS) { const i = $(`#b-${k}`); if (i) b[k] = num(i.value); }
    delete b._isNew;
    if (b.weight == null && b.fatPct == null) { alert('体重か体脂肪率を入れてください'); return; }
    if (draft._isNew) { b.created = Date.now(); S.body.push(b); }
    else S.body = S.body.map(x => (x.id === b.id ? b : x));
    await save('body');
    closeSheet();
    toast('保存しました');
    render();
  },
  async bodyDelete() {
    if (!confirm('この測定記録を削除しますか？')) return;
    S.body = S.body.filter(x => x.id !== draft.id);
    await save('body');
    closeSheet();
    render();
  },
  bodyAnalyze: () => analyzeSheet(),
  async slotPick(el) {
    const k = el.dataset.k;
    const [file] = await pickPhotos();
    if (!file) return;
    draft.photos[k] = await fileToJpeg(file, 1280);
    $(`#slot-${k}`).innerHTML = `<img src="${draft.photos[k]}" alt="">`;
  },
  async analyzeRun() {
    const chosen = SLOTS.filter(([k]) => draft.photos[k]);
    if (!chosen.length) { alert('写真を1枚以上選んでください'); return; }
    const imgs = chosen.map(([k]) => draft.photos[k]);
    const r = await runAI('AIが体を分析中…\n（少し時間がかかります）', () => gemini(analyzePrompt(chosen.map(c => c[1])), imgs));
    if (!r) return;
    const photos = await Promise.all(imgs.map(i => resizeImage(i, 400, 0.7)));
    const a = { id: uid(), date: ymd(), photos, result: r };
    S.analyses.push(a);
    await save('analyses');
    render();
    openSheet(`分析結果 ${jpDate(a.date)}`, analysisHtml(a) + `
      <div class="hint small">この分析をもとにトレーニングメニューを作り直せます。</div>
      <button class="btn primary block" data-act="planAI">🤖 この分析でメニューを作る</button>`);
  },
  analysisView(el) {
    const a = S.analyses.find(x => x.id === el.dataset.id);
    openSheet(`分析結果 ${jpDate(a.date)}`, analysisHtml(a) + '<button class="btn danger block" data-act="analysisDelete" style="margin-top:12px">この分析を削除</button>');
    draft = { id: a.id };
  },
  async analysisDelete() {
    if (!confirm('この分析結果を削除しますか？')) return;
    S.analyses = S.analyses.filter(x => x.id !== draft.id);
    await save('analyses');
    closeSheet();
    render();
  },

  // ---- トレーニング ----
  async planAI() {
    const r = await runAI('AIがメニューを作成中…\n（少し時間がかかります）', () => gemini(planPrompt()));
    if (!r?.days?.length) return;
    S.plan = {
      source: 'ai', createdAt: ymd(),
      days: r.days.map(d => ({ name: String(d.name), focus: d.focus || '', exercises: (d.exercises || []).map(e => ({ name: String(e.name), sets: num(e.sets) || 3, reps: String(e.reps ?? ''), rest: e.rest || '', weight: e.weight || '', progression: e.progression || '', note: e.note || '' })) })),
      tips: r.tips || [],
    };
    await save('plan');
    closeSheet();
    tab = 'train';
    render();
    toast('新しいメニューを作りました');
  },
  async planDefault() {
    if (!confirm('基本メニューに戻しますか？（今のAIメニューは消えます）')) return;
    S.plan = null;
    await save('plan');
    render();
  },
  kmemoGuide: () => openSheet('筋トレメモから取り込む', `
    <ol class="small">
      <li>筋トレメモで、記録が日付ごとに並んでいる画面（種目・重さ・回数が見える画面）を開く</li>
      <li>コントロールセンターから⏺（画面収録）を押す</li>
      <li>録画が始まったら、<b>ゆっくり</b>スクロール（直近1〜2か月分くらいで十分です）。詳しい画面を開く必要がある場合は、開いて少し止まってから次へ</li>
      <li>画面上の赤い部分をタップして止める</li>
      <li>下のボタンで、その動画を選ぶ</li>
    </ol>
    <p class="muted">スクリーンショットを何枚か選んでもOKです。読み取った内容は、保存する前に確認できます。</p>
    <button class="btn primary block" data-act="kmemoPick">動画・スクショを選ぶ</button>`),
  async kmemoPick() {
    const files = await pickPhotos(true, 'image/*,video/*');
    if (!files.length) return;
    let imgs;
    busy(true, '画像を準備中…');
    try { imgs = await filesToImages(files, 1600, 24, 30); }
    catch (e) { alert(e.message || '画像を読み込めませんでした'); return; }
    finally { busy(false); }
    const r = await runAI('AIがトレーニング記録を読み取り中…\n（少し時間がかかります）', () => gemini(kmemoPrompt(imgs.length), imgs));
    if (!r) return;
    const sessions = (r.sessions || []).map(x => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : null,
      exercises: (x.exercises || []).map(e => ({
        name: String(e.name || '').trim(),
        sets: (e.sets || []).map(t => ({ w: num(t.w) ?? 0, r: num(t.r) })).filter(t => t.r != null),
      })).filter(e => e.name && e.sets.length),
    })).filter(x => x.exercises.length);
    if (!sessions.length) { alert('トレーニング記録を読み取れませんでした。種目・重さ・回数が見える画面で、もう一度試してください。'); return; }
    const sig = w => w.date + '|' + w.exercises.map(e => e.name).sort().join(',');
    const have = new Set(S.workouts.map(sig));
    draft = {
      fresh: sessions.map(x => ({ id: uid(), date: x.date || ymd(), dayName: x.date ? '筋トレメモから' : '筋トレメモから（日付不明）', source: 'kmemo', exercises: x.exercises }))
        .filter(w => !have.has(sig(w))),
    };
    if (!draft.fresh.length) { alert('読み取った記録は、すべて取り込み済みでした。'); return; }
    draft.fresh.sort((a, b) => a.date.localeCompare(b.date));
    openSheet('読み取った記録', `
      ${r.note ? `<div class="hint small">AIのメモ: ${h(r.note)}</div>` : ''}
      <p class="small">${draft.fresh.length}回分の記録を読み取りました。内容を確認してください（間違いはあとで記録一覧から直せます）。</p>
      ${draft.fresh.map(w => `<div class="ex"><div class="ex-name">${jpDate(w.date)}${w.dayName.includes('不明') ? ' <span class="tag">日付不明</span>' : ''}</div>
        ${w.exercises.map(e => `<div class="small">${h(e.name)}：<span class="muted">${h(setsText(e.sets))}</span></div>`).join('')}</div>`).join('')}
      <button class="btn primary block" data-act="kmemoSave" style="margin-top:12px">取り込む</button>
      <button class="btn block" data-act="closeSheet" style="margin-top:8px">やめる</button>`);
  },
  async kmemoSave() {
    const n = draft.fresh.length;
    S.workouts.push(...draft.fresh.map((w, i) => ({ ...w, created: Date.now() + i })));
    await save('workouts');
    closeSheet();
    render();
    if (confirm(`${n}回分を取り込みました。\nこの記録をもとに、AIで重さ入りのメニューを作りますか？`)) ACT.planAI();
  },
  startWorkout: () => workoutSheet(workoutFromPlanDay(nextPlanDay()), true),
  workoutEdit: el => workoutSheet(S.workouts.find(w => w.id === el.dataset.id), false),
  workoutAddEx() {
    const name = $('#w-newex').value.trim();
    if (!name) return;
    const last = lastPerf(name);
    draft.exercises.push({ name, reps: '', target: '', sets: last ? last.sets.map(s => ({ w: s.w, r: null })) : [{ w: null, r: null }] });
    $('#w-newex').value = '';
    renderWorkoutList();
  },
  workoutDelEx: el => { draft.exercises.splice(+el.dataset.e, 1); renderWorkoutList(); },
  workoutAddSet(el) {
    const sets = draft.exercises[+el.dataset.e].sets;
    sets.push({ w: sets.at(-1)?.w ?? null, r: null });
    renderWorkoutList();
  },
  workoutDelSet: el => { draft.exercises[+el.dataset.e].sets.splice(+el.dataset.s, 1); renderWorkoutList(); },
  async workoutSave() {
    const w = { ...draft, date: $('#w-date').value || ymd() };
    delete w._isNew;
    w.exercises = w.exercises.map(e => ({ ...e, sets: e.sets.filter(s => num(s.r) != null) })).filter(e => e.sets.length);
    if (!w.exercises.length) { alert('回数を入れたセットがありません。やった回数を入れてから保存してください。'); return; }
    if (draft._isNew) { w.created = Date.now(); S.workouts.push(w); }
    else S.workouts = S.workouts.map(x => (x.id === w.id ? w : x));
    await save('workouts');
    closeSheet();
    toast('おつかれさまでした！記録しました');
    render();
  },
  async workoutDelete() {
    if (!confirm('このトレーニング記録を削除しますか？')) return;
    S.workouts = S.workouts.filter(x => x.id !== draft.id);
    await save('workouts');
    closeSheet();
    render();
  },

  // ---- 設定 ----
  async testKey() {
    const r = await runAI('接続テスト中…', () => gemini('{"ok":true} というJSONだけを返してください。'));
    if (r) alert('接続できました！写真のAI分析が使えます。');
  },
  exportData() {
    const data = JSON.stringify({ app: 'bodymake', exportedAt: new Date().toISOString(), ...S, settings: { ...S.settings, apiKey: '' } });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `bodymake-backup-${ymd()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  async importData() {
    const file = await new Promise(ok => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = '.json,application/json';
      i.style.display = 'none';
      i.onchange = () => { ok(i.files[0]); i.remove(); };
      document.body.appendChild(i);
      i.click();
    });
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (d.app !== 'bodymake') throw new Error();
      if (!confirm('バックアップを読み込むと、今このiPhoneに入っている記録は置き換わります。よろしいですか？')) return;
      const key = S.settings.apiKey;
      for (const k of Object.keys(S)) if (k in d) S[k] = d[k];
      S.settings = mergeSettings(S.settings);
      if (!S.settings.apiKey) S.settings.apiKey = key;
      await save(...Object.keys(S));
      toast('読み込みました');
      render();
    } catch { alert('このファイルは読み込めませんでした（bodymakeのバックアップではないようです）'); }
  },
};

const INPUT = {
  mealItem(el) {
    const it = draft.items[+el.dataset.i];
    it[el.dataset.k] = el.dataset.k === 'name' ? el.value : num(el.value) || 0;
    renderMealTotal();
  },
  wset(el) {
    draft.exercises[+el.dataset.e].sets[+el.dataset.s][el.dataset.k] = num(el.value);
  },
  workoutDay(el) {
    const date = $('#w-date').value;
    const day = currentPlan().days[+el.value];
    const w = workoutFromPlanDay(day, date);
    draft = { ...w, _isNew: true };
    renderWorkoutList();
  },
};

async function onSettingChange(el) {
  const st = S.settings;
  if (el.dataset.eq) {
    const k = el.dataset.eq;
    st.equipment = el.checked ? [...new Set([...st.equipment, k])] : st.equipment.filter(x => x !== k);
  } else {
    const path = el.dataset.set.split('.');
    let v = el.value;
    if (path[0] === 'goals') v = v.split('\n').map(s => s.trim()).filter(Boolean);
    if (['daysPerWeek'].includes(path[0]) || path[1] === 'activity') v = num(v);
    if (path.length === 2) st[path[0]][path[1]] = v; else st[path[0]] = v;
  }
  await save('settings');
  // 目標値の表示を更新（入力中の欄はそのまま）
  if (!el.matches('textarea, input[type=password]')) {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }
  toast('保存しました');
}

// ===================== 起動 =====================
document.addEventListener('click', e => {
  const tabBtn = e.target.closest('#tabs button');
  if (tabBtn) { tab = tabBtn.dataset.tab; if (tab === 'meals') mealDate = ymd(); render(); return; }
  if (e.target.id === 'sheet') { closeSheet(); return; }
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) { e.preventDefault(); ACT[el.dataset.act](el, e); }
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-in]');
  if (el && el.tagName !== 'SELECT' && INPUT[el.dataset.in]) INPUT[el.dataset.in](el, e);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.matches('select[data-in]') && INPUT[el.dataset.in]) INPUT[el.dataset.in](el, e);
  if (el.matches('[data-set], [data-eq]')) onSettingChange(el);
});

(async () => {
  try { await navigator.storage?.persist?.(); } catch {}
  await loadAll();
  render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
