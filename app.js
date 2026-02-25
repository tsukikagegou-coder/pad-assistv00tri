/* ====================================================================
   パズドラ アシスト検討応援ツール v2 - app.js (改修版)
   ==================================================================== */

// ==================== グローバルデータ ====================
let allMonsters = [];
let assistMonsters = [];   // アシスト可能 (assist=1 かつ awakens[0]=49)
let skillMap = {};
let awakenNames = {};
let attrNames = {};
let typeNames = {};

// ==================== UI状態 ====================
let currentStep = 0;
const baseMonsters = [null, null, null, null, null, null];

// STEP1: 各スロットの条件
const slotConditions = Array.from({ length: 6 }, () => ({
  requiredAwakens: [],
  attrCondition: null,
  typeCondition: null,
  skillUsable: true,
  resonance: false,
  dpsPriority: false,
  skillKeyword: "", // 追加
}));

// STEP2: 有効な火力覚醒
let selectedDpsAwakens = new Set();

// STEP3: パーティ全体の必要覚醒 {awakenId: count}
let partyRequiredAwakens = {};
let requiredSB = 0;
let delayAsSB = false;

// 除外リスト
let excludedMonsterNos = new Set();

// 計算制御
let stopRequested = false;
let dfsIterCount = 0;

// 固定アシスト { slotIdx: monster }
let pinnedAssists = {};

// ==================== 火力覚醒ペアリング ====================
// ベース覚醒 → ＋覚醒 のマッピング
// STEP2ではベースのみ表示し、選択時に＋版も自動選択
const DPS_AWAKEN_PAIRS = {
  27: 96,    // 2way → 2way+
  43: 107,   // 7強 → 7強+
  61: 111,   // 10強 → 10強+
  22: 116,   // 火列 → 火列x3
  23: 117,   // 水列 → 水列x3
  24: 118,   // 木列 → 木列x3
  25: 119,   // 光列 → 光列x3
  26: 120,   // 闇列 → 闇列x3
  73: 121,   // 火コンボ → 火コンボ+
  74: 122,   // 水コンボ → 水コンボ+
  75: 123,   // 木コンボ → 木コンボ+
  76: 124,   // 光コンボ → 光コンボ+
  77: 125,   // 闇コンボ → 闇コンボ+
  78: 110,   // 十字 → 十字+
  79: 112,   // 3色 → 3色+
  80: 113,   // 4色 → 4色+
  81: 114,   // 5色 → 5色+
  60: 108,   // L字 → L字+
  48: 109,   // 無効貫通 → 無効貫通+
  20: 115,   // バインド回復 → バインド回復+
};

// STEP2で表示するベース火力覚醒ID（＋版は自動で含まれる）
const DPS_BASE_IDS = [
  27, 43, 61,          // 2way, 7強, 10強
  22, 23, 24, 25, 26,  // 列強化
  73, 74, 75, 76, 77,  // コンボ強化
  78, 60, 48,          // 十字, L字, 無効貫通
  79, 80, 81,          // 多色
  82,                  // 超つなげ
  57, 58,              // HP50%
  126,                 // T字
  106,                 // 浮遊
  133, 134, 135,       // 同時攻撃
  141,                 // 達人多色
  45, 50,              // 追加攻撃, 超追加攻撃
  59,                  // 回復L字
  71, 72,              // ドロップ加護
  128, 129,            // 陽/陰の加護
  130,                 // 熟成
  44,                  // ガードブレイク
  138,                 // アシスト共鳴
  139,                 // 自力
  131, 132,            // 部位破壊, アフタヌーンティ
  // キラー
  31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42,
];

// 表示除外する覚醒ID
const HIDDEN_AWAKEN_IDS = new Set([0, 49, 142]);
const DASH_NAMES = new Set(['-', 'null', '']);
// STEP3覚醒グリッドから除外するID（SB系は下部の数値入力で管理）
const PARTY_HIDDEN_AWAKEN_IDS = new Set([21, 56, 105]);

// ==================== データ読み込み ====================

async function loadAllData() {
  try {
    const [monsterRes, skillRes] = await Promise.all([
      fetch('./monster_data.json'),
      fetch('./skill_list.json'),
    ]);
    if (!monsterRes.ok || !skillRes.ok) throw new Error('API fetch failed');

    allMonsters = await monsterRes.json();
    skillMap = await skillRes.json();

    // ヘイスト・遅延をスキルにパース
    for (const key of Object.keys(skillMap)) {
      const s = skillMap[key];
      s.hasteTurns = 0;
      s.delayTurns = 0;
      if (s.description) {
        const hm = s.description.match(/自分以外のスキルが(\d+)ターン溜まる/);
        if (hm) s.hasteTurns = parseInt(hm[1]);
        const dm = s.description.match(/敵の行動を(\d+)ターン遅らせる/);
        if (dm) s.delayTurns = parseInt(dm[1]);
      }
    }

    // アシスト可能モンスター: assist=1 かつ awakens[0]=49
    assistMonsters = allMonsters.filter(m =>
      m.assist === 1 && Array.isArray(m.awakens) && m.awakens[0] === 49
    );

    await loadCSVMappings();
    return true;
  } catch (err) {
    console.error('Data load error:', err);
    const loadingText = document.querySelector('.loading-text');
    if (loadingText) loadingText.textContent = 'データの読み込みに失敗しました。ページを再読み込みしてください。';
    return false;
  }
}

// ==================== オープニングアニメーション ====================

function playOpeningAnimation() {
  return new Promise(resolve => {
    const rainbowRects = document.querySelectorAll('.rainbow-rect');
    const burstGroup = document.getElementById('burst-particles');
    const title = document.querySelector('.opening-title');

    // ① 四角いマークが6つ並んでいる (HTML/CSSで初期表示)

    // ② 虹色の四角が6つ下からやってきて、①にくっつく
    setTimeout(() => {
      rainbowRects.forEach((rect, i) => {
        setTimeout(() => {
          rect.classList.add('rainbow-move');
        }, i * 100);
      });
    }, 500);

    // ③ ポップな虹色に弾けて、タイトル表示
    // floatUpGummy は 1.2s (1200ms)
    // 最後の四角の開始が 500 + 500 = 1000ms
    // よって 1000ms + 1200ms = 2200ms 付近ですべてのアニメーションが完了
    setTimeout(() => {
      // 爆発エフェクトの生成
      createBurstEffect(burstGroup);

      // 虹色四角を消してタイトルを表示
      rainbowRects.forEach(rect => rect.style.display = 'none');
      document.querySelector('.slots-group').style.display = 'none';

      title.classList.add('pop-in');

      // アニメーション完了 (少し余韻を残す)
      setTimeout(resolve, 2000);
    }, 2200);
  });
}

function createBurstEffect(parent) {
  const colors = ['#ff5f5f', '#ffbd5f', '#fff15f', '#5fff7d', '#5fb8ff', '#b85fff'];
  const centerX = [70, 125, 180, 235, 290, 345];
  const centerY = 120;

  centerX.forEach((cx, i) => {
    const color = colors[i];
    for (let j = 0; j < 12; j++) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const angle = (Math.PI * 2 * j) / 12;
      const dist = 30 + Math.random() * 40;
      const tx = Math.cos(angle) * dist;
      const ty = Math.sin(angle) * dist;

      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', centerY);
      circle.setAttribute('r', 2 + Math.random() * 4);
      circle.style.fill = color;
      circle.style.setProperty('--tx', `${tx}px`);
      circle.style.setProperty('--ty', `${ty}px`);
      circle.classList.add('particle');

      parent.appendChild(circle);
    }
  });
}

async function loadCSVMappings() {
  try {
    const [awakRes, attrRes, typeRes] = await Promise.all([
      fetch('./awakens/awakens_name.csv'),
      fetch('./attributes/attributes_name.csv'),
      fetch('./type/type_name.csv'),
    ]);
    const awakText = await awakRes.text();
    awakText.trim().split('\n').forEach(line => {
      const parts = line.replace('\r', '').split(',');
      if (parts.length >= 2 && parts[0] !== 'no') awakenNames[parseInt(parts[0])] = parts[1];
    });
    const attrText = await attrRes.text();
    attrText.trim().split('\n').forEach(line => {
      const parts = line.replace('\r', '').split(',');
      if (parts.length >= 2 && parts[0] !== 'no') attrNames[parseInt(parts[0])] = parts[1];
    });
    const typeText = await typeRes.text();
    typeText.trim().split('\n').forEach(line => {
      const parts = line.replace('\r', '').split(',');
      if (parts.length >= 2 && parts[0] !== 'no') typeNames[parseInt(parts[0])] = parts[1];
    });
  } catch (err) { console.warn('CSV mapping load warning:', err); }
}

// ==================== ユーティリティ ====================

function getActiveAwakens(monster) {
  return (monster.awakens || []).filter(a => a !== 0 && a !== 49);
}

function getAllAwakens(monster) {
  // 覚醒アシスト(49)含めて全覚醒を返す（0は除外）
  return (monster.awakens || []).filter(a => a !== 0);
}

function getMonsterSB(monster) {
  let sb = 0;
  for (const a of (monster.awakens || [])) {
    if (a === 21) sb += 1;
    if (a === 56) sb += 2;
    if (a === 105) sb -= 1;
  }
  return sb;
}

function getSkillInfo(monster) {
  const sid = monster.skill;
  return (sid && skillMap[sid]) ? skillMap[sid] : null;
}

function getHasteTurns(monster) {
  const s = getSkillInfo(monster);
  return s ? s.hasteTurns : 0;
}

function getDelayTurns(monster) {
  const s = getSkillInfo(monster);
  return s ? s.delayTurns : 0;
}

function hasResonance(base, assist) {
  if (!base || !assist) return false;
  const bAttr = (base.attributes || [])[0];
  const aAttr = (assist.attributes || [])[0];
  if (bAttr !== aAttr || !bAttr) return false;
  const bTypes = (base.types || []).filter(t => t > 0);
  const aTypes = (assist.types || []).filter(t => t > 0);
  return bTypes.some(t => aTypes.includes(t));
}

// 浮遊の変身チェック: ベースが変身後も含めて浮遊を持っているか
function baseHasLevitation(base) {
  if (!base) return false;
  const aw = getBaseAwakensContribution(base);
  return aw.includes(106);
}

/**
 * ベースモンスターのアシスト無しの状態での「最終形態」の覚醒を取得（変身対応）
 */
function getBaseAwakensContribution(base) {
  if (!base) return [];
  let current = base;
  let visited = new Set();
  while (current && !visited.has(current.no)) {
    visited.add(current.no);
    const skill = getSkillInfo(current);
    if (skill && skill.changeMonsterNo) {
      const next = allMonsters.find(m => m.no === skill.changeMonsterNo);
      if (next) { current = next; continue; }
    }
    break;
  }
  return current.awakens || [];
}

function awakenIcon(id) { return `awakens/icon/${id}.png`; }
function attrIcon(id) { return `attributes/icon/${id}.png`; }
function typeIcon(id) { return `type/icon/${id}.png`; }
function awakenName(id) { return awakenNames[id] || `覚醒${id}`; }
function attrName(id) { return attrNames[id] || `属性${id}`; }
function typeName(id) { return typeNames[id] || `タイプ${id}`; }

// 有効な覚醒IDリスト（表示用）
function getValidAwakenIds() {
  return Object.keys(awakenNames)
    .map(Number)
    .filter(id => !isNaN(id) && !HIDDEN_AWAKEN_IDS.has(id) && !DASH_NAMES.has(awakenNames[id]))
    .sort((a, b) => a - b);
}

// ==================== UI初期化 ====================

function initUI() {
  initBaseSlots();
  initCondSlots();
  initDpsAwakensGrid();
  initPartyAwakensGrid();
  initStepIndicator();
}

function initStepIndicator() {
  document.querySelectorAll('.step-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const step = parseInt(dot.dataset.step);
      if (!isNaN(step)) goToStep(step);
    });
  });
}

function goToStep(step) {
  currentStep = step;
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`step-${step}`);
  if (panel) panel.classList.add('active');

  document.querySelectorAll('.step-dot').forEach(d => {
    const s = parseInt(d.dataset.step);
    d.classList.remove('active', 'completed');
    if (s === step) d.classList.add('active');
    else if (s < step) d.classList.add('completed');
  });
  document.querySelectorAll('.step-line').forEach(l => {
    const s = parseInt(l.dataset.line);
    l.classList.toggle('completed', s < step);
  });

  // ステップ遷移時の情報更新
  if (step === 1) updateStep1BaseInfo();
  if (step === 2) updateStep2Summary();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== STEP 0: ベースモンスタースロット ====================

function initBaseSlots() {
  const container = document.getElementById('base-slot-contents');
  container.innerHTML = '';

  for (let i = 0; i < 6; i++) {
    const div = document.createElement('div');
    div.className = `slot-content ${i === 0 ? 'active' : ''}`;
    div.id = `base-slot-${i}`;
    div.innerHTML = `
      <div class="search-wrapper">
        <span class="search-icon">🔍</span>
        <input type="text" class="search-input" id="base-search-${i}"
               placeholder="No. or モンスター名を入力" autocomplete="off">
      </div>
      <div class="search-results" id="base-results-${i}"></div>
      <div class="monster-info" id="base-info-${i}"></div>
    `;
    container.appendChild(div);

    const input = div.querySelector(`#base-search-${i}`);
    const results = div.querySelector(`#base-results-${i}`);
    input.addEventListener('input', () => searchMonsters(input.value, results, i));
    input.addEventListener('focus', () => { if (input.value.length > 0) results.classList.add('show'); });
    document.addEventListener('click', (e) => { if (!div.contains(e.target)) results.classList.remove('show'); });
  }

  // タブ切替
  document.querySelectorAll('#base-slot-tabs .slot-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const slot = parseInt(tab.dataset.slot);
      document.querySelectorAll('#base-slot-tabs .slot-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('#base-slot-contents .slot-content').forEach(c => c.classList.remove('active'));
      document.getElementById(`base-slot-${slot}`).classList.add('active');
      const input = document.getElementById(`base-search-${slot}`);
      if (input) input.focus();
    });
  });
}

function searchMonsters(query, resultsEl, slotIdx) {
  resultsEl.innerHTML = '';
  if (!query || query.length < 1) { resultsEl.classList.remove('show'); return; }
  const q = query.trim().toLowerCase();
  let matches = [];
  if (/^\d+$/.test(q)) {
    matches = allMonsters.filter(m => String(m.no).startsWith(q)).slice(0, 30);
  } else {
    matches = allMonsters.filter(m => m.name && m.name.toLowerCase().includes(q)).slice(0, 30);
  }
  if (matches.length === 0) {
    resultsEl.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:0.82rem">該当なし</div>';
    resultsEl.classList.add('show');
    return;
  }
  matches.forEach(m => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.innerHTML = `<span class="mon-no">No.${m.no}</span><span class="mon-name">${m.name}</span>`;
    item.addEventListener('click', () => selectBaseMonster(slotIdx, m));
    resultsEl.appendChild(item);
  });
  resultsEl.classList.add('show');
}

function selectBaseMonster(slotIdx, monster) {
  baseMonsters[slotIdx] = monster;
  const info = document.getElementById(`base-info-${slotIdx}`);
  const results = document.getElementById(`base-results-${slotIdx}`);
  const input = document.getElementById(`base-search-${slotIdx}`);
  results.classList.remove('show');
  input.value = `No.${monster.no} ${monster.name}`;

  const attrs = (monster.attributes || []).filter(a => a != null && a > 0);
  const types = (monster.types || []).filter(t => t > 0);
  const awakens = getActiveAwakens(monster);

  info.innerHTML = `
    <span class="mon-id">No.${monster.no}</span>
    <span class="mon-name-display">${monster.name}</span>
    <div class="mon-attrs">${attrs.map(a => `<img src="${attrIcon(a)}" title="${attrName(a)}">`).join('')}</div>
    <div class="mon-types">${types.map(t => `<img src="${typeIcon(t)}" title="${typeName(t)}">`).join('')}</div>
    <div class="mon-awakens">${awakens.map(a => `<img src="${awakenIcon(a)}" title="${awakenName(a)}">`).join('')}</div>
    <div class="mon-skill" style="font-size:0.8rem; margin-top:4px; color:var(--text-muted);">
      ${(function () {
      const s = getSkillInfo(monster);
      return s ? `スキル：${s.name} (CT: ${s.baseTurn}→${s.minTurn})` : '';
    })()}
    </div>
  `;
  info.classList.add('show');

  // タブのラベル更新（No.＋フル名前）
  const tab = document.querySelector(`#base-slot-tabs .slot-tab[data-slot="${slotIdx}"]`);
  if (tab) {
    tab.innerHTML = `<span class="tab-no">No.${monster.no}</span><span class="tab-name">${monster.name}</span>`;
  }
}

// ==================== STEP 1: 条件スロット ====================

function initCondSlots() {
  const container = document.getElementById('cond-slot-contents');
  container.innerHTML = '';

  // 全有効覚醒IDを取得
  const allAwakenIds = getValidAwakenIds();

  for (let i = 0; i < 6; i++) {
    const div = document.createElement('div');
    div.className = `slot-content ${i === 0 ? 'active' : ''}`;
    div.id = `cond-slot-${i}`;

    const attrIcons = [1, 2, 3, 4, 5].map(id =>
      `<div class="icon-btn" data-type="attr" data-id="${id}" data-slot="${i}" title="${attrName(id)}"><img src="${attrIcon(id)}"></div>`
    ).join('');

    const typeIds = Object.keys(typeNames).map(Number).sort((a, b) => a - b);
    const typeIcons = typeIds.map(id =>
      `<div class="icon-btn" data-type="type" data-id="${id}" data-slot="${i}" title="${typeName(id)}"><img src="${typeIcon(id)}"></div>`
    ).join('');

    // 全覚醒を表示
    const awakenIcons = allAwakenIds.map(id =>
      `<div class="icon-btn" data-type="reqawaken" data-id="${id}" data-slot="${i}" title="${awakenName(id)}"><img src="${awakenIcon(id)}"></div>`
    ).join('');

    div.innerHTML = `
      <div class="base-summary-panel" id="cond-base-info-${i}" style="display:none"></div>
      <details>
        <summary class="field-label" style="cursor:pointer; outline:none;">🎨 属性条件（1つ選択、再クリックで解除）</summary>
        <div class="icon-grid cond-attr-grid" data-slot="${i}">${attrIcons}</div>
      </details>
      <details style="margin-top:8px">
        <summary class="field-label" style="cursor:pointer; outline:none;">🏷️ タイプ条件（1つ選択、再クリックで解除）</summary>
        <div class="icon-grid cond-type-grid" data-slot="${i}">${typeIcons}</div>
      </details>
      <div class="field-label" style="margin-top:8px">✨ 必須覚醒（タップで追加、右クリックで減少）</div>
      <div class="icon-grid cond-awaken-grid" data-slot="${i}">${awakenIcons}</div>
      <div class="field-label" style="margin-top:8px">選択中の必須覚醒：</div>
      <div class="selected-conditions" id="cond-selected-${i}">
        <span style="color:var(--text-muted);font-size:0.8rem">なし</span>
      </div>
      <div class="field-label" style="margin-top:12px">🔍 スキル内容キーワード条件（任意・複数語句はスペース区切り）</div>
      <input type="text" class="keyword-input" data-slot="${i}" placeholder="例：覚醒無効　ダメージ吸収" 
             style="width:100%; padding:8px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-card); color:var(--text-main); font-size:0.85rem;">
      <p style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">※ヘイスト、遅延必要数は後ほど入力するため、原則ここには記入不要です。</p>
      <div class="toggle-row" style="margin-top:12px">
        <span class="toggle-label">⚡ アシストスキル使用可否（変身キャラ等はOFF推奨）</span>
        <label class="toggle-switch">
          <input type="checkbox" class="skill-usable-toggle" data-slot="${i}" checked>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="toggle-row">
        <span class="toggle-label">🔗 アシスト共鳴条件（ベース指定時のみ有効）</span>
        <label class="toggle-switch">
          <input type="checkbox" class="resonance-toggle" data-slot="${i}">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="toggle-row">
        <span class="toggle-label">🔥 火力優先（DPS覚醒の評価大幅アップ）</span>
        <label class="toggle-switch">
          <input type="checkbox" class="dps-priority-toggle" data-slot="${i}">
          <span class="toggle-slider-fire"></span>
        </label>
      </div>
      <div class="slot-tabs-bottom" id="cond-slot-tabs-bottom-${i}">
        ${[0, 1, 2, 3, 4, 5].map(j => `<div class="slot-tab slot-tab-sm ${j === i ? 'active' : ''}" data-slot="${j}" data-from-bottom="1">スロット${j + 1}</div>`).join('')}
      </div>
    `;
    container.appendChild(div);
  }

  // タブ切替（上部・下部共通）
  function switchCondSlot(slot) {
    document.querySelectorAll('#cond-slot-tabs .slot-tab').forEach(t => {
      t.classList.toggle('active', parseInt(t.dataset.slot) === slot);
    });
    document.querySelectorAll('#cond-slot-contents .slot-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`cond-slot-${slot}`).classList.add('active');
    // 下部タブも更新
    for (let k = 0; k < 6; k++) {
      document.querySelectorAll(`#cond-slot-tabs-bottom-${k} .slot-tab-sm`).forEach(t => {
        t.classList.toggle('active', parseInt(t.dataset.slot) === slot);
      });
    }
  }
  document.querySelectorAll('#cond-slot-tabs .slot-tab').forEach(tab => {
    tab.addEventListener('click', () => switchCondSlot(parseInt(tab.dataset.slot)));
  });
  container.addEventListener('click', e => {
    const bt = e.target.closest('.slot-tab-sm');
    if (bt) switchCondSlot(parseInt(bt.dataset.slot));
  });

  // 属性/タイプ（単一選択）
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-btn[data-type="attr"], .icon-btn[data-type="type"]');
    if (!btn) return;
    const type = btn.dataset.type;
    const id = parseInt(btn.dataset.id);
    const slot = parseInt(btn.dataset.slot);
    if (type === 'attr') {
      const grid = btn.closest('.cond-attr-grid');
      const was = btn.classList.contains('selected');
      grid.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('selected'));
      if (!was) { btn.classList.add('selected'); slotConditions[slot].attrCondition = id; }
      else { slotConditions[slot].attrCondition = null; }
    } else if (type === 'type') {
      const grid = btn.closest('.cond-type-grid');
      const was = btn.classList.contains('selected');
      grid.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('selected'));
      if (!was) { btn.classList.add('selected'); slotConditions[slot].typeCondition = id; }
      else { slotConditions[slot].typeCondition = null; }
    }
  });

  // 必須覚醒クリック（追加）
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-btn[data-type="reqawaken"]');
    if (!btn) return;
    const id = parseInt(btn.dataset.id);
    const slot = parseInt(btn.dataset.slot);
    slotConditions[slot].requiredAwakens.push(id);
    updateCondSelectedDisplay(slot);
  });

  // 右クリック（削除）
  container.addEventListener('contextmenu', (e) => {
    const btn = e.target.closest('.icon-btn[data-type="reqawaken"]');
    if (!btn) return;
    e.preventDefault();
    const id = parseInt(btn.dataset.id);
    const slot = parseInt(btn.dataset.slot);
    const idx = slotConditions[slot].requiredAwakens.lastIndexOf(id);
    if (idx >= 0) slotConditions[slot].requiredAwakens.splice(idx, 1);
    updateCondSelectedDisplay(slot);
  });

  // トグル
  container.addEventListener('change', (e) => {
    if (e.target.classList.contains('skill-usable-toggle'))
      slotConditions[parseInt(e.target.dataset.slot)].skillUsable = e.target.checked;
    if (e.target.classList.contains('resonance-toggle'))
      slotConditions[parseInt(e.target.dataset.slot)].resonance = e.target.checked;
    if (e.target.classList.contains('dps-priority-toggle'))
      slotConditions[parseInt(e.target.dataset.slot)].dpsPriority = e.target.checked;
  });

  // キーワード入力
  container.addEventListener('input', (e) => {
    if (e.target.classList.contains('keyword-input')) {
      slotConditions[parseInt(e.target.dataset.slot)].skillKeyword = e.target.value;
    }
  });
}

function updateCondSelectedDisplay(slot) {
  const display = document.getElementById(`cond-selected-${slot}`);
  const awakens = slotConditions[slot].requiredAwakens;
  if (awakens.length === 0) {
    display.innerHTML = '<span style="color:var(--text-muted);font-size:0.8rem">なし</span>';
    return;
  }
  const counts = {};
  awakens.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
  display.innerHTML = Object.entries(counts).map(([id, cnt]) =>
    `<div class="condition-tag">
      <img src="${awakenIcon(id)}" title="${awakenName(id)}">
      ${cnt > 1 ? `×${cnt}` : awakenName(id)}
      <span class="remove-tag" data-id="${id}" data-slot="${slot}">&times;</span>
    </div>`
  ).join('');
  display.querySelectorAll('.remove-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      const rid = parseInt(btn.dataset.id);
      const sidx = parseInt(btn.dataset.slot);
      const idx = slotConditions[sidx].requiredAwakens.lastIndexOf(rid);
      if (idx >= 0) slotConditions[sidx].requiredAwakens.splice(idx, 1);
      updateCondSelectedDisplay(sidx);
    });
  });
}

// --- STEP1: ベースモンスター情報を各スロットに表示 ---
function updateStep1BaseInfo() {
  for (let i = 0; i < 6; i++) {
    const panel = document.getElementById(`cond-base-info-${i}`);
    const base = baseMonsters[i];
    if (base) {
      const awakens = getActiveAwakens(base);
      const attrs = (base.attributes || []).filter(a => a != null && a > 0);
      const types = (base.types || []).filter(t => t > 0);
      panel.innerHTML = `
        <div class="summary-title">📋 ベースモンスター</div>
        <div class="base-summary-row">
          <span class="bs-label">No.${base.no}</span>
          <span class="bs-name">${base.name}</span>
          <span style="font-size:0.75rem; color:var(--text-muted); margin-left:8px;">
            ${(function () {
          const s = getSkillInfo(base);
          return s ? `(CT: ${s.baseTurn}→${s.minTurn})` : '';
        })()}
          </span>
          ${attrs.map(a => `<img src="${attrIcon(a)}" style="width:18px;height:18px" title="${attrName(a)}">`).join('')}
          ${types.map(t => `<img src="${typeIcon(t)}" style="width:18px;height:18px" title="${typeName(t)}">`).join('')}
        </div>
        <div class="base-summary-row">
          <span class="bs-label">覚醒</span>
          <div class="bs-awakens">${awakens.map(a => `<img src="${awakenIcon(a)}" title="${awakenName(a)}">`).join('')}</div>
        </div>
      `;
      panel.style.display = 'block';
    } else {
      panel.innerHTML = '';
      panel.style.display = 'none';
    }
  }
}

// ==================== STEP 2: 火力覚醒グリッド ====================

function initDpsAwakensGrid() {
  const grid = document.getElementById('dps-awakens-grid');
  grid.innerHTML = '';

  // デフォルトで選択済みにするID（7強・10強・浮遊）
  const DEFAULT_SELECTED = new Set([43, 61, 106]);

  // ベース版のみ表示
  DPS_BASE_IDS.filter(id => awakenNames[id] && !DASH_NAMES.has(awakenNames[id])).forEach(id => {
    const btn = document.createElement('div');
    btn.className = 'icon-btn';
    btn.title = awakenName(id);
    btn.dataset.dpsId = id;
    btn.innerHTML = `<img src="${awakenIcon(id)}">`;
    btn.addEventListener('click', () => {
      const plusId = DPS_AWAKEN_PAIRS[id];
      if (selectedDpsAwakens.has(id)) {
        selectedDpsAwakens.delete(id);
        if (plusId) selectedDpsAwakens.delete(plusId);
        btn.classList.remove('selected');
      } else {
        selectedDpsAwakens.add(id);
        if (plusId) selectedDpsAwakens.add(plusId);
        btn.classList.add('selected');
      }
      updateDpsSelectedDisplay();
    });
    grid.appendChild(btn);

    // デフォルト選択
    if (DEFAULT_SELECTED.has(id)) {
      const plusId = DPS_AWAKEN_PAIRS[id];
      selectedDpsAwakens.add(id);
      if (plusId) selectedDpsAwakens.add(plusId);
      btn.classList.add('selected');
    }
  });
  updateDpsSelectedDisplay();
}

function updateDpsSelectedDisplay() {
  const display = document.getElementById('selected-dps-awakens');
  if (selectedDpsAwakens.size === 0) {
    display.innerHTML = '<span style="color:var(--text-muted);font-size:0.8rem">まだ選択されていません</span>';
    return;
  }
  // ベース版のみ表示（＋版は「含む」と表記）
  const items = [];
  for (const id of selectedDpsAwakens) {
    const plusId = DPS_AWAKEN_PAIRS[id];
    if (plusId && selectedDpsAwakens.has(plusId)) {
      // ベース版の場合のみ表示
      items.push(`<div class="condition-tag clickable-tag" data-id="${id}" style="cursor:pointer" title="クリックで解除"><img src="${awakenIcon(id)}">${awakenName(id)} <span style="color:var(--text-muted)">(+含む)</span></div>`);
    } else if (!Object.values(DPS_AWAKEN_PAIRS).includes(id)) {
      // ＋版でないもの（ペアを持たないもの）のみ表示
      items.push(`<div class="condition-tag clickable-tag" data-id="${id}" style="cursor:pointer" title="クリックで解除"><img src="${awakenIcon(id)}">${awakenName(id)}</div>`);
    }
  }
  display.innerHTML = items.join('');

  // 選択解除のクリックイベント追加
  display.querySelectorAll('.clickable-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const id = parseInt(tag.dataset.id);
      const plusId = DPS_AWAKEN_PAIRS[id];
      selectedDpsAwakens.delete(id);
      if (plusId) selectedDpsAwakens.delete(plusId);

      // グリッドの選択状態も更新
      const gridBtn = document.querySelector(`#dps-awakens-grid .icon-btn[data-dps-id="${id}"]`);
      if (gridBtn) gridBtn.classList.remove('selected');

      updateDpsSelectedDisplay();
    });
  });
}

// --- STEP2: 前ステップの条件サマリー表示 ---
function updateStep2Summary() {
  const el = document.getElementById('step2-prev-summary');
  let html = '<div class="prev-conditions-panel"><div class="summary-title" style="font-size:0.8rem;color:var(--accent-gold);font-weight:700;margin-bottom:6px">📋 指定済み条件</div>';

  for (let i = 0; i < 6; i++) {
    const base = baseMonsters[i];
    const cond = slotConditions[i];
    let parts = [];

    if (base) parts.push(`<strong>${base.name}</strong>`);
    else parts.push('<span style="color:var(--text-muted)">ベース未指定</span>');

    if (cond.attrCondition) parts.push(`<img src="${attrIcon(cond.attrCondition)}" title="${attrName(cond.attrCondition)}">`);
    if (cond.typeCondition) parts.push(`<img src="${typeIcon(cond.typeCondition)}" title="${typeName(cond.typeCondition)}">`);
    if (cond.requiredAwakens.length > 0) {
      const counts = {};
      cond.requiredAwakens.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
      for (const [id, cnt] of Object.entries(counts)) {
        parts.push(`<img src="${awakenIcon(id)}" title="${awakenName(id)}">${cnt > 1 ? `×${cnt}` : ''}`);
      }
    }
    if (!cond.skillUsable) parts.push('<span style="color:var(--accent-red)">スキル不使用</span>');

    html += `<div class="prev-cond-row"><span class="prev-cond-label">スロット${i + 1}:</span>${parts.join(' ')}</div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

// ==================== STEP 3: パーティ覚醒グリッド（全覚醒表示） ====================

function initPartyAwakensGrid() {
  const grid = document.getElementById('party-awakens-grid');
  grid.innerHTML = '';

  // SB系覚醒(21/56/105)を除外（下部の数値入力で管理するため）
  const allIds = getValidAwakenIds().filter(id => !PARTY_HIDDEN_AWAKEN_IDS.has(id));

  allIds.forEach(id => {
    const btn = document.createElement('div');
    btn.className = 'icon-btn';
    btn.title = awakenName(id);
    btn.dataset.id = id;
    btn.innerHTML = `<img src="${awakenIcon(id)}">`;

    btn.addEventListener('click', () => {
      partyRequiredAwakens[id] = (partyRequiredAwakens[id] || 0) + 1;
      updatePartyBadge(btn, id);
      updatePartyRequiredDisplay();
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (partyRequiredAwakens[id] > 0) {
        partyRequiredAwakens[id]--;
        if (partyRequiredAwakens[id] === 0) delete partyRequiredAwakens[id];
        updatePartyBadge(btn, id);
        updatePartyRequiredDisplay();
      }
    });
    grid.appendChild(btn);
  });

  document.getElementById('required-sb').addEventListener('change', (e) => { requiredSB = parseInt(e.target.value) || 0; });
  document.getElementById('delay-as-sb').addEventListener('change', (e) => { delayAsSB = e.target.checked; });
}

function updatePartyBadge(btn, id) {
  const ex = btn.querySelector('.count-badge');
  if (ex) ex.remove();
  const count = partyRequiredAwakens[id] || 0;
  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'count-badge';
    badge.textContent = count;
    btn.appendChild(badge);
    btn.classList.add('selected');
  } else {
    btn.classList.remove('selected');
  }
}

function updatePartyRequiredDisplay() {
  const display = document.getElementById('party-required-display');
  const entries = Object.entries(partyRequiredAwakens).filter(([, c]) => c > 0);
  if (entries.length === 0) {
    display.innerHTML = '<span style="color:var(--text-muted);font-size:0.8rem">まだ指定されていません</span>';
    return;
  }
  display.innerHTML = entries.map(([id, cnt]) =>
    `<div class="condition-tag clickable-tag" data-id="${id}" style="cursor:pointer" title="クリックで1つ減らす"><img src="${awakenIcon(id)}" title="${awakenName(id)}">${awakenName(id)} ×${cnt}</div>`
  ).join('');

  // 選択解除のクリックイベント追加
  display.querySelectorAll('.clickable-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const id = parseInt(tag.dataset.id);
      if (partyRequiredAwakens[id] > 0) {
        partyRequiredAwakens[id]--;
        if (partyRequiredAwakens[id] === 0) delete partyRequiredAwakens[id];

        // グリッドのバッジ更新
        const gridBtn = document.querySelector(`#party-awakens-grid .icon-btn[data-id="${id}"]`);
        if (gridBtn) updatePartyBadge(gridBtn, id);

        updatePartyRequiredDisplay();
      }
    });
  });
}

// ==================== 最適化エンジン ====================

function stopOptimization() {
  stopRequested = true;
  const st = document.getElementById('progress-status');
  if (st) st.textContent = '計算を停止中...';
}

function showProgressUI() {
  const rc = document.getElementById('result-container');
  const desc = document.getElementById('result-desc');
  const ps = document.getElementById('calc-progress-section');
  const st = document.getElementById('progress-status');
  const bar = document.getElementById('progress-bar-inner');
  if (rc) rc.innerHTML = '';
  if (desc) desc.textContent = '';
  if (ps) ps.style.display = 'block';
  if (st) st.textContent = '計算を開始しています...';
  if (bar) { bar.style.width = '0%'; }
}

function hideProgressUI() {
  const ps = document.getElementById('calc-progress-section');
  if (ps) ps.style.display = 'none';
}

async function runOptimization() {
  goToStep(4);
  stopRequested = false;
  dfsIterCount = 0;
  showProgressUI();

  // リアルタイム表示用にresult-containerをクリア
  const rc = document.getElementById('result-container');
  if (rc) rc.innerHTML = '';
  const desc = document.getElementById('result-desc');
  if (desc) desc.textContent = '';

  // 少し待ってからUIが更新されるのを確認
  await new Promise(r => setTimeout(r, 30));

  try {
    const results = await optimize();
    hideProgressUI();
    displayResults(results);
  } catch (err) {
    hideProgressUI();
    console.error('Optimization error:', err);
    const rc2 = document.getElementById('result-container');
    if (rc2) {
      rc2.innerHTML = `<div class="empty-state"><div class="emoji-lg">⚠️</div><p>${err.message}</p></div>`;
    }
  }
}

async function optimize() {
  const slotCandidates = [];

  // 0. 固定スロット数に応じて候補上限を動的に設定
  const pinnedCount = Object.keys(pinnedAssists).length;
  const unpinnedCount = 6 - pinnedCount;
  let candidateLimit;
  if (unpinnedCount <= 1) candidateLimit = 200;
  else if (unpinnedCount <= 2) candidateLimit = 150;
  else if (unpinnedCount <= 3) candidateLimit = 100;
  else if (unpinnedCount <= 4) candidateLimit = 80;
  else candidateLimit = 60;

  // 1. ベースモンスターによる初期状態の集計
  // ★ SB計算はアシストのみで判定するため initialSB = 0
  const initialAwakens = {};
  let initialSB = 0; // アシストのみでSBを集計するので0から開始
  baseMonsters.forEach(b => {
    if (!b) return;
    // ベースの覚醒はinitialAwakensに含める（覚醒条件判定用）
    const aw = getBaseAwakensContribution(b);
    aw.forEach(id => {
      if (id === 0 || id === 49) return;
      initialAwakens[id] = (initialAwakens[id] || 0) + 1;
    });
  });

  // 1.5. 固定スロットのSB貢献を事前計算し、残りのSB不足を算出
  let pinnedSB = 0;
  const pinnedAwakens = {};
  for (const [slotIdx, monster] of Object.entries(pinnedAssists)) {
    pinnedSB += getMonsterSB(monster);
    const idx = parseInt(slotIdx);
    if (slotConditions[idx].skillUsable) {
      pinnedSB += getHasteTurns(monster);
      if (delayAsSB) pinnedSB += getDelayTurns(monster);
    }
    // 固定アシストの覚醒を集計（充足度判定用）
    getActiveAwakens(monster).forEach(id => {
      pinnedAwakens[id] = (pinnedAwakens[id] || 0) + 1;
    });
  }
  const remainingSBNeeded = Math.max(0, requiredSB - pinnedSB);

  // 2. パーティの要求覚醒に基づき、候補全体での「希少性」を算出
  const awakenScarcity = calculateAwakenScarcity();

  // SB枠サイズ: SB不足が大きいほど多くのSB候補を確保
  const sbSlotSize = remainingSBNeeded > 10 ? 20 : (remainingSBNeeded > 5 ? 15 : 10);

  for (let i = 0; i < 6; i++) {
    const raw = filterCandidatesForSlot(i);
    if (raw.length === 0) {
      const base = baseMonsters[i];
      throw new Error(`スロット${i + 1}${base ? `(${base.name})` : ''}に条件を満たすアシストがありません。条件を緩めてください。`);
    }

    // 固定スロットが多い場合（未固定3スロット以下）: 候補制限なしの全数探索
    if (unpinnedCount <= 3) {
      slotCandidates.push(raw);
    } else {
      // 通常モード: スコアリングで候補を絞り込み
      raw.forEach(m => { m._score = scoreMonsterWithScarcity(m, i, awakenScarcity, pinnedAwakens, remainingSBNeeded); });

      const selectedMap = new Map();

      raw.sort((a, b) => b._score - a._score);
      raw.slice(0, 20).forEach(m => selectedMap.set(m.no, m));

      const sbSorted = [...raw].sort((a, b) => {
        const sba = getMonsterSB(a) + (slotConditions[i].skillUsable ? getHasteTurns(a) : 0);
        const sbb = getMonsterSB(b) + (slotConditions[i].skillUsable ? getHasteTurns(b) : 0);
        return sbb - sba || b._score - a._score;
      });
      sbSorted.slice(0, sbSlotSize).forEach(m => selectedMap.set(m.no, m));

      // SB閾値候補: 残りSB不足に貢献できるモンスターを無条件で追加
      if (remainingSBNeeded > 0 && !pinnedAssists[i]) {
        const sbThreshold = Math.max(2, Math.ceil(remainingSBNeeded / Math.max(1, unpinnedCount)));
        raw.filter(m => {
          const sb = getMonsterSB(m) + (slotConditions[i].skillUsable ? getHasteTurns(m) : 0);
          return sb >= sbThreshold;
        }).forEach(m => selectedMap.set(m.no, m));
      }

      const hpSorted = [...raw].sort((a, b) => {
        const hpa = getActiveAwakens(a).filter(aw => aw === 46).length;
        const hpb = getActiveAwakens(b).filter(aw => aw === 46).length;
        return hpb - hpa || b._score - a._score;
      });
      hpSorted.slice(0, 5).forEach(m => selectedMap.set(m.no, m));

      // 未充足の要求覚醒のみ専門家枠を確保
      for (const id of Object.keys(partyRequiredAwakens)) {
        const aid = parseInt(id);
        const fulfilled = pinnedAwakens[aid] || 0;
        const target = partyRequiredAwakens[aid];
        if (fulfilled >= target) continue; // 既に固定アシストで充足済み → スキップ
        const specialists = raw
          .filter(m => getActiveAwakens(m).includes(aid))
          .sort((a, b) => {
            const ca = getActiveAwakens(a).filter(aw => aw === aid).length;
            const cb = getActiveAwakens(b).filter(aw => aw === aid).length;
            return cb - ca || b._score - a._score;
          })
          .slice(0, 2);
        specialists.forEach(m => selectedMap.set(m.no, m));
      }

      let finalRaw = Array.from(selectedMap.values());
      finalRaw.sort((a, b) => b._score - a._score);
      slotCandidates.push(finalRaw.slice(0, candidateLimit));
    }
  }

  const searchOrder = [0, 1, 2, 3, 4, 5].sort((a, b) => slotCandidates[a].length - slotCandidates[b].length);

  // 全組み合わせ数を算出（進捗計算用）
  let totalCombinations = 1;
  for (let i = 0; i < 6; i++) totalCombinations *= slotCandidates[i].length;

  const results = await runDFS(slotCandidates, searchOrder, initialAwakens, initialSB, totalCombinations);

  if (results.length === 0)
    throw new Error('条件を満たす組み合わせが見つかりませんでした。条件を緩和するか、必須とする覚醒を見直してください。');

  return results;
}

/**
 * 要求覚醒の「希少性」を候補モンスター全体から算出
 */
function calculateAwakenScarcity() {
  const scarcity = {};
  const totalPool = assistMonsters.length;
  for (const id of Object.keys(partyRequiredAwakens)) {
    const aid = parseInt(id);
    const count = assistMonsters.filter(m => getActiveAwakens(m).includes(aid)).length;
    // 少ないほど1に近い重み (0.1 ~ 1.0)
    scarcity[aid] = Math.max(0.1, 1 - (count / totalPool));
  }
  return scarcity;
}

// 「上限あり」覚醒ID（耐性・ドロ強等: 充足後は無駄）
const CAPPED_AWAKEN_IDS = new Set([
  11, 12, 13, 68, 69, 70,         // 暗闇/お邪魔/毒耐性 及び +版
  54, 55,                          // 雲/操作不可耐性
  28,                              // 封印耐性
  14, 15,                          // スキルバインド/覚醒無効回復
  99, 100, 101, 102, 103, 104,     // ドロップ強化+（火/水/木/光/闇/回復）
  19, 16, 17, 29, 30, 18,         // ドロップ強化（通常版）
  62,                              // スキル遅延耐性
  63,                              // 防御貫通
]);

/**
 * 固定アシストの充足度と覚醒タイプ別分類を加味したスコアリング
 * @param {Object} fulfilledAwakens - 固定アシストが既に提供している覚醒カウント
 * @param {number} remainingSBNeeded - 固定スロットのSBを差し引いた残りの必要SB
 */
function scoreMonsterWithScarcity(monster, slotIdx, scarcityMap, fulfilledAwakens, remainingSBNeeded) {
  let score = 0;
  const active = getActiveAwakens(monster);
  const cond = slotConditions[slotIdx];
  const base = baseMonsters[slotIdx];

  // パーティ必要覚醒の充足（固定アシストで既に満たした分を差し引いて判定）
  for (const [id, target] of Object.entries(partyRequiredAwakens)) {
    const aid = parseInt(id);
    const countInMonster = active.filter(a => a === aid).length;
    const have = fulfilledAwakens[aid] || 0;
    const needed = Math.max(0, target - have);

    // 不足している覚醒にのみ高得点
    score += Math.min(countInMonster, needed) * 1000;

    // 「上限なし」覚醒（火力・HP・回復等）: 充足後も追加が有利
    if (!CAPPED_AWAKEN_IDS.has(aid) && countInMonster > needed) {
      score += (countInMonster - needed) * 100; // 充足超過分も加点（控えめ）
    }

    // 希少性ボーナス（不足している場合のみ）
    if (needed > 0 && countInMonster > 0 && scarcityMap[aid]) {
      score += scarcityMap[aid] * 500;
    }
  }

  // 火力覚醒評価（火力優先フラグ時に大幅加点）
  const dpsWeight = cond.dpsPriority ? 80 : 5;
  for (const a of active) {
    if (selectedDpsAwakens.has(a)) score += dpsWeight;
    if (a === 106 && !baseHasLevitation(base)) {
      score += cond.dpsPriority ? 400 : 80;
    }
  }

  // チームHP / チーム回復（常に有利なので無条件加点）
  score += active.filter(a => a === 46).length * 40;
  score += active.filter(a => a === 47).length * 25;

  // SB（残SB不足に応じて重み付けを動的に増加）
  const sbNeeded = remainingSBNeeded || 0;
  const sbWeight = sbNeeded > 0 ? Math.max(50, sbNeeded * 50) : (requiredSB > 0 ? Math.max(50, requiredSB * 20) : 50);
  const monsterSB = getMonsterSB(monster);
  score += monsterSB * sbWeight;
  if (sbNeeded > 0 && monsterSB >= 2) {
    score += monsterSB * 300;
  }
  if (cond.skillUsable) {
    const hasteSB = getHasteTurns(monster);
    const delaySB = getDelayTurns(monster);
    score += hasteSB * (sbNeeded > 0 ? 100 : 30);
    score += delaySB * (sbNeeded > 0 ? 80 : 20);
  }

  return score;
}

/**
 * 枝刈り付き深さ優先探索 (DFS) - 非同期版
 * @param {Array} slotCandidates - 各スロットの候補モンスターリスト
 * @param {Array} searchOrder - 探索順序
 * @param {Object} initialAwakens - ベースモンスターから得られる初期覚醒カウント
 * @param {number} initialSB - 初期SB（アシストのみなので0）
 * @param {number} totalCombinations - 全組み合わせ数（進捗計算用）
 */
async function runDFS(slotCandidates, searchOrder, initialAwakens, initialSB, totalCombinations) {
  let bestSolutions = [];
  let fullMatchSolutions = []; // 完全一致の解をリアルタイム表示用に別管理
  const MAX_RESULTS = 5;
  dfsIterCount = 0;
  const YIELD_INTERVAL = 3000; // N反復ごとにUIに制御を返す

  // 枝刈り用の残り「探索ステップ」での最大提供可能量
  const maxRemains = Array.from({ length: 7 }, () => ({ awakens: {}, sb: 0 }));
  for (let d = 5; d >= 0; d--) {
    const slotIdx = searchOrder[d];
    const prev = maxRemains[d + 1];
    const current = { awakens: { ...prev.awakens }, sb: prev.sb };
    let maxSlotSB = 0;
    const slotAwakensMax = {};
    slotCandidates[slotIdx].forEach(m => {
      const sb = getMonsterSB(m) + (slotConditions[slotIdx].skillUsable ? getHasteTurns(m) + (delayAsSB ? getDelayTurns(m) : 0) : 0);
      if (sb > maxSlotSB) maxSlotSB = sb;
      const act = getActiveAwakens(m);
      const counts = {};
      act.forEach(a => counts[a] = (counts[a] || 0) + 1);
      for (const [aid, c] of Object.entries(counts)) {
        if (!slotAwakensMax[aid] || c > slotAwakensMax[aid]) slotAwakensMax[aid] = c;
      }
    });
    current.sb += maxSlotSB;
    for (const [aid, c] of Object.entries(slotAwakensMax)) {
      current.awakens[aid] = (current.awakens[aid] || 0) + c;
    }
    maxRemains[d] = current;
  }

  // リアルタイム表示用: 完全一致結果を即座にUIに追加
  function addRealtimeResult(solution) {
    const rc = document.getElementById('result-container');
    const st = document.getElementById('progress-status');
    if (st) st.textContent = `計算中... 完全一致 ${fullMatchSolutions.length}件 発見`;
    if (!rc) return;
    const card = buildResultCard(solution, fullMatchSolutions.length - 1, true);
    rc.appendChild(card);
  }

  // 非同期 solve
  // currentAwakens: ベース+アシスト覚醒（スコアリング用）
  // currentAssistAwakens: アシストのみの覚醒（充足判定・表示用）
  async function solve(depth, currentPicks, currentAwakens, currentAssistAwakens, currentSB, currentScore) {
    if (stopRequested) return;

    if (depth === 6) {
      dfsIterCount++;

      // UI更新タイミング
      if (dfsIterCount % YIELD_INTERVAL === 0) {
        const progress = Math.min(99, (dfsIterCount / totalCombinations) * 100);
        const bar = document.getElementById('progress-bar-inner');
        const st = document.getElementById('progress-status');
        if (bar) bar.style.width = `${progress.toFixed(1)}%`;
        if (st) st.textContent = `計算中... ${progress.toFixed(1)}% (完全一致 ${fullMatchSolutions.length}件)`;
        await new Promise(r => setTimeout(r, 0));
      }

      if (!checkRequirementsMet(currentAssistAwakens, currentSB)) return;

      const solution = {
        picks: Array.from({ length: 6 }),
        awakenCounts: { ...currentAwakens },
        assistAwakenCounts: { ...currentAssistAwakens },
        score: currentScore,
        sbTotal: currentSB
      };
      currentPicks.forEach(p => {
        solution.picks[p.slotIdx] = p.monster;
      });

      bestSolutions.push(solution);
      bestSolutions.sort((a, b) => b.score - a.score);
      if (bestSolutions.length > MAX_RESULTS) bestSolutions.pop();

      // 完全一致ならリアルタイム表示
      if (isFullyMetDirect(solution)) {
        fullMatchSolutions.push(solution);
        addRealtimeResult(solution);
        // 完全一致30件以上で自動停止
        if (fullMatchSolutions.length >= 30) {
          stopRequested = true;
          const st2 = document.getElementById('progress-status');
          if (st2) st2.textContent = `候補が多数見つかりました（${fullMatchSolutions.length}件）。計算を停止します。条件を絞り込んでください。`;
        }
      }
      return;
    }

    // 枝刈り
    if (!canPotentiallyMeetRequirements(depth, currentAwakens, currentSB, maxRemains)) return;

    const slotIdx = searchOrder[depth];
    const usedNos = new Set(currentPicks.map(p => p.monster.no));
    for (const m of slotCandidates[slotIdx]) {
      if (stopRequested) return;
      if (usedNos.has(m.no)) continue;

      // 深さ浅い部分で定期的にUIに制御を返す
      if (depth <= 1) {
        dfsIterCount++;
        if (dfsIterCount % YIELD_INTERVAL === 0) {
          const progress = Math.min(99, (dfsIterCount / totalCombinations) * 100);
          const bar = document.getElementById('progress-bar-inner');
          const st = document.getElementById('progress-status');
          if (bar) bar.style.width = `${progress.toFixed(1)}%`;
          if (st) st.textContent = `計算中... ${progress.toFixed(1)}% (完全一致 ${fullMatchSolutions.length}件)`;
          await new Promise(r => setTimeout(r, 0));
        }
      }

      const nextAwakens = { ...currentAwakens };
      const nextAssistAwakens = { ...currentAssistAwakens };
      const active = getActiveAwakens(m);
      let monsterScore = 0;

      const awakenCounts = {};
      active.forEach(a => { awakenCounts[a] = (awakenCounts[a] || 0) + 1; });

      for (const [aStr, count] of Object.entries(awakenCounts)) {
        const a = parseInt(aStr);
        const cap = getAwakenCap(a);
        const currentCount = currentAwakens[a] || 0;
        const addCount = Math.min(count, Math.max(0, cap - currentCount));
        nextAwakens[a] = currentCount + addCount;
        // アシスト専用カウントも更新
        nextAssistAwakens[a] = (currentAssistAwakens[a] || 0) + count;
        const overCount = count - addCount;

        for (let k = 0; k < addCount; k++) {
          const levelAfterAdd = currentCount + k + 1;
          if (partyRequiredAwakens[a] && levelAfterAdd <= partyRequiredAwakens[a]) {
            monsterScore += 2000;
          }
          if (selectedDpsAwakens.has(a)) {
            monsterScore += slotConditions[slotIdx].dpsPriority ? 200 : 20;
          }
          if (a === 106 && !baseHasLevitation(baseMonsters[slotIdx])) {
            monsterScore += slotConditions[slotIdx].dpsPriority ? 500 : 150;
          }
        }
        monsterScore += overCount * 1;
      }

      monsterScore += (awakenCounts[46] || 0) * 20;
      monsterScore += getMonsterSB(m) * 50;
      let nextSB = currentSB + getMonsterSB(m);
      if (slotConditions[slotIdx].skillUsable) {
        nextSB += getHasteTurns(m);
        monsterScore += getHasteTurns(m) * 30;
        monsterScore += getDelayTurns(m) * 20;
        if (delayAsSB) {
          nextSB += getDelayTurns(m);
        }
      }

      if (nextSB < requiredSB) {
        monsterScore += (nextSB - currentSB) * 100;
      }

      await solve(depth + 1, [...currentPicks, { slotIdx, monster: m }], nextAwakens, nextAssistAwakens, nextSB, currentScore + monsterScore);
    }
  }

  await solve(0, [], { ...(initialAwakens || {}) }, {}, initialSB || 0, 0);

  // 完了時にプログレスバーを100%に
  const bar = document.getElementById('progress-bar-inner');
  if (bar) bar.style.width = '100%';
  const st = document.getElementById('progress-status');
  if (st) st.textContent = stopRequested ? `計算を停止しました (完全一致 ${fullMatchSolutions.length}件)` : `計算完了 (完全一致 ${fullMatchSolutions.length}件)`;

  return bestSolutions;
}

function getAwakenCap(id) {
  // 耐性
  if ([11, 12, 13, 68, 69, 70].includes(id)) return 100; // 実際には内部で+換算が必要だが簡易化
  if ([54, 55].includes(id)) return 1;
  if (id === 28) return 5;
  if (id >= 99 && id <= 104) return 2;
  return 99;
}

function checkRequirementsMet(awakens, sb) {
  for (const [id, target] of Object.entries(partyRequiredAwakens)) {
    // 耐性の特殊換算
    const aid = parseInt(id);
    let have = 0;
    if (aid === 11 || aid === 68) have = (awakens[11] || 0) * 1 + (awakens[68] || 0) * 5;
    else if (aid === 12 || aid === 69) have = (awakens[12] || 0) * 1 + (awakens[69] || 0) * 5;
    else if (aid === 13 || aid === 70) have = (awakens[13] || 0) * 1 + (awakens[70] || 0) * 5;
    else have = awakens[aid] || 0;

    if (have < target) return false;
  }
  // ★修正: 必要SBが指定されている場合は正確にチェック
  // DFS内のsbは既にdelayAsSBを加味したスキブ合計なのでそのまま比較
  if (requiredSB > 0 && sb < requiredSB) return false;
  return true;
}

function canPotentiallyMeetRequirements(slot, currentAwakens, currentSB, maxRemains) {
  const remain = maxRemains[slot];
  for (const [id, target] of Object.entries(partyRequiredAwakens)) {
    const aid = parseInt(id);
    let currentHave = 0;
    let potentialMax = 0;

    if (aid === 11 || aid === 68) {
      currentHave = (currentAwakens[11] || 0) * 1 + (currentAwakens[68] || 0) * 5;
      potentialMax = (remain.awakens[11] || 0) * 1 + (remain.awakens[68] || 0) * 5;
    } else if (aid === 12 || aid === 69) {
      currentHave = (currentAwakens[12] || 0) * 1 + (currentAwakens[69] || 0) * 5;
      potentialMax = (remain.awakens[12] || 0) * 1 + (remain.awakens[69] || 0) * 5;
    } else if (aid === 13 || aid === 70) {
      currentHave = (currentAwakens[13] || 0) * 1 + (currentAwakens[70] || 0) * 5;
      potentialMax = (remain.awakens[13] || 0) * 1 + (remain.awakens[70] || 0) * 5;
    } else {
      currentHave = currentAwakens[aid] || 0;
      potentialMax = remain.awakens[aid] || 0;
    }

    if (currentHave + potentialMax < target) return false;
  }

  // SB枝刈り (DFSにmaxDelayを渡していないので少し甘めに判定)
  if (currentSB + remain.sb + 5 < requiredSB) return false; // 5は最大遅延の猶予

  return true;
}

function filterCandidatesForSlot(slotIdx) {
  const cond = slotConditions[slotIdx];
  const base = baseMonsters[slotIdx];

  // 固定済みのスロットは該当モンスターのみを返す
  if (pinnedAssists[slotIdx]) {
    const pinned = assistMonsters.find(m => m.no === pinnedAssists[slotIdx].no);
    return pinned ? [pinned] : [];
  }

  return assistMonsters.filter(m => {
    if (excludedMonsterNos.has(m.no)) return false;
    const active = getActiveAwakens(m);

    // 必須覚醒チェック
    if (cond.requiredAwakens.length > 0) {
      const req = {};
      cond.requiredAwakens.forEach(id => { req[id] = (req[id] || 0) + 1; });
      for (const [id, cnt] of Object.entries(req)) {
        if (active.filter(a => a === parseInt(id)).length < cnt) return false;
      }
    }

    // 属性条件
    if (cond.attrCondition) {
      const mAttr = (m.attributes || [])[0];
      const sAttr = (m.attributes || [])[1];
      if (mAttr !== cond.attrCondition && sAttr !== cond.attrCondition) return false;
    }

    // タイプ条件
    if (cond.typeCondition) {
      if (!(m.types || []).filter(t => t > 0).includes(cond.typeCondition)) return false;
    }

    // アシスト共鳴
    if (cond.resonance && base && !hasResonance(base, m)) return false;

    // 強制火力設定時: 選択中の火力覚醒を少なくとも1つ持っていること
    if (cond.forcedDps && selectedDpsAwakens.size > 0) {
      if (!active.some(a => selectedDpsAwakens.has(a))) return false;
    }

    // スキルキーワード検索
    if (cond.skillKeyword && cond.skillKeyword.trim() !== "") {
      const keywords = cond.skillKeyword.trim().toLowerCase().split(/[\s　]+/).filter(k => k !== "");
      if (keywords.length > 0) {
        const skill = getSkillInfo(m);
        if (!skill) return false;
        const skillName = (skill.name || "").toLowerCase();
        const skillDesc = (skill.description || "").toLowerCase();
        const fullText = skillName + " " + skillDesc;
        const isMatch = keywords.every(k => fullText.includes(k));
        if (!isMatch) return false;
      }
    }

    return true;
  });
}

function scoreMonster(monster, slotIdx) {
  let score = 0;
  const active = getActiveAwakens(monster);
  const cond = slotConditions[slotIdx];
  const base = baseMonsters[slotIdx];

  // パーティ必要覚醒の充足（充足を最優先するため大幅に強化）
  for (const [id, cnt] of Object.entries(partyRequiredAwakens)) {
    const aid = parseInt(id);
    const countInMonster = active.filter(a => a === aid).length;
    score += Math.min(countInMonster, cnt) * 1000;
  }

  // 火力覚醒評価
  const dpsWeight = cond.dpsPriority ? 40 : 5;
  for (const a of active) {
    if (selectedDpsAwakens.has(a)) score += dpsWeight;
    // 浮遊の特別扱い
    if (a === 106) {
      if (!baseHasLevitation(base)) {
        score += cond.dpsPriority ? 300 : 80; // さらに強力に加点
      }
    }
  }

  // チームHP/回復 (重要なので加点)
  const teamHpCount = active.filter(a => a === 46).length;
  score += teamHpCount * 25; // 15→25
  const teamRcvCount = active.filter(a => a === 47).length;
  score += teamRcvCount * 10; // 5→10

  // SB
  score += getMonsterSB(monster) * 50;

  // ヘイスト/遅延
  if (cond.skillUsable) {
    score += getHasteTurns(monster) * 30;
    score += getDelayTurns(monster) * 20;
  }

  // 変身ペナルティ
  const skill = getSkillInfo(monster);
  if (skill && skill.changeMonsterNo && cond.skillUsable) score -= 30;

  return score;
}

function evaluateState(state) {
  let score = state.score;
  const aw = state.awakenCounts;

  // 耐性キャップ処理 (毒:13, お邪魔:12, 暗闇:11, 雲:54, 操作不可:55, 封印:28, ドロ強)
  // ＋版: 毒+:70, お邪魔+:69, 暗闇+:68
  const checkCap = (baseId, plusId, cap) => {
    let total = (aw[baseId] || 0) * 20 + (aw[plusId] || 0) * 100;
    if (total > cap) {
      // 100%を超えた分のボーナスを減衰（ここでは既にstate.scoreに含まれている分から引くのは難しいので、状態評価値として加点する方式に）
      // ただしbeamSearch内でstate.scoreを都度更新しているため、ここでは「充足ボーナス」を追加で与える
    }
  };

  // 実際には beamSearch 内で state.score を計算する際に「キャップを超えた加点をしない」ようにするのが理想的。
  // ここでは beamSearch を修正する。
  return score;
}

// beamSearch は DFS に置き換えられたため削除

// ==================== 結果表示 ====================

// DFS中のisFullyMet（calcSBBreakdownを使わず、DFS計算値で判定）
// アシストのみの覚醒カウントで充足を判定
function isFullyMetDirect(state) {
  const counts = state.assistAwakenCounts || state.awakenCounts;
  for (const [id, cnt] of Object.entries(partyRequiredAwakens)) {
    if ((counts[parseInt(id)] || 0) < cnt) return false;
  }
  if (requiredSB > 0 && state.sbTotal < requiredSB) return false;
  return true;
}

// 結果カード1枚を生成する関数（リアルタイム表示・最終表示の両方で使用）
function buildResultCard(result, idx, isRealtime) {
  const card = document.createElement('div');
  card.className = `result-pattern ${isRealtime ? 'realtime-result' : ''}`;
  const met = isFullyMet(result);

  let html = `
    <div class="result-header">
      <span class="result-rank">${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`} パターン${idx + 1}</span>
      <span class="result-score ${met ? 'ok' : ''}">${met ? '✅ 条件充足' : '⚠️ 部分充足'}</span>
    </div>
  `;

  html += '<div class="result-assist-list">';
  for (let i = 0; i < 6; i++) {
    const m = result.picks[i];
    const allAw = getAllAwakens(m);
    const attrs = (m.attributes || []).filter(a => a != null && a > 0);
    const types = (m.types || []).filter(t => t > 0);
    const skill = getSkillInfo(m);
    const baseMon = baseMonsters[i];
    const hasDps = allAw.some(a => selectedDpsAwakens.has(a));
    const needsDpsWarning = slotConditions[i].dpsPriority && !hasDps;

    html += `
      <div class="result-assist-card ${needsDpsWarning ? 'dps-warning' : ''}">
        <div class="assist-card-header">
          <span class="assist-slot-label">スロット${i + 1}${baseMon ? ` (${baseMon.name})` : ''}</span>
          <div class="assist-card-actions">
            <button class="btn-pin" data-slot="${i}" data-no="${m.no}" title="このアシストを固定">📌</button>
            <button class="btn-exclude" data-no="${m.no}">❌ 除外</button>
          </div>
        </div>
        ${needsDpsWarning ? `
          <div class="dps-warning-banner">
            <span class="warn-icon">⚠️</span> 火力覚醒が盛れませんでした
            <button class="btn-forced-dps" data-slot="${i}">火力必須で再計算</button>
          </div>
        ` : ''}
        <div class="assist-id-name">
          <span class="assist-id">No.${m.no}</span>
          <span class="assist-name">${m.name}</span>
        </div>
        <div class="assist-meta">
          ${attrs.map(a => `<img src="${attrIcon(a)}" title="${attrName(a)}">`).join('')}
          ${types.map(t => `<img src="${typeIcon(t)}" title="${typeName(t)}">`).join('')}
        </div>
        <div class="assist-awakens">
          ${allAw.map(a => `<img src="${awakenIcon(a)}" title="${awakenName(a)}">`).join('')}
        </div>
        <div class="assist-skill">
          <div class="skill-name-line">${skill ? skill.name : '不明'}<span class="skill-turn">${skill ? ` (CT: ${skill.baseTurn}→${skill.minTurn})` : ''}</span></div>
          <div class="skill-desc">${skill ? skill.description : ''}</div>
        </div>
      </div>
    `;
  }
  html += '</div>';

  // SBブレイクダウン（ベースとアシスト分離表示）
  const sb = calcSBBreakdown(result);
  html += `
    <div class="sb-breakdown">
      <div class="sb-row">ベースSB合計: <span class="sb-val">${sb.baseSBTotal}ターン</span> <span style="color:var(--text-muted);font-size:0.75rem">(参考値)</span></div>
      <div class="sb-row">アシスト覚醒SB: <span class="sb-val">${sb.assistAwakenSB}</span></div>
      <div class="sb-row">アシストSB+: <span class="sb-val">${sb.assistSbPlus}個 (=${sb.assistSbPlus * 2}ターン)</span></div>
      <div class="sb-row">ヘイスト: <span class="sb-val">${sb.haste}ターン</span></div>
      <div class="sb-row">遅延: <span class="sb-val">${sb.maxDelay}ターン ${delayAsSB ? '(加算あり)' : '(加算なし)'}</span></div>
      <div class="sb-total">アシストスキブ合計: ${sb.assistTotal}ターン ${requiredSB > 0 ? (sb.assistTotal >= requiredSB ? '✅' : '❌ 不足') : ''}</div>
    </div>
  `;

  // 覚醒充足表 + 不足覚醒の再計算ボタン
  if (Object.keys(partyRequiredAwakens).length > 0) {
    html += '<div class="summary-box" style="margin-top:8px"><div class="field-label">覚醒充足状況</div>';
    for (const [id, cnt] of Object.entries(partyRequiredAwakens)) {
      const assistCounts = result.assistAwakenCounts || result.awakenCounts;
      const have = assistCounts[parseInt(id)] || 0;
      const ok = have >= cnt;
      html += `<div class="summary-row">
        <span class="summary-label" style="display:flex;align-items:center;gap:4px">
          <img src="${awakenIcon(id)}" style="width:18px;height:18px"> ${awakenName(id)}
        </span>
        <span class="summary-value-group">
          <span class="summary-value ${ok ? 'ok' : 'ng'}">${have}/${cnt} ${ok ? '✅' : '❌'}</span>
          ${!ok ? `<button class="btn-recalc-awaken" data-awaken-id="${id}" data-needed="${cnt - have}">＋必須にして再計算</button>` : ''}
        </span>
      </div>`;
    }
    html += '</div>';
  }

  card.innerHTML = html;
  return card;
}

function displayResults(results) {
  const container = document.getElementById('result-container');
  const desc = document.getElementById('result-desc');
  const recalcBtn = document.getElementById('btn-recalc');
  const baseDisplay = document.getElementById('result-base-display');

  // ベースモンスター表示
  const hasBase = baseMonsters.some(b => b !== null);
  if (hasBase) {
    let baseHtml = '<div class="result-base-row">';
    for (let i = 0; i < 6; i++) {
      const b = baseMonsters[i];
      baseHtml += `<div class="result-base-cell">
        <div class="rbc-label">スロット${i + 1} ベース</div>
        <div class="rbc-name">${b ? `No.${b.no} ${b.name}` : '未指定'}</div>
      </div>`;
    }
    baseHtml += '</div>';
    baseDisplay.innerHTML = baseHtml;
  } else {
    baseDisplay.innerHTML = '';
  }

  if (results.length === 0) {
    if (container) {
      container.innerHTML = '<div class="empty-state"><div class="emoji-lg">😢</div><p>条件を満たす組み合わせが見つかりませんでした</p></div>';
    }
    return;
  }

  // ★修正: 完全一致/部分一致の件数を分けて表示
  const fullMatchCount = results.filter(r => isFullyMet(r)).length;
  const partialMatchCount = results.length - fullMatchCount;
  if (desc) {
    let msg = '';
    if (fullMatchCount > 0) msg += `✅ 完全一致 ${fullMatchCount}件`;
    if (partialMatchCount > 0) msg += `${fullMatchCount > 0 ? ' / ' : ''}⚠️ 部分一致 ${partialMatchCount}件`;
    if (fullMatchCount === 0) msg += '（完全に条件を満たす組み合わせは見つかりませんでした）';
    desc.textContent = msg;
  }

  if (container) container.innerHTML = '';
  if (recalcBtn) recalcBtn.style.display = excludedMonsterNos.size > 0 ? 'inline-flex' : 'none';

  // 固定セクションを更新
  updatePinnedUI();

  results.forEach((result, idx) => {
    const card = buildResultCard(result, idx, false);
    container.appendChild(card);
  });

  // イベント登録
  bindResultEvents(container, recalcBtn);
}

function bindResultEvents(container, recalcBtn) {
  // 除外ボタンイベント
  container.querySelectorAll('.btn-exclude').forEach(btn => {
    btn.addEventListener('click', () => {
      const monster = assistMonsters.find(m => m.no === parseInt(btn.dataset.no));
      if (monster) {
        excludedMonsterNos.add(monster.no);
        updateExclusionUI();
        if (recalcBtn) recalcBtn.style.display = 'inline-flex';
        btn.textContent = '除外済み';
        btn.disabled = true;
        btn.style.opacity = 0.5;
      }
    });
  });

  // 強制火力ボタンイベント
  container.querySelectorAll('.btn-forced-dps').forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = parseInt(btn.dataset.slot);
      slotConditions[slot].forcedDps = true;
      runOptimization();
    });
  });

  // 📌 固定ボタンイベント
  container.querySelectorAll('.btn-pin').forEach(btn => {
    btn.addEventListener('click', () => {
      const slotIdx = parseInt(btn.dataset.slot);
      const monNo = parseInt(btn.dataset.no);
      const monster = assistMonsters.find(m => m.no === monNo);
      if (monster) {
        if (pinnedAssists[slotIdx] && pinnedAssists[slotIdx].no === monNo) {
          // 既に固定済み → 解除
          delete pinnedAssists[slotIdx];
          btn.classList.remove('pinned');
          btn.textContent = '📌';
        } else {
          pinnedAssists[slotIdx] = monster;
          btn.classList.add('pinned');
          btn.textContent = '📌固定中';
        }
        updatePinnedUI();
      }
    });
  });

  // 不足覚醒再計算ボタン
  container.querySelectorAll('.btn-recalc-awaken').forEach(btn => {
    btn.addEventListener('click', () => {
      const aid = parseInt(btn.dataset.awakenId);
      const needed = parseInt(btn.dataset.needed);
      // 必要覚醒を追加/更新
      partyRequiredAwakens[aid] = (partyRequiredAwakens[aid] || 0) + needed;
      updatePartyRequiredDisplay();
      // パーティ覚醒グリッドのバッジも更新
      const gridBtn = document.querySelector(`#party-awakens-grid .icon-btn[data-id="${aid}"]`);
      if (gridBtn) updatePartyBadge(gridBtn, aid);
      runOptimization();
    });
  });

  updateExclusionUI();
}

function updateExclusionUI() {
  const section = document.getElementById('exclusion-manager-section');
  const container = document.getElementById('exclusion-list-container');
  if (!section || !container) return; // 防御的
  if (excludedMonsterNos.size === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  container.innerHTML = '';

  Array.from(excludedMonsterNos).forEach(no => {
    const m = allMonsters.find(mon => mon.no === no);
    if (!m) return;
    const div = document.createElement('div');
    div.className = 'exclusion-item';
    div.innerHTML = `
      <span class="ex-no">No.${m.no}</span>
      <span class="ex-name">${m.name}</span>
      <button class="btn-restore" data-no="${m.no}">↩️ 戻す</button>
    `;
    div.querySelector('.btn-restore').addEventListener('click', () => {
      excludedMonsterNos.delete(no);
      updateExclusionUI();
      runOptimization();
    });
    container.appendChild(div);
  });
}

function clearAllExclusions() {
  excludedMonsterNos.clear();
  updateExclusionUI();
  runOptimization();
}

// ==================== 固定機能 ====================

function updatePinnedUI() {
  const section = document.getElementById('pinned-section');
  const list = document.getElementById('pinned-list');
  if (!section || !list) return;

  const entries = Object.entries(pinnedAssists);
  if (entries.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = '';

  for (const [slotIdx, monster] of entries) {
    const div = document.createElement('div');
    div.className = 'pinned-item';
    div.innerHTML = `
      <span class="pinned-slot">スロット${parseInt(slotIdx) + 1}</span>
      <span class="pinned-no">No.${monster.no}</span>
      <span class="pinned-name">${monster.name}</span>
      <button class="btn-unpin" data-slot="${slotIdx}">❌ 解除</button>
    `;
    div.querySelector('.btn-unpin').addEventListener('click', () => {
      delete pinnedAssists[slotIdx];
      updatePinnedUI();
    });
    list.appendChild(div);
  }

  // 固定して再計算ボタンを追加
  const existingRecalc = list.querySelector('.btn-pinned-recalc');
  if (!existingRecalc) {
    const recalcBtn = document.createElement('button');
    recalcBtn.className = 'btn btn-gold btn-sm btn-pinned-recalc';
    recalcBtn.style.marginTop = '10px';
    recalcBtn.textContent = '🔄 固定して再計算';
    recalcBtn.addEventListener('click', () => runOptimization());
    list.appendChild(recalcBtn);
  }
}

function clearAllPins() {
  pinnedAssists = {};
  updatePinnedUI();
  runOptimization();
}

function isFullyMet(state) {
  // アシストのみの覚醒カウントで充足を判定
  const counts = state.assistAwakenCounts || state.awakenCounts;
  for (const [id, cnt] of Object.entries(partyRequiredAwakens)) {
    if ((counts[parseInt(id)] || 0) < cnt) return false;
  }
  if (requiredSB > 0) {
    const sb = calcSBBreakdown(state);
    if (sb.assistTotal < requiredSB) return false;
  }
  return true;
}

function calcSBBreakdown(state) {
  // ベースSB（参考値）
  let baseAwakenSB = 0, baseSbPlus = 0, baseSbMinus = 0;
  baseMonsters.forEach(b => {
    if (!b) return;
    for (const a of (b.awakens || [])) {
      if (a === 21) baseAwakenSB++;
      if (a === 56) baseSbPlus++;
      if (a === 105) baseSbMinus++;
    }
  });
  const netBaseSB = Math.max(0, baseAwakenSB - baseSbMinus);
  const baseSBTotal = netBaseSB + baseSbPlus * 2;

  // アシストSB（判定用）
  let assistAwakenSB = 0, assistSbPlus = 0, assistSbMinus = 0, haste = 0, maxDelay = 0;
  for (let i = 0; i < state.picks.length; i++) {
    const m = state.picks[i];
    for (const a of (m.awakens || [])) {
      if (a === 21) assistAwakenSB++;
      if (a === 56) assistSbPlus++;
      if (a === 105) assistSbMinus++;
    }
    if (slotConditions[i].skillUsable) {
      haste += getHasteTurns(m);
      const d = getDelayTurns(m);
      if (d > maxDelay) maxDelay = d;
    }
  }
  const netAssistAwakenSB = Math.max(0, assistAwakenSB - assistSbMinus);
  let assistTotal = netAssistAwakenSB + assistSbPlus * 2 + haste;
  if (delayAsSB) assistTotal += maxDelay;

  return { baseSBTotal, assistAwakenSB: netAssistAwakenSB, assistSbPlus, haste, maxDelay, assistTotal };
}

// ==================== 初期化 ====================

document.addEventListener('DOMContentLoaded', async () => {
  const overlay = document.getElementById('loading-overlay');
  const opening = document.getElementById('opening-animation');

  initInfoModal();

  // データ読み込みとアニメーションを同時に開始
  const [success] = await Promise.all([
    loadAllData(),
    playOpeningAnimation()
  ]);

  if (success) {
    initUI();
    // アニメーション終了後にフェードアウト
    opening.classList.add('fade-out');
    setTimeout(() => {
      opening.style.display = 'none';
    }, 600);
    console.log(`データ読込完了: 全${allMonsters.length}体, アシスト候補${assistMonsters.length}体, スキル${Object.keys(skillMap).length}件`);
  } else {
    // 失敗時は通常のローディング表示に切り替え
    opening.style.display = 'none';
    overlay.style.display = 'flex';
  }
});

// ==================== インフォメーションモーダル ====================
function initInfoModal() {
  const btnShow = document.getElementById('btn-show-info');
  const btnClose = document.getElementById('btn-close-info');
  const overlay = document.getElementById('info-modal-overlay');
  const textContent = document.getElementById('info-text-content');

  if (!btnShow || !overlay) return;

  let isLoaded = false;

  btnShow.addEventListener('click', async () => {
    overlay.style.display = 'flex';
    if (!isLoaded) {
      try {
        const res = await fetch('./取扱説明書.txt');
        if (res.ok) {
          const text = await res.text();
          textContent.textContent = text;
          isLoaded = true;
        } else {
          textContent.textContent = '取扱説明書の読み込みに失敗しました。';
        }
      } catch (err) {
        textContent.textContent = '取扱説明書の読み込みエラー: ' + err.message;
      }
    }
  });

  btnClose.addEventListener('click', () => {
    overlay.style.display = 'none';
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.style.display = 'none';
    }
  });
}
