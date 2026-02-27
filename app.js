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
let awakenMultipliers = {}; // 覚醒ID → 火力倍率（CSVから読み込み）
let awakenNameToIdMap = {};  // 覚醒名→覚醒ID 逆引きマップ（消滅アシスト付与覚醒パース用）
let vanishGrantedCache = {}; // モンスターNo → 付与覚醒ID配列キャッシュ

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
  skillKeyword: "",
  minTurn: null,              // スキルマターンn以下（skill.minTurn <= n）
  maxTurn: null,              // スキル初期ターンn以上（skill.baseTurn >= n）
  requiredDpsMultiplier: null, // 火力倍率下限
}));

// STEP2: 有効な火力覚醒
let selectedDpsAwakens = new Set();

// STEP3: パーティ全体の必要覚醒 {awakenId: count}
let partyRequiredAwakens = {};
let requiredSB = 0;
let delayAsSB = false;

// 除外リスト
let excludedMonsterNos = new Set();

// 同種アシスト複数採用
let allowDuplicateAssists = false;  // STEP3トグル
let duplicateMaxCount = 2;          // 初期値: 2体まで
// 個別モンスターの採用数制限 { monsterNo: maxCount }
let monsterDupLimits = {};

// 計算制御
let stopRequested = false;
let dfsIterCount = 0;

// 固定アシスト { slotIdx: monster }
let pinnedAssists = {};

// ブックマーク候補
let bookmarkedResults = [];
let bookmarkFabTimer = null;

// 検索モード（true: 高速=スコアリング絞り込み, false: 総当たり=全数探索）
let searchModeFast = true;
let searchModePopupActive = false;

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
const HIDDEN_AWAKEN_IDS = new Set([0, 49]);
const DASH_NAMES = new Set(['-', 'null', '']);
// STEP3覚醒グリッドから除外するID（SB系は下部の数値入力で管理）
const PARTY_HIDDEN_AWAKEN_IDS = new Set([21, 56, 105]);

// ==================== 覚醒上位互換マッピング ====================
// 下位覚醒ID → { upId: 上位覚醒ID, ratio: 上位1個=下位N個 }
const UPGRADE_AWAKEN_MAP = {
  27: { upId: 96, ratio: 2 },    // 2体攻撃 → 2体攻撃+
  43: { upId: 107, ratio: 2 },   // 7強 → 7強+
  61: { upId: 111, ratio: 2 },   // 10強 → 10強+
  22: { upId: 116, ratio: 3 },   // 火列 → 火列x3
  23: { upId: 117, ratio: 3 },   // 水列 → 水列x3
  24: { upId: 118, ratio: 3 },   // 木列 → 木列x3
  25: { upId: 119, ratio: 3 },   // 光列 → 光列x3
  26: { upId: 120, ratio: 3 },   // 闇列 → 闇列x3
  73: { upId: 121, ratio: 2 },   // 火コンボ → 火コンボ+
  74: { upId: 122, ratio: 2 },   // 水コンボ → 水コンボ+
  75: { upId: 123, ratio: 2 },   // 木コンボ → 木コンボ+
  76: { upId: 124, ratio: 2 },   // 光コンボ → 光コンボ+
  77: { upId: 125, ratio: 2 },   // 闇コンボ → 闇コンボ+
  78: { upId: 110, ratio: 2 },   // 十字 → 十字+
  60: { upId: 108, ratio: 2 },   // L字 → L字+
  48: { upId: 109, ratio: 2 },   // 無効貫通 → 無効貫通+
  79: { upId: 112, ratio: 2 },   // 3色 → 3色+
  80: { upId: 113, ratio: 2 },   // 4色 → 4色+
  81: { upId: 114, ratio: 2 },   // 5色 → 5色+
  20: { upId: 115, ratio: 2 },   // バインド回復 → バインド回復+
  21: { upId: 56, ratio: 2 },    // スキルブースト → スキルブースト+
  9: { upId: 98, ratio: 2 },    // 自動回復 → 自動回復+
  51: { upId: 97, ratio: 2 },    // スキルチャージ → スキルチャージ+
  11: { upId: 68, ratio: 5 },    // 暗闇耐性 → 暗闇耐性+
  12: { upId: 69, ratio: 5 },    // お邪魔耐性 → お邪魔耐性+
  13: { upId: 70, ratio: 5 },    // 毒耐性 → 毒耐性+
  127: { upId: 142, ratio: 1.2 }, // 全パラ → 全パラ+
  29: { upId: 104, ratio: 2 },   // 回復ドロ強 → 回復ドロ強+
};

// 逆引き: 上位覚醒ID → { downId: 下位覚醒ID, ratio: 上位1個=下位N個 }
const DOWNGRADE_AWAKEN_MAP = {};
for (const [downId, val] of Object.entries(UPGRADE_AWAKEN_MAP)) {
  DOWNGRADE_AWAKEN_MAP[val.upId] = { downId: parseInt(downId), ratio: val.ratio };
}

/**
 * 指定覚醒IDの「仮想的な保有数」を算出（上位覚醒による代替カウント含む）
 * @param {number} awakenId - 判定対象の覚醒ID
 * @param {Array|Object} awakens - 覚醒配列またはカウントオブジェクト {id: count}
 * @returns {number} 仮想的な保有数
 */
function getVirtualCount(awakenId, awakens) {
  let count;
  // 配列かオブジェクトかで処理分岐
  if (Array.isArray(awakens)) {
    count = awakens.filter(a => a === awakenId).length;
  } else {
    count = awakens[awakenId] || 0;
  }

  // 下位覚醒を指定した場合: 上位覚醒の保有数をratio倍で加算
  const upgrade = UPGRADE_AWAKEN_MAP[awakenId];
  if (upgrade) {
    const upCount = Array.isArray(awakens)
      ? awakens.filter(a => a === upgrade.upId).length
      : (awakens[upgrade.upId] || 0);
    count += upCount * upgrade.ratio;
  }

  // 上位覚醒を指定した場合: 下位覚醒の保有数を1/ratio倍で加算
  const downgrade = DOWNGRADE_AWAKEN_MAP[awakenId];
  if (downgrade) {
    const downCount = Array.isArray(awakens)
      ? awakens.filter(a => a === downgrade.downId).length
      : (awakens[downgrade.downId] || 0);
    count += downCount / downgrade.ratio;
  }

  // 5色ドロップ強化の特殊処理
  // 各属性ドロ強+(99-103)を要求した場合、5色ドロ強(137)は0.5個分
  if ([99, 100, 101, 102, 103].includes(awakenId)) {
    const fiveColorCount = Array.isArray(awakens)
      ? awakens.filter(a => a === 137).length
      : (awakens[137] || 0);
    count += fiveColorCount * 0.5;
  }

  // 5色ドロ強(137)を要求した場合、属性ドロ強+全5種がそれぞれ1個以上あれば代替
  if (awakenId === 137) {
    const eleDropCounts = [99, 100, 101, 102, 103].map(id =>
      Array.isArray(awakens) ? awakens.filter(a => a === id).length : (awakens[id] || 0)
    );
    count += Math.floor(Math.min(...eleDropCounts));
  }

  return count;
}

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
    const [awakRes, attrRes, typeRes, multRes] = await Promise.all([
      fetch('./awakens/awakens_name.csv'),
      fetch('./attributes/attributes_name.csv'),
      fetch('./type/type_name.csv'),
      fetch('./awakens/覚醒スキル倍率表.csv'),
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
    // 覚醒倍率テーブル読み込み（「特殊な倍率」列を使用）
    const multText = await multRes.text();
    multText.trim().split('\n').forEach(line => {
      const parts = line.replace('\r', '').split(',');
      // CSV: スキルNo, 汎用倍率, 覚醒種類, 特殊な倍率
      if (parts.length >= 4 && parts[0] !== 'スキルNo') {
        const id = parseInt(parts[0]);
        const mult = parseFloat(parts[3]);
        if (!isNaN(id) && !isNaN(mult)) awakenMultipliers[id] = mult;
      }
    });
    // 覚醒名→ID 逆引きマップを構築（消滅アシスト付与覚醒パース用）
    awakenNameToIdMap = buildAwakenNameToIdMap();
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

// ==================== 消滅アシスト: 付与覚醒パース ====================

/**
 * 覚醒名→覚醒ID の逆引きマップを構築
 * スキル説明文に記載される覚醒名の表記ゆれ（全角/半角＋、括弧付き、x/×）に対応
 */
function buildAwakenNameToIdMap() {
  const map = {};
  for (const [idStr, name] of Object.entries(awakenNames)) {
    if (!name || name === 'null' || name === '-') continue;
    const nid = parseInt(idStr);
    // 原本
    map[name] = nid;
    // 全角＋→半角+ に正規化した版
    const halfPlus = name.replace(/＋/g, '+');
    if (halfPlus !== name) map[halfPlus] = nid;
    // 括弧を除去した版（例: "超コンボ強化（10強）" → "超コンボ強化"）
    const noParens = name.replace(/[（(][^）)]*[）)]/g, '').trim();
    if (noParens !== name) {
      map[noParens] = nid;
      const noParensHalf = noParens.replace(/＋/g, '+');
      if (noParensHalf !== noParens) map[noParensHalf] = nid;
    }
    // x→× の正規化（列強化x3等）
    const xToTimes = name.replace(/x/g, '×');
    if (xToTimes !== name) map[xToTimes] = nid;
    // ×→x の正規化
    const timesToX = name.replace(/×/g, 'x');
    if (timesToX !== name) map[timesToX] = nid;
  }
  // 特殊な表記ゆれ対応
  if (awakenNames[132]) map['アフタヌーンティー'] = 132;  // CSV: アフタヌーンティ
  return map;
}

/**
 * 消滅アシストかどうかを判定
 * @param {Object} monster - モンスターオブジェクト
 * @returns {boolean}
 */
function isVanishingAssist(monster) {
  const s = getSkillInfo(monster);
  if (!s) return false;
  return (s.description || '').includes('このアシストが消滅');
}

/**
 * 消滅アシストのスキル説明文から付与される覚醒スキルIDの配列をパースする
 * 消滅アシストでない場合はnullを返す
 * @param {Object} monster - モンスターオブジェクト
 * @returns {number[]|null} 付与覚醒ID配列またはnull
 */
function getVanishGrantedAwakens(monster) {
  // キャッシュチェック
  if (vanishGrantedCache[monster.no] !== undefined) return vanishGrantedCache[monster.no];

  const s = getSkillInfo(monster);
  if (!s) { vanishGrantedCache[monster.no] = null; return null; }
  const desc = s.description || '';
  if (!desc.includes('このアシストが消滅')) { vanishGrantedCache[monster.no] = null; return null; }

  // [xxx] パターンを全て抽出
  const matches = desc.match(/\[([^\]]+)\]/g);
  if (!matches) { vanishGrantedCache[monster.no] = null; return null; }

  const results = [];
  for (const match of matches) {
    const name = match.slice(1, -1); // 括弧除去
    // そのまま検索
    let id = awakenNameToIdMap[name];
    if (id === undefined) {
      // 全角＋→半角+ に正規化して再検索
      const norm = name.replace(/＋/g, '+').replace(/×/g, 'x');
      id = awakenNameToIdMap[norm];
    }
    if (id === undefined) {
      // 半角+→全角＋ に正規化して再検索
      const norm2 = name.replace(/\+/g, '＋').replace(/x/g, '×');
      id = awakenNameToIdMap[norm2];
    }
    if (id !== undefined) {
      results.push(id);
    }
  }

  const ret = results.length > 0 ? results : null;
  vanishGrantedCache[monster.no] = ret;
  return ret;
}

/**
 * 覚醒充足判定用の「有効覚醒」を取得
 * - 消滅アシスト（覚醒付与型）: 付与覚醒を返す（消滅後に有効となる覚醒）
 * - 通常アシスト / 覚醒付与なし消滅アシスト: getActiveAwakens(monster) を返す
 * @param {Object} monster - モンスターオブジェクト
 * @returns {number[]} 覚醒ID配列
 */
function getEffectiveAwakensForSearch(monster) {
  const granted = getVanishGrantedAwakens(monster);
  if (granted) return granted;
  return getActiveAwakens(monster);
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

/**
 * アシストモンスターの火力倍率を計算（STEP2で選択された覚醒のみ有効）
 * @param {Object} monster - アシストモンスター
 * @returns {number} 倍率の乗算値（1 = 倍率なし）
 */
function calcDpsMultiplier(monster) {
  const active = getActiveAwakens(monster);
  let multiplier = 1;
  for (const a of active) {
    if (selectedDpsAwakens.has(a) && awakenMultipliers[a] && awakenMultipliers[a] > 1) {
      multiplier *= awakenMultipliers[a];
    }
  }
  return multiplier;
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
  if (step === 3) updateStep3PreAssistNote();

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
      <div class="pre-assist-pinned" id="pre-assist-pinned-${i}" style="display:none"></div>
      <details class="pre-assist-details" id="pre-assist-details-${i}" style="margin-top:8px">
        <summary class="field-label" style="cursor:pointer; outline:none; font-size:0.85rem;">📎 アシスト（任意）</summary>
        <div class="search-wrapper" style="margin-top:6px">
          <span class="search-icon">🔍</span>
          <input type="text" class="search-input" id="assist-search-${i}"
                 placeholder="アシストNo. or 名前を入力" autocomplete="off">
        </div>
        <div class="search-results" id="assist-results-${i}"></div>
      </details>
    `;
    container.appendChild(div);

    const input = div.querySelector(`#base-search-${i}`);
    const results = div.querySelector(`#base-results-${i}`);
    input.addEventListener('input', () => searchMonsters(input.value, results, i));
    input.addEventListener('focus', () => { if (input.value.length > 0) results.classList.add('show'); });
    document.addEventListener('click', (e) => { if (!div.contains(e.target)) results.classList.remove('show'); });

    // アシスト検索
    const assistInput = div.querySelector(`#assist-search-${i}`);
    const assistResults = div.querySelector(`#assist-results-${i}`);
    assistInput.addEventListener('input', () => searchAssistMonsters(assistInput.value, assistResults, i));
    assistInput.addEventListener('focus', () => { if (assistInput.value.length > 0) assistResults.classList.add('show'); });
    document.addEventListener('click', (e) => { if (!div.contains(e.target)) assistResults.classList.remove('show'); });
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

  const attrs = (monster.attributes || []).filter((a, idx) => a != null && (a > 0 || (idx === 0 && a === 0)));
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

// ==================== STEP0: アシスト事前入力 ====================

function searchAssistMonsters(query, resultsEl, slotIdx) {
  resultsEl.innerHTML = '';
  if (!query || query.length < 1) { resultsEl.classList.remove('show'); return; }
  const q = query.trim().toLowerCase();
  let matches = [];
  if (/^\d+$/.test(q)) {
    matches = assistMonsters.filter(m => String(m.no).startsWith(q)).slice(0, 30);
  } else {
    matches = assistMonsters.filter(m => m.name && m.name.toLowerCase().includes(q)).slice(0, 30);
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
    item.addEventListener('click', () => selectPreAssist(slotIdx, m));
    resultsEl.appendChild(item);
  });
  resultsEl.classList.add('show');
}

function selectPreAssist(slotIdx, monster) {
  pinnedAssists[slotIdx] = monster;

  const pinned = document.getElementById(`pre-assist-pinned-${slotIdx}`);
  const details = document.getElementById(`pre-assist-details-${slotIdx}`);
  const assistInput = document.getElementById(`assist-search-${slotIdx}`);
  const assistResults = document.getElementById(`assist-results-${slotIdx}`);

  assistResults.classList.remove('show');
  if (assistInput) assistInput.value = '';
  if (details) details.removeAttribute('open');

  const attrs = (monster.attributes || []).filter((a, idx) => a != null && (a > 0 || (idx === 0 && a === 0)));
  const types = (monster.types || []).filter(t => t > 0);
  const awakens = getActiveAwakens(monster);
  const skill = getSkillInfo(monster);

  let awakensHtml = '';
  if (isVanishingAssist(monster) && getVanishGrantedAwakens(monster)) {
    const granted = getVanishGrantedAwakens(monster);
    awakensHtml = `
      <div class="vanish-original">
        ${awakens.map(a => `<img src="${awakenIcon(a)}" title="${awakenName(a)}">`).join('')}
      </div>
      <span class="vanish-plus">＋</span>
      <div class="vanish-granted">
        ${granted.map(a => `<img src="${awakenIcon(a)}" title="${awakenName(a)}">`).join('')}
      </div>
    `;
  } else {
    awakensHtml = awakens.map(a => `<img src="${awakenIcon(a)}" title="${awakenName(a)}">`).join('');
  }

  pinned.innerHTML = `
    <div class="pre-assist-card">
      <div class="pre-assist-header">
        <span class="pre-assist-pin-icon">📍</span>
        <span class="assist-slot-label">事前アシスト</span>
        <button class="btn-remove-pre-assist" onclick="removePreAssist(${slotIdx})">❌ 解除</button>
      </div>
      <div class="assist-id-name">
        <span class="assist-id">No.${monster.no}</span>
        <span class="assist-name">${monster.name}</span>
      </div>
      <div class="assist-meta">
        ${attrs.map(a => `<img src="${attrIcon(a)}" title="${attrName(a)}">`).join('')}
        ${types.map(t => `<img src="${typeIcon(t)}" title="${typeName(t)}">`).join('')}
      </div>
      <div class="assist-awakens">
        ${awakensHtml}
      </div>
      <div class="assist-skill" style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">
        ${skill ? `${skill.name} (CT: ${skill.baseTurn}→${skill.minTurn})` : ''}
      </div>
    </div>
  `;
  pinned.style.display = 'block';
}

function removePreAssist(slotIdx) {
  delete pinnedAssists[slotIdx];
  const pinned = document.getElementById(`pre-assist-pinned-${slotIdx}`);
  if (pinned) {
    pinned.innerHTML = '';
    pinned.style.display = 'none';
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

    const attrIcons = [1, 2, 3, 4, 5, 0].map(id =>
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
      <details class="skill-detail-details" style="margin-top:12px">
        <summary class="field-label" style="cursor:pointer; outline:none;">🔍 スキル詳細条件</summary>
        <div style="margin-top:8px;">
          <div class="field-label" style="font-size:0.82rem">キーワード条件（任意・複数語句はスペース区切り）</div>
          <input type="text" class="keyword-input" data-slot="${i}" placeholder="例：覚醒無効　ダメージ吸収" 
                 style="width:100%; padding:8px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-card); color:var(--text-main); font-size:0.85rem;">
          <p style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">※ヘイスト、遅延必要数は後ほど入力するため、原則ここには記入不要です。</p>
          <div class="num-input-row" style="margin-top:8px">
            <label style="font-size:0.82rem">⏱️ スキルマ ターン以下:</label>
            <input type="number" class="num-input min-turn-input" data-slot="${i}" min="1" placeholder="なし"
                   style="width:70px; padding:4px 8px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-card); color:var(--text-main); font-size:0.85rem;">
          </div>
          <p style="font-size:0.72rem; color:var(--text-muted); margin-top:2px; margin-left:4px;">※アシストスキルを使いたい時に</p>
          <div class="num-input-row" style="margin-top:4px">
            <label style="font-size:0.82rem">⏱️ スキル初期 ターン以上:</label>
            <input type="number" class="num-input max-turn-input" data-slot="${i}" min="1" placeholder="なし"
                   style="width:70px; padding:4px 8px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-card); color:var(--text-main); font-size:0.85rem;">
          </div>
          <p style="font-size:0.72rem; color:var(--text-muted); margin-top:2px; margin-left:4px;">※アシストスキルを貯めたくない時に</p>
        </div>
      </details>
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
      <div class="dps-multiplier-row-simple" id="dps-mult-row-${i}" style="display:none; margin-top:4px; margin-left:24px;">
        <label style="font-size:0.82rem">🔥 必要火力倍率（x倍以上）:</label>
        <input type="number" class="num-input dps-mult-input" data-slot="${i}" min="1" step="0.5" placeholder="なし"
               style="width:80px; padding:4px 8px; border-radius:4px; border:1px solid var(--border-color); background:var(--bg-card); color:var(--text-main); font-size:0.85rem;">
        <p style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;">※任意 — STEP2で選択された覚醒の倍率の乗算値</p>
      </div>
      <div class="slot-tabs-bottom" id="cond-slot-tabs-bottom-${i}">
        ${[0, 1, 2, 3, 4, 5].map(j => `<div class="slot-tab slot-tab-sm ${j === i ? 'active' : ''}" data-slot="${j}" data-from-bottom="1">スロット${j + 1}</div>`).join('')}
      </div>
      <div class="cond-base-bottom-info" id="cond-base-bottom-${i}" style="display:none"></div>
      <div class="cond-preassist-overlay" id="cond-preassist-overlay-${i}" style="display:none">
        <div class="preassist-overlay-content">
          <span class="preassist-overlay-icon">📍</span>
          <span>アシスト指定済み — STEP0で設定済みのため入力不要です</span>
        </div>
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
      // attrConditionは0(無属性)も有効な値なので、nullチェックで判定する
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
    if (e.target.classList.contains('dps-priority-toggle')) {
      const slot = parseInt(e.target.dataset.slot);
      slotConditions[slot].dpsPriority = e.target.checked;
      // 火力優先ON/OFFで倍率入力行の表示を切り替え
      const multRow = document.getElementById(`dps-mult-row-${slot}`);
      if (multRow) multRow.style.display = e.target.checked ? 'block' : 'none';
      if (!e.target.checked) {
        slotConditions[slot].requiredDpsMultiplier = null;
        const multInput = multRow ? multRow.querySelector('.dps-mult-input') : null;
        if (multInput) multInput.value = '';
      }
    }
    // ターン数入力
    if (e.target.classList.contains('min-turn-input')) {
      const val = e.target.value.trim();
      slotConditions[parseInt(e.target.dataset.slot)].minTurn = val ? parseInt(val) : null;
    }
    if (e.target.classList.contains('max-turn-input')) {
      const val = e.target.value.trim();
      slotConditions[parseInt(e.target.dataset.slot)].maxTurn = val ? parseInt(val) : null;
    }
    // 火力倍率入力
    if (e.target.classList.contains('dps-mult-input')) {
      const val = e.target.value.trim();
      slotConditions[parseInt(e.target.dataset.slot)].requiredDpsMultiplier = val ? parseFloat(val) : null;
    }
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

// --- STEP1: ベースモンスター情報を各スロットに表示 + アシスト固定済グレーアウト ---
function updateStep1BaseInfo() {
  for (let i = 0; i < 6; i++) {
    const panel = document.getElementById(`cond-base-info-${i}`);
    const bottomPanel = document.getElementById(`cond-base-bottom-${i}`);
    const overlay = document.getElementById(`cond-preassist-overlay-${i}`);
    const slotDiv = document.getElementById(`cond-slot-${i}`);
    const base = baseMonsters[i];
    const pinned = pinnedAssists[i];

    // アシスト固定済グレーアウト
    if (pinned) {
      if (slotDiv) slotDiv.classList.add('slot-preassist-locked');
      if (overlay) {
        const pAttrs = (pinned.attributes || []).filter((a, idx) => a != null && (a > 0 || (idx === 0 && a === 0)));
        const pAwakens = getActiveAwakens(pinned);
        overlay.innerHTML = `
          <div class="preassist-overlay-content">
            <span class="preassist-overlay-icon">📍</span>
            <div>
              <div style="font-weight:700; margin-bottom:4px;">アシスト指定済み</div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span>No.${pinned.no} ${pinned.name}</span>
                ${pAttrs.map(a => `<img src="${attrIcon(a)}" style="width:16px;height:16px">`).join('')}
              </div>
              <div style="display:flex;gap:2px;flex-wrap:wrap;margin-top:4px;">
                ${pAwakens.map(a => `<img src="${awakenIcon(a)}" style="width:16px;height:16px" title="${awakenName(a)}">`).join('')}
              </div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
                STEP0で設定済みのため、このスロットの条件入力は不要です
              </div>
            </div>
          </div>
        `;
        overlay.style.display = 'flex';
      }
    } else {
      if (slotDiv) slotDiv.classList.remove('slot-preassist-locked');
      if (overlay) overlay.style.display = 'none';
    }

    // ベースモンスター情報（上部）
    if (base) {
      const awakens = getActiveAwakens(base);
      const attrs = (base.attributes || []).filter((a, idx) => a != null && (a > 0 || (idx === 0 && a === 0)));
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

      // 下部スロットボタン下にもベース情報を再掲
      if (bottomPanel) {
        bottomPanel.innerHTML = `
          <div class="base-bottom-card">
            <div class="base-bottom-row">
              <span class="bs-label">No.${base.no}</span>
              <span class="bs-name">${base.name}</span>
              ${attrs.map(a => `<img src="${attrIcon(a)}" style="width:16px;height:16px" title="${attrName(a)}">`).join('')}
              ${types.map(t => `<img src="${typeIcon(t)}" style="width:16px;height:16px" title="${typeName(t)}">`).join('')}
            </div>
            <div class="base-bottom-awakens">
              ${awakens.map(a => `<img src="${awakenIcon(a)}" style="width:16px;height:16px" title="${awakenName(a)}">`).join('')}
            </div>
          </div>
        `;
        bottomPanel.style.display = 'block';
      }
    } else {
      panel.innerHTML = '';
      panel.style.display = 'none';
      if (bottomPanel) {
        bottomPanel.innerHTML = '';
        bottomPanel.style.display = 'none';
      }
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

// --- STEP3: 事前アシスト案内の更新 ---
function updateStep3PreAssistNote() {
  const note = document.getElementById('step3-preassist-note');
  if (!note) return;
  const pinnedEntries = Object.entries(pinnedAssists);
  if (pinnedEntries.length === 0) {
    note.style.display = 'none';
    return;
  }
  const names = pinnedEntries.map(([idx, m]) => `スロット${parseInt(idx) + 1}: ${m.name}`).join('、');
  note.innerHTML = `
    <div class="preassist-note-card">
      <span class="preassist-note-icon">📍</span>
      <div>
        <strong>事前入力済みアシスト:</strong> ${names}<br>
        <span style="font-size:0.8rem; color:var(--text-muted);">
          上記を含めた<strong>アシスト6体で必要となる覚醒数とスキブ数</strong>を入力してください。
        </span>
      </div>
    </div>
  `;
  note.style.display = 'block';
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

function createBubbleEffect(btnRect) {
  const colors = ['#f0c040', '#ffffff', '#ff9900', '#f5d160'];
  for (let i = 0; i < 15; i++) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble-particle';
    const size = 5 + Math.random() * 10;
    bubble.style.width = size + 'px';
    bubble.style.height = size + 'px';
    const startX = btnRect.left + btnRect.width * Math.random();
    const startY = btnRect.top + btnRect.height * Math.random();
    bubble.style.left = startX + 'px';
    bubble.style.top = startY + 'px';
    bubble.style.background = colors[Math.floor(Math.random() * colors.length)];
    document.body.appendChild(bubble);

    const angle = Math.random() * Math.PI * 2;
    const distance = 40 + Math.random() * 80;
    const endX = startX + Math.cos(angle) * distance;
    const endY = startY + Math.sin(angle) * distance;
    const duration = 500 + Math.random() * 400;

    bubble.animate([
      { transform: `translate(0, 0) scale(1)`, opacity: 1 },
      { transform: `translate(${Math.cos(angle) * distance * 0.7}px, ${Math.sin(angle) * distance * 0.7}px) scale(1.2)`, opacity: 0.8, offset: 0.6 },
      { transform: `translate(${endX - startX}px, ${endY - startY}px) scale(0)`, opacity: 0 }
    ], { duration: duration, easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)' });
    setTimeout(() => bubble.remove(), duration);
  }
}

function triggerLiquidSearchAnimation(btnSearch) {
  return new Promise(resolve => {
    if (btnSearch.classList.contains('animating')) return resolve();

    const mockFab = document.getElementById('fab-recalc');
    const gooeyContainer = document.getElementById('gooey-container');
    if (!mockFab || !gooeyContainer) return resolve();

    const btnRect = btnSearch.getBoundingClientRect();
    const fabRect = mockFab.getBoundingClientRect();

    createBubbleEffect(btnRect);

    const btnText = btnSearch.querySelector('.btn-text');
    if (btnText) btnText.style.opacity = '0';
    btnSearch.style.background = 'transparent';
    btnSearch.style.boxShadow = 'none';
    btnSearch.classList.add('animating');
    gooeyContainer.innerHTML = '';

    const fabGooeyTarget = document.createElement('div');
    fabGooeyTarget.style.position = 'fixed';
    fabGooeyTarget.style.left = fabRect.left + 'px';
    fabGooeyTarget.style.top = fabRect.top + 'px';
    fabGooeyTarget.style.width = fabRect.width + 'px';
    fabGooeyTarget.style.height = fabRect.height + 'px';
    fabGooeyTarget.style.borderRadius = '50%';
    fabGooeyTarget.style.background = 'var(--gradient-gold)';
    fabGooeyTarget.style.zIndex = '1';
    gooeyContainer.appendChild(fabGooeyTarget);

    const liquidBlob = document.createElement('div');
    liquidBlob.className = 'liquid-blob';
    liquidBlob.style.width = btnRect.width + 'px';
    liquidBlob.style.height = btnRect.height + 'px';
    liquidBlob.style.left = btnRect.left + 'px';
    liquidBlob.style.top = btnRect.top + 'px';
    liquidBlob.style.borderRadius = '12px';
    liquidBlob.style.opacity = '1';
    gooeyContainer.appendChild(liquidBlob);

    const dropCount = 3;
    const drops = [];
    for (let i = 0; i < dropCount; i++) {
      const drop = document.createElement('div');
      drop.className = 'liquid-drop';
      drop.style.width = '30px';
      drop.style.height = '30px';
      drop.style.left = (btnRect.left + btnRect.width / 2 - 15) + 'px';
      drop.style.top = (btnRect.top + btnRect.height / 2 - 15) + 'px';
      drop.style.opacity = '1';
      gooeyContainer.appendChild(drop);
      drops.push(drop);
    }

    const startX = btnRect.left + btnRect.width / 2;
    const startY = btnRect.top + btnRect.height / 2;
    const startW = btnRect.width;
    const startH = btnRect.height;
    const endX = fabRect.left + fabRect.width / 2;
    const endY = fabRect.top + fabRect.height / 2;
    const angle = Math.atan2(endY - startY, endX - startX);

    let startTime = null;
    const duration = 750;
    const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const easeInExpo = (t) => t === 0 ? 0 : Math.pow(2, 10 * t - 10);

    function animateLiquid(timestamp) {
      if (!startTime) startTime = timestamp;
      let progress = (timestamp - startTime) / duration;
      if (progress > 1) progress = 1;

      let currentX = startX, currentY = startY, currentW = startW, currentH = startH;
      let scaleX = 1, scaleY = 1, br = 12;

      if (progress < 0.3) {
        const p = progress / 0.3;
        const ease = easeInOutCubic(p);
        br = 12 + ease * (startH / 2 - 12);
        currentW = startW * (1 - ease * 0.4);
        currentH = startH * (1 + ease * 0.2);
      } else {
        const p = (progress - 0.3) / 0.7;
        const ease = easeInExpo(p);
        currentX = startX + (endX - startX) * ease;
        currentY = startY + (endY - startY) * ease;
        br = startH / 2;
        currentW = startW * 0.6 * (1 - ease) + (fabRect.width * ease);
        currentH = startH * 1.2 * (1 - ease) + (fabRect.height * ease);
        const stretch = 1 + Math.sin(p * Math.PI) * 1.5;
        scaleX = stretch;
        scaleY = 1 / Math.sqrt(stretch);
      }

      liquidBlob.style.borderRadius = `${br}px`;
      liquidBlob.style.width = currentW + 'px';
      liquidBlob.style.height = currentH + 'px';
      liquidBlob.style.left = (currentX - currentW / 2) + 'px';
      liquidBlob.style.top = (currentY - currentH / 2) + 'px';

      if (progress >= 0.3) {
        liquidBlob.style.transform = `rotate(${angle}rad) scale(${scaleX}, ${scaleY})`;
      } else {
        liquidBlob.style.transform = `translate(0,0)`;
      }

      drops.forEach((drop, idx) => {
        const delay = 0.3 + (idx + 1) * 0.08;
        let dp = (progress - delay) / (1 - delay);
        if (dp < 0) dp = 0;
        if (dp > 1) dp = 1;
        const dease = easeInExpo(dp);
        const dx = startX + (endX - startX) * dease;
        const dy = startY + (endY - startY) * dease;
        const ds = 1 - Math.pow(dp, 2);
        drop.style.left = (dx - 15) + 'px';
        drop.style.top = (dy - 15) + 'px';
        drop.style.transform = `scale(${ds})`;
      });

      if (progress < 1) {
        requestAnimationFrame(animateLiquid);
      } else {
        liquidBlob.style.opacity = '0';
        drops.forEach(d => d.style.opacity = '0');
        setTimeout(() => {
          gooeyContainer.innerHTML = '';
          setTimeout(() => {
            btnSearch.style.display = '';
            btnSearch.classList.remove('animating');
            btnSearch.style.background = '';
            btnSearch.style.boxShadow = '';
            if (btnText) btnText.style.opacity = '1';
          }, 600);
          resolve();
        }, 50);
      }
    }
    requestAnimationFrame(animateLiquid);
  });
}

async function runOptimization(e) {
  const btnOptimize = document.getElementById('btn-optimize');
  const fabRecalcEl = document.getElementById('fab-recalc');

  // アニメーションの対象となるため先にFAB枠を表示しておく
  if (fabRecalcEl) {
    fabRecalcEl.style.display = 'block';
    void fabRecalcEl.offsetWidth; // 強制リフロー
  }

  if (btnOptimize && e && e.type === 'click') {
    await triggerLiquidSearchAnimation(btnOptimize);
  } else if (btnOptimize) {
    triggerPopEffect(btnOptimize);
  }

  const btn = document.getElementById('recalc-btn-el');
  const label = document.getElementById('recalc-label');
  const iconDefault = document.getElementById('recalc-icon-default');
  const iconLoading = document.getElementById('recalc-icon-loading');
  const iconStop = document.getElementById('recalc-icon-stop');

  // アニメーション: 縮小 (丸いアイコン化)
  if (btn) {
    btn.classList.add('mini');
    btn.classList.add('loading-state');
    btn.classList.remove('hint-state', 'stop-state');
    if (iconLoading) iconLoading.style.display = 'flex';
    if (iconDefault) iconDefault.style.display = 'none';
    if (iconStop) iconStop.style.display = 'none';
  }

  // 1.5秒後に「赤いボタンに変化＆展開」し、「計算停止はここをクリック」と表示
  setTimeout(() => {
    if (btn && btn.classList.contains('loading-state')) {
      btn.classList.remove('mini');
      btn.classList.add('hint-state');
      btn.classList.remove('loading-state');
      // アイコンの切り替えはCSS側でopacity制御されるため、display操作を最小限に
      if (iconLoading) iconLoading.style.display = 'none';
      if (iconStop) iconStop.style.display = 'flex';
      if (label) {
        label.textContent = '計算停止はここをクリック';
        // style.display = 'block' は初期化時にセット済みかCSSで制御
      }
    }
  }, 1500);

  // さらに2.5秒後（計4.0秒後）に、縮小し、ストップマークだけのアイコンに（連続性のあるアニメーション）
  setTimeout(() => {
    if (btn && btn.classList.contains('hint-state')) {
      btn.classList.remove('hint-state');
      btn.classList.add('mini');
      btn.classList.add('stop-state');
      // labelの非表示は、CSSの .mini .fab-label で opacity:0 と width:0 になるため、
      // 0.8sのtransitionの間、徐々に消えていく。
    }
  }, 4000);

  goToStep(4);
  stopRequested = false;
  dfsIterCount = 0;
  showProgressUI();

  // 火力解除セクションを隠す
  const dpsSec = document.getElementById('dps-toggle-section');
  if (dpsSec) dpsSec.style.display = 'none';

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
    resetRecalcBtn();
    displayResults(results);
  } catch (err) {
    hideProgressUI();
    console.error('Optimization error:', err);

    // 火力優先が原因で0件の場合の救済措置
    const hasDpsPriority = slotConditions.some(c => c.dpsPriority);
    if (hasDpsPriority) {
      showDpsToggleSection();
    }

    const rc2 = document.getElementById('result-container');
    if (rc2) {
      rc2.innerHTML = `<div class="empty-state"><div class="emoji-lg">⚠️</div><p>${err.message}</p></div>`;
    }
  }
}

function showDpsToggleSection() {
  const sec = document.getElementById('dps-toggle-section');
  const container = document.getElementById('dps-priority-toggles-container');
  if (!sec || !container) return;
  sec.style.display = 'block';
  container.innerHTML = '';

  slotConditions.forEach((c, i) => {
    if (c.dpsPriority) {
      const div = document.createElement('div');
      div.className = 'toggle-row';
      div.innerHTML = `
        <span class="toggle-label">スロット${i + 1} の火力優先を解除</span>
        <label class="toggle-switch">
          <input type="checkbox" onchange="toggleDpsPriority(${i}, this.checked)">
          <span class="toggle-slider-fire"></span>
        </label>
      `;
      container.appendChild(div);
    }
  });
}

function toggleDpsPriority(slotIdx, isChecked) {
  // ONOFFを反転させて再計算
  slotConditions[slotIdx].dpsPriority = !isChecked;
  runOptimization();
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
    // 消滅アシストの場合は付与覚醒を使用
    getEffectiveAwakensForSearch(monster).forEach(id => {
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

    // 検索モードに応じて候補制限を切替
    // searchModeFast=false（じっくり検索）: 候補制限なしの全数探索
    // searchModeFast=true（高速検索）: スコアリングで候補を絞り込み
    if (!searchModeFast && unpinnedCount <= 3) {
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
        const hpa = getEffectiveAwakensForSearch(a).filter(aw => aw === 46).length;
        const hpb = getEffectiveAwakensForSearch(b).filter(aw => aw === 46).length;
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
          .filter(m => getEffectiveAwakensForSearch(m).includes(aid))
          .sort((a, b) => {
            const ca = getEffectiveAwakensForSearch(a).filter(aw => aw === aid).length;
            const cb = getEffectiveAwakensForSearch(b).filter(aw => aw === aid).length;
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
    const count = assistMonsters.filter(m => getEffectiveAwakensForSearch(m).includes(aid)).length;
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
  const active = getEffectiveAwakensForSearch(monster);
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
  const MAX_RESULTS = 15;
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
      const act = getEffectiveAwakensForSearch(m);
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
    // 同種採用の制御: 使用回数をカウントして制限チェック
    const usedCounts = {};
    currentPicks.forEach(p => { usedCounts[p.monster.no] = (usedCounts[p.monster.no] || 0) + 1; });
    for (const m of slotCandidates[slotIdx]) {
      if (stopRequested) return;
      const currentCount = usedCounts[m.no] || 0;
      if (!allowDuplicateAssists) {
        // OFF時：同種は1体まで（従来通り）
        if (currentCount >= 1) continue;
      } else {
        // ON時：個別制限 > グローバル制限の順で判定
        const limit = monsterDupLimits[m.no] !== undefined ? monsterDupLimits[m.no] : duplicateMaxCount;
        if (currentCount >= limit) continue;
      }

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
      const active = getEffectiveAwakensForSearch(m);
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
    const aid = parseInt(id);
    // 上位互換マッチング対応: getVirtualCountで仮想カウント
    const have = getVirtualCount(aid, awakens);
    if (have < target) return false;
  }
  if (requiredSB > 0 && sb < requiredSB) return false;
  return true;
}

function canPotentiallyMeetRequirements(slot, currentAwakens, currentSB, maxRemains) {
  const remain = maxRemains[slot];
  for (const [id, target] of Object.entries(partyRequiredAwakens)) {
    const aid = parseInt(id);
    // 上位互換マッチング対応
    const currentHave = getVirtualCount(aid, currentAwakens);
    const potentialMax = getVirtualCount(aid, remain.awakens);

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
    const active = getEffectiveAwakensForSearch(m);

    // 必須覚醒チェック（上位互換マッチング対応）
    if (cond.requiredAwakens.length > 0) {
      const req = {};
      cond.requiredAwakens.forEach(id => { req[id] = (req[id] || 0) + 1; });
      for (const [id, cnt] of Object.entries(req)) {
        if (getVirtualCount(parseInt(id), active) < cnt) return false;
      }
    }

    // 属性条件（attrCondition=0は無属性なのでnullチェックで判定）
    if (cond.attrCondition != null) {
      if (cond.attrCondition === 0) {
        // 無属性: 第一属性が0のモンスターのみ
        if ((m.attributes || [])[0] !== 0) return false;
      } else {
        const mAttr = (m.attributes || [])[0];
        const sAttr = (m.attributes || [])[1];
        if (mAttr !== cond.attrCondition && sAttr !== cond.attrCondition) return false;
      }
    }

    // タイプ条件
    if (cond.typeCondition) {
      if (!(m.types || []).filter(t => t > 0).includes(cond.typeCondition)) return false;
    }

    // アシスト共鳴
    if (cond.resonance && base && !hasResonance(base, m)) return false;

    // 強制火力設定時: 選択中の火力覚醒を少なくとも1つ持っていること
    if (cond.forcedDps && selectedDpsAwakens.size > 0) {
      // 消滅アシストの場合は付与覚醒で火力判定（activeは既にgetEffectiveAwakensForSearchで取得済み）
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

    // スキルターン数条件
    if (cond.minTurn != null || cond.maxTurn != null) {
      const skill = getSkillInfo(m);
      if (!skill) return false;
      // 最短ターン条件: スキルマターンが入力値以下
      if (cond.minTurn != null && skill.minTurn > cond.minTurn) return false;
      // 最長ターン条件: スキル初期ターンが入力値以上
      if (cond.maxTurn != null && skill.baseTurn < cond.maxTurn) return false;
    }

    // 火力倍率条件
    if (cond.requiredDpsMultiplier != null && cond.requiredDpsMultiplier > 1) {
      const mult = calcDpsMultiplier(m);
      if (mult < cond.requiredDpsMultiplier) return false;
    }

    return true;
  });
}

function scoreMonster(monster, slotIdx) {
  let score = 0;
  const active = getEffectiveAwakensForSearch(monster);
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
// アシストのみの覚醒カウントで充足を判定（上位互換対応）
function isFullyMetDirect(state) {
  const counts = state.assistAwakenCounts || state.awakenCounts;
  for (const [id, cnt] of Object.entries(partyRequiredAwakens)) {
    if (getVirtualCount(parseInt(id), counts) < cnt) return false;
  }
  if (requiredSB > 0 && state.sbTotal < requiredSB) return false;
  return true;
}

// 結果カード1枚を生成する関数（リアルタイム表示・最終表示の両方で使用）
function buildResultCard(result, idx, isRealtime) {
  const card = document.createElement('div');
  card.className = `result-pattern ${isRealtime ? 'realtime-result' : ''}`;
  const met = isFullyMet(result);

  // ブックマークボタンと充足判定をヘッダーに配置
  const isBookmarked = bookmarkedResults.some(b => JSON.stringify(b.picks.map(p => p.no)) === JSON.stringify(result.picks.map(p => p.no)));

  const sig = JSON.stringify(result.picks.map(p => p.no));
  let html = `
    <div class="result-header">
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="result-rank">${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`} パターン${idx + 1}</span>
        <button class="btn-bookmark-card ${isBookmarked ? 'active' : ''}" data-idx="${idx}" data-sig='${sig}' title="ブックマークを保存/解除">
          <svg class="icon-svg" viewBox="0 0 24 24"><path d="M17,3H7C5.9,3,5,3.9,5,5v16l7-3l7,3V5C19,3.9,18.1,3,17,3z"></path></svg>
          <span class="btn-text">${isBookmarked ? 'ブックマーク解除' : 'ブックマーク'}</span>
        </button>
      </div>
      <span class="result-score ${met ? 'ok' : ''}">${met ? '✅ 条件充足' : '⚠️ 部分充足'}</span>
    </div>
  `;

  html += '<div class="result-assist-list">';
  // パターン内の同種カウントを算出
  const dupCounts = {};
  result.picks.forEach(p => { dupCounts[p.no] = (dupCounts[p.no] || 0) + 1; });
  const dupSeen = {}; // 同種の出現順を追跡
  for (let i = 0; i < 6; i++) {
    const m = result.picks[i];
    const allAw = getAllAwakens(m);
    const attrs = (m.attributes || []).filter((a, idx) => a != null && (a > 0 || (idx === 0 && a === 0)));
    const types = (m.types || []).filter(t => t > 0);
    const skill = getSkillInfo(m);
    const baseMon = baseMonsters[i];
    const hasDps = allAw.some(a => selectedDpsAwakens.has(a));
    const needsDpsWarning = slotConditions[i].dpsPriority && !hasDps;

    const isPinned = pinnedAssists[i] && pinnedAssists[i].no === m.no;
    // 同種採用判定: パターン内で同一モンスターが複数スロットに存在するか
    const isDuplicate = dupCounts[m.no] > 1;
    // 他の全スロットのいずれかで固定されているモンスターかどうかも判定（同期表示用）
    // ただし同種採用時（isDuplicate）はスロット単位で独立判定
    const isMonsterPinnedAnywhere = !isDuplicate && Object.values(pinnedAssists).some(p => p.no === m.no);
    const isExcluded = excludedMonsterNos.has(m.no);

    // 同種採用: この出現が何体目かを追跡
    dupSeen[m.no] = (dupSeen[m.no] || 0) + 1;
    // 採用数制限済みの判定: 許容数を超えた分のみ制限表示
    const dupLimit = monsterDupLimits[m.no];
    const isDupLimited = allowDuplicateAssists && dupLimit !== undefined && dupSeen[m.no] > dupLimit;

    let awakensHtml = '';
    if (isVanishingAssist(m) && getVanishGrantedAwakens(m)) {
      const granted = getVanishGrantedAwakens(m);
      awakensHtml = `
        <div class="vanish-original">
          ${allAw.map(a => `<img src="${awakenIcon(a)}" title="${awakenName(a)}">`).join('')}
        </div>
        <span class="vanish-plus">＋</span>
        <div class="vanish-granted">
          ${granted.map(a => `<img src="${awakenIcon(a)}" title="${awakenName(a)}">`).join('')}
        </div>
      `;
    } else {
      awakensHtml = allAw.map(a => `<img src="${awakenIcon(a)}" title="${awakenName(a)}">`).join('');
    }

    html += `
      <div class="result-assist-card ${needsDpsWarning ? 'dps-warning' : ''} ${isExcluded ? 'excluded-state' : ''} ${isDupLimited ? 'dup-limited-state' : ''}" data-monster-no="${m.no}" data-slot-idx="${i}">
        ${isExcluded ? `<button class="btn-restore-exclusion" data-no="${m.no}">除外解除</button>` : ''}
        ${isDupLimited ? '<div class="dup-limited-overlay">採用数制限済み</div>' : ''}
        <div class="assist-card-header">
          <span class="assist-slot-label">スロット${i + 1}${baseMon ? ` (${baseMon.name})` : ''}</span>
          <div class="assist-card-actions">
            <button class="btn-pin ${isPinned || (isMonsterPinnedAnywhere && !pinnedAssists[i]) ? 'pinned' : ''}" data-slot="${i}" data-no="${m.no}" title="${isPinned ? '固定解除' : 'このアシストを固定'}">
              ${isPinned || (isMonsterPinnedAnywhere && !pinnedAssists[i]) ? '📍固定中' : '📌'}
            </button>
            <button class="btn-exclude" data-no="${m.no}">❌ 除外</button>
          </div>
        </div>
        ${isDuplicate ? `<span class="dup-badge">🔁 複数採用（${dupCounts[m.no]}体）</span>` : ''}
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
          ${awakensHtml}
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
      const have = getVirtualCount(parseInt(id), assistCounts);
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
  const baseDisplay = document.getElementById('result-base-display');

  // ベースモンスター表示
  const hasBase = baseMonsters.some(b => b !== null);
  if (hasBase) {
    let baseHtml = '<div class="result-base-row">';
    for (let i = 0; i < 6; i++) {
      const b = baseMonsters[i];
      if (b) {
        const skill = getSkillInfo(b);
        const awakens = getActiveAwakens(b);
        baseHtml += `
          <div class="result-base-cell">
            <div class="rbc-label">スロット${i + 1} ベース</div>
            <div class="rbc-name" title="${b.name}">No.${b.no} ${b.name}</div>
            <div class="rbc-skill">
              ${skill ? `<strong>${skill.name}</strong><br>(CT:${skill.baseTurn}→${skill.minTurn})<br>${skill.description.substring(0, 30)}${skill.description.length > 30 ? '...' : ''}` : 'スキル不明'}
            </div>
            <div class="rbc-awakens">
              ${awakens.slice(0, 8).map(a => `<img src="${awakenIcon(a)}" title="${awakenName(a)}">`).join('')}
              ${awakens.length > 8 ? '...' : ''}
            </div>
          </div>`;
      } else {
        baseHtml += `
          <div class="result-base-cell">
            <div class="rbc-label">スロット${i + 1} ベース</div>
            <div class="rbc-name">未指定</div>
          </div>`;
      }
    }
    baseHtml += '</div>';
    baseDisplay.innerHTML = baseHtml;
  } else {
    baseDisplay.innerHTML = '';
  }

  // 15回表示に合わせ、FABを表示
  const fabRecalc = document.getElementById('fab-recalc');
  const fabBookmarks = document.getElementById('fab-bookmarks');
  if (fabRecalc) fabRecalc.style.display = 'block';
  if (fabBookmarks) {
    fabBookmarks.style.display = bookmarkedResults.length > 0 ? 'block' : 'none';
  }

  if (results.length === 0) {
    if (container) {
      container.innerHTML = '<div class="empty-state"><div class="emoji-lg">😢</div><p>条件を満たす組み合わせが見つかりませんでした</p></div>';
    }
    return;
  }

  // ソート：完全一致を優先しつつスコア順
  results.sort((a, b) => {
    const metA = isFullyMet(a) ? 1 : 0;
    const metB = isFullyMet(b) ? 1 : 0;
    if (metA !== metB) return metB - metA;
    return b.score - a.score;
  });

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

  // 固定セクションを更新
  updatePinnedUI();

  results.forEach((result, idx) => {
    const card = buildResultCard(result, idx, false);
    container.appendChild(card);
  });

  // ブックマーク表示を更新
  renderBookmarkSection();

  // イベント登録
  bindResultEvents(container, results);
}

function bindResultEvents(container, results) {
  // 除外ボタンイベント
  container.querySelectorAll('.btn-exclude').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const monsterNo = parseInt(btn.dataset.no);

      // 同種アシストON時: ポップアップで選択
      if (allowDuplicateAssists) {
        e.stopPropagation();
        showExcludeActionPopup(btn, monsterNo);
        return;
      }

      // OFF時: 従来通り即除外
      await performFullExclusion(monsterNo);
    });
  });

  // 除外解除イベント
  container.querySelectorAll('.btn-restore-exclusion').forEach(btn => {
    btn.addEventListener('click', () => {
      const monsterNo = parseInt(btn.dataset.no);
      restoreExclusion(monsterNo);
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
      const monsterNo = parseInt(btn.dataset.no);
      const monster = assistMonsters.find(m => m.no === monsterNo);
      if (!monster) return;

      if (pinnedAssists[slotIdx] && pinnedAssists[slotIdx].no === monsterNo) {
        delete pinnedAssists[slotIdx];
      } else {
        pinnedAssists[slotIdx] = monster;
      }

      // 表示中の全パターンの同一モンスターのバッジを同期更新
      // 同種採用時（同一パターン内で同じnoが複数スロットにいる場合）はスロット単位で独立制御
      const allSameMonsters = document.querySelectorAll(`.result-assist-card[data-monster-no="${monsterNo}"] .btn-pin`);
      const isCurrentMonsterPinnedAnywhere = Object.values(pinnedAssists).some(p => p.no === monsterNo);

      allSameMonsters.forEach(pinBtn => {
        const sIdx = parseInt(pinBtn.dataset.slot);
        const isActuallyPinnedInThisSlot = pinnedAssists[sIdx] && pinnedAssists[sIdx].no === monsterNo;

        // 同種複数採用の判定: このボタンの親パターン内で同じnoが複数あるか
        const parentPattern = pinBtn.closest('.result-pattern');
        const sameNoInPattern = parentPattern ? parentPattern.querySelectorAll(`.result-assist-card[data-monster-no="${monsterNo}"]`).length : 0;
        const isDupInPattern = sameNoInPattern > 1;

        if (isDupInPattern) {
          // 同種複数採用パターン: そのスロットの実際の固定状態のみを反映
          if (isActuallyPinnedInThisSlot) {
            pinBtn.classList.add('pinned');
            pinBtn.textContent = '📍固定中';
          } else {
            pinBtn.classList.remove('pinned');
            pinBtn.textContent = '📌';
          }
        } else {
          // 通常（同種なし）: 従来通り他スロットにも連動
          if (isActuallyPinnedInThisSlot || (isCurrentMonsterPinnedAnywhere && !pinnedAssists[sIdx])) {
            pinBtn.classList.add('pinned');
            pinBtn.textContent = '📍固定中';
          } else {
            pinBtn.classList.remove('pinned');
            pinBtn.textContent = '📌';
          }
        }
      });

      updatePinnedUI();
      // runOptimization(); // フィードバックに基づき自動計算を停止
    });
  });

  // ブックマークボタン
  container.querySelectorAll('.btn-bookmark-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const res = results ? results[idx] : null;
      if (!res) return;
      toggleBookmark(res, btn);
    });
  });

  updateExclusionUI();
}

function restoreExclusion(monsterNo) {
  excludedMonsterNos.delete(monsterNo);
  updateExclusionUI();
  // 表示のグレーアウトを解除
  document.querySelectorAll(`.result-assist-card[data-monster-no="${monsterNo}"]`).forEach(c => {
    c.classList.remove('excluded-state');
    const rb = c.querySelector('.btn-restore-exclusion');
    if (rb) rb.remove();
  });
}

function toggleBookmark(result, clickedBtn = null) {
  const sig = JSON.stringify(result.picks.map(p => p.no));
  const idx = bookmarkedResults.findIndex(b => JSON.stringify(b.picks.map(p => p.no)) === sig);
  const isAdding = idx < 0;

  if (isAdding) {
    bookmarkedResults.push(result);
  } else {
    bookmarkedResults.splice(idx, 1);
  }

  // 同一結果（同じモンスターNoの組み合わせ）を指すすべてのボタンの表示を同期
  // クオーテーションのエスケープに注意
  const escapedSig = sig.replace(/'/g, "\\'");
  const syncButtons = document.querySelectorAll(`.btn-bookmark-card[data-sig='${escapedSig}']`);

  syncButtons.forEach(btn => {
    btn.classList.toggle('active', isAdding);
    const textSpan = btn.querySelector('.btn-text');
    if (textSpan) {
      textSpan.textContent = isAdding ? 'ブックマーク解除' : 'ブックマーク';
    }
  });

  renderBookmarkSection();
  updateBookmarkFAB();
}

function renderBookmarkSection() {
  const section = document.getElementById('bookmark-section');
  const container = document.getElementById('bookmark-list-container');
  const countSpan = document.getElementById('bookmark-count');
  const modalList = document.getElementById('bookmark-modal-list');
  const emptyMsg = document.getElementById('bookmark-empty-msg');

  if (bookmarkedResults.length === 0) {
    if (section) section.style.display = 'none';
    if (emptyMsg) emptyMsg.style.display = 'block';
    if (modalList) modalList.innerHTML = '';
    return;
  }

  if (section) section.style.display = 'block';
  if (countSpan) countSpan.textContent = bookmarkedResults.length;
  if (emptyMsg) emptyMsg.style.display = 'none';

  const renderTo = (el) => {
    el.innerHTML = '';
    bookmarkedResults.forEach((res, i) => {
      const card = buildResultCard(res, i, false);
      // ブックマーク内はブックマークボタンのテキストを「ブックマーク解除」にする
      const bBtn = card.querySelector('.btn-bookmark-card');
      if (bBtn) {
        const textSpan = bBtn.querySelector('.btn-text');
        if (textSpan) textSpan.textContent = 'ブックマーク解除';
        bBtn.classList.add('active');
        bBtn.addEventListener('click', () => {
          toggleBookmark(res);
          // 両方のリストを再描画
          renderBookmarkSection();
          // メインの結果表示側のボタン状態もあれば同期させたいが、再描画されるので基本OK
        });
      }
      el.appendChild(card);
    });
  };

  if (container) renderTo(container);
  if (modalList) renderTo(modalList);
}

function updateBookmarkFAB() {
  const fab = document.getElementById('fab-bookmarks');
  if (!fab) return;

  const hasBookmarks = bookmarkedResults.length > 0;
  fab.style.display = hasBookmarks ? 'block' : 'none';

  if (hasBookmarks) {
    const btn = fab.querySelector('.fab-btn');
    if (!btn) return;

    // タイマーリセット（再展開）
    if (bookmarkFabTimer) clearTimeout(bookmarkFabTimer);
    btn.classList.remove('mini');

    // 1.5秒後に縮小
    bookmarkFabTimer = setTimeout(() => {
      btn.classList.add('mini');
      bookmarkFabTimer = null;
    }, 1500);
  }
}

function toggleBookmarkOverlay() {
  const modal = document.getElementById('bookmark-modal-overlay');
  if (!modal) return;
  const isShow = modal.style.display === 'flex';
  modal.style.display = isShow ? 'none' : 'flex';
  if (!isShow) renderBookmarkSection();
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

// ==================== 同種アシスト / 除外ポップアップ ====================

// 従来の除外処理を関数化
async function performFullExclusion(monsterNo) {
  const allSimilarCards = document.querySelectorAll(`.result-assist-card[data-monster-no="${monsterNo}"]`);
  allSimilarCards.forEach(c => c.classList.add('exclusion-effect'));

  await new Promise(r => setTimeout(r, 400));
  excludedMonsterNos.add(monsterNo);
  // 個別制限があれば削除（除外が優先）
  delete monsterDupLimits[monsterNo];

  allSimilarCards.forEach(c => {
    c.classList.remove('exclusion-effect');
    c.classList.add('excluded-state');
    if (!c.querySelector('.btn-restore-exclusion')) {
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'btn-restore-exclusion';
      restoreBtn.dataset.no = monsterNo;
      restoreBtn.textContent = '除外解除';
      restoreBtn.addEventListener('click', () => restoreExclusion(monsterNo));
      c.prepend(restoreBtn);
    }
  });

  updateExclusionUI();
  updateDupLimitUI();
}

// 除外アクション選択ポップアップ（同種アシストON時）
let activeExcludePopup = null;
function showExcludeActionPopup(anchorBtn, monsterNo) {
  hideExcludeActionPopup(); // 既存を閉じる

  const monster = allMonsters.find(m => m.no === monsterNo);
  const monsterName = monster ? monster.name : `No.${monsterNo}`;

  const popup = document.createElement('div');
  popup.className = 'exclude-action-popup show';
  popup.innerHTML = `
    <div class="popup-title" style="color:var(--accent-red)">
      <svg class="popup-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      ${monsterName}
    </div>

    <div class="exclude-action-btn change-limit" data-no="${monsterNo}">
      <div class="mode-icon-wrap" style="background:linear-gradient(135deg, #3b82f6, #6366f1); box-shadow:0 2px 12px rgba(59,130,246,0.4);">
        <svg class="mode-icon-svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
      </div>
      <div class="mode-text">
        <div class="mode-label">🔢 複数採用数の変更</div>
        <div class="mode-desc">このモンスターの最大採用数を変更</div>
      </div>
      <svg class="mode-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </div>

    <div class="exclude-action-btn full-exclude" data-no="${monsterNo}">
      <div class="mode-icon-wrap" style="background:linear-gradient(135deg, #ef4444, #dc2626); box-shadow:0 2px 12px rgba(239,68,68,0.4);">
        <svg class="mode-icon-svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
      </div>
      <div class="mode-text">
        <div class="mode-label">🚫 完全除外</div>
        <div class="mode-desc">候補から完全に除外する</div>
      </div>
      <svg class="mode-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </div>
  `;

  // ポップアップイベント
  popup.querySelector('.change-limit').addEventListener('click', (e) => {
    e.stopPropagation();
    showDupLimitSelector(popup, monsterNo, monsterName);
  });

  popup.querySelector('.full-exclude').addEventListener('click', async (e) => {
    e.stopPropagation();
    hideExcludeActionPopup();
    await performFullExclusion(monsterNo);
  });

  // アンカーの親カードに配置
  const card = anchorBtn.closest('.result-assist-card');
  if (card) {
    card.style.position = 'relative';
    card.appendChild(popup);
  }

  activeExcludePopup = popup;

  // 外部クリックで閉じる
  setTimeout(() => {
    document.addEventListener('click', handleExcludePopupOutsideClick);
  }, 10);
}

function handleExcludePopupOutsideClick(e) {
  if (activeExcludePopup && !activeExcludePopup.contains(e.target)) {
    hideExcludeActionPopup();
  }
}

function hideExcludeActionPopup() {
  if (activeExcludePopup) {
    activeExcludePopup.remove();
    activeExcludePopup = null;
  }
  document.removeEventListener('click', handleExcludePopupOutsideClick);
}

// 採用数選択UI（ポップアップ内に展開）
function showDupLimitSelector(popup, monsterNo, monsterName) {
  // ボタンを選択UIに置換
  const currentLimit = monsterDupLimits[monsterNo] !== undefined ? monsterDupLimits[monsterNo] : duplicateMaxCount;
  popup.innerHTML = `
    <div class="popup-title" style="color:var(--accent-blue)">
      <svg class="popup-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      ${monsterName}の最大採用数
    </div>
    <div class="dup-limit-selector">
      ${[1, 2, 3, 4, 5, 6].map(n => `
        <button class="dup-limit-option ${n === currentLimit ? 'active' : ''}" data-count="${n}">
          ${n}体
        </button>
      `).join('')}
    </div>
  `;

  popup.querySelectorAll('.dup-limit-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const count = parseInt(opt.dataset.count);
      applyDupLimit(monsterNo, count);
      hideExcludeActionPopup();
    });
  });
}

// 採用数制限を適用し、UIをリアルタイム反映
function applyDupLimit(monsterNo, maxCount) {
  monsterDupLimits[monsterNo] = maxCount;
  updateDupLimitUI();

  // 全パターンを走査して、制限超過分にグレーアウトを適用
  const allCards = document.querySelectorAll('.result-pattern');
  allCards.forEach(pattern => {
    const monCards = pattern.querySelectorAll(`.result-assist-card[data-monster-no="${monsterNo}"]`);
    let seen = 0;
    monCards.forEach(c => {
      seen++;
      if (seen > maxCount) {
        c.classList.add('dup-limited-state');
        if (!c.querySelector('.dup-limited-overlay')) {
          const overlay = document.createElement('div');
          overlay.className = 'dup-limited-overlay';
          overlay.textContent = '採用数制限済み';
          c.prepend(overlay);
        }
      } else {
        c.classList.remove('dup-limited-state');
        const existing = c.querySelector('.dup-limited-overlay');
        if (existing) existing.remove();
      }
    });
  });
}

// STEP3: 同種アシスト設定トグル
function toggleDuplicateAssists(checked) {
  allowDuplicateAssists = checked;
  const section = document.getElementById('duplicate-count-section');
  if (section) section.style.display = checked ? 'block' : 'none';
}

function updateDuplicateMaxCount(val) {
  const v = parseInt(val);
  if (v >= 2 && v <= 6) duplicateMaxCount = v;
}

// 採用数制限管理UI
function updateDupLimitUI() {
  const section = document.getElementById('dup-limit-manager-section');
  const container = document.getElementById('dup-limit-list-container');
  if (!section || !container) return;

  const entries = Object.entries(monsterDupLimits);
  if (entries.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  container.innerHTML = '';

  entries.forEach(([noStr, limit]) => {
    const no = parseInt(noStr);
    const m = allMonsters.find(mon => mon.no === no);
    if (!m) return;
    const div = document.createElement('div');
    div.className = 'exclusion-item';
    div.innerHTML = `
      <span class="ex-no">No.${m.no}</span>
      <span class="ex-name">${m.name}</span>
      <span class="dup-limit-count">${limit}体まで</span>
      <button class="btn-restore" data-no="${m.no}">↩️ 解除</button>
    `;
    div.querySelector('.btn-restore').addEventListener('click', () => {
      delete monsterDupLimits[no];
      updateDupLimitUI();
      // 制限解除をUI反映
      const allCards = document.querySelectorAll(`.result-assist-card[data-monster-no="${no}"]`);
      allCards.forEach(c => {
        c.classList.remove('dup-limited-state');
        const overlay = c.querySelector('.dup-limited-overlay');
        if (overlay) overlay.remove();
      });
    });
    container.appendChild(div);
  });
}

function clearAllDupLimits() {
  const nos = Object.keys(monsterDupLimits);
  monsterDupLimits = {};
  updateDupLimitUI();
  // 全カードの制限状態を解除
  nos.forEach(noStr => {
    const allCards = document.querySelectorAll(`.result-assist-card[data-monster-no="${noStr}"]`);
    allCards.forEach(c => {
      c.classList.remove('dup-limited-state');
      const overlay = c.querySelector('.dup-limited-overlay');
      if (overlay) overlay.remove();
    });
  });
}


function updatePinnedUI() {
  const section = document.getElementById('pinned-section');
  const list = document.getElementById('pinned-list');
  const optimizeSection = document.getElementById('optimize-section');
  if (!section || !list) return;

  const entries = Object.entries(pinnedAssists);
  if (entries.length === 0) {
    section.style.display = 'none';
    if (optimizeSection) optimizeSection.style.display = 'none';
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

  // 全6体固定時: 最適化セクションをアニメーション付きで表示
  if (optimizeSection) {
    if (entries.length === 6) {
      const wasHidden = optimizeSection.style.display === 'none' || !optimizeSection.style.display;
      optimizeSection.style.display = 'block';
      // 結果と進捗をクリア
      const results = document.getElementById('optimize-results');
      if (results) results.innerHTML = '';
      const prog = document.getElementById('optimize-progress');
      if (prog) prog.style.display = 'none';

      // 初回表示時: アニメーション + 自動スクロール
      if (wasHidden) {
        optimizeSection.classList.remove('optimize-unlock-anim');
        void optimizeSection.offsetWidth; // reflow
        optimizeSection.classList.add('optimize-unlock-anim');

        // バブルエフェクト
        const card = optimizeSection.querySelector('.optimize-card');
        if (card) {
          for (let b = 0; b < 8; b++) {
            const bubble = document.createElement('div');
            bubble.className = 'optimize-bubble';
            bubble.style.left = `${10 + Math.random() * 80}%`;
            bubble.style.animationDelay = `${Math.random() * 0.4}s`;
            bubble.style.animationDuration = `${0.6 + Math.random() * 0.4}s`;
            card.appendChild(bubble);
            setTimeout(() => bubble.remove(), 1200);
          }
        }

        // 自動スクロール
        setTimeout(() => {
          optimizeSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    } else {
      optimizeSection.style.display = 'none';
    }
  }
}

function clearAllPins() {
  pinnedAssists = {};
  updatePinnedUI();
  runOptimization();
}

function isFullyMet(state) {
  // アシストのみの覚醒カウントで充足を判定（上位互換対応）
  const counts = state.assistAwakenCounts || state.awakenCounts;
  for (const [id, cnt] of Object.entries(partyRequiredAwakens)) {
    if (getVirtualCount(parseInt(id), counts) < cnt) return false;
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

// ==================== 最適化検索（6体確定後の向上策） ====================

const OPTIMIZE_STRATEGIES = {
  fire: { label: '🔥 火力向上', targetAwakens: [], useDpsMult: true },
  heal: { label: '🩷 回復力向上', targetAwakens: [47, 104, 3], useDpsMult: false },
  tank: { label: '💪 耐久力向上', targetAwakens: [46, 4, 5, 6, 7, 8, 1], useDpsMult: false },
  operate: { label: '☝️ 操作性向上', targetAwakens: [53], useDpsMult: false },
};

/**
 * 現在のベースライン（6体固定状態）の覚醒カウント・SB・各スロット倍率を取得
 */
function getCurrentBaseline() {
  const awakenCounts = {};
  let totalSB = 0;
  const slotMultipliers = {};

  for (let i = 0; i < 6; i++) {
    const m = pinnedAssists[i];
    if (!m) continue;
    const active = getEffectiveAwakensForSearch(m);
    active.forEach(a => { awakenCounts[a] = (awakenCounts[a] || 0) + 1; });
    totalSB += getMonsterSB(m);
    if (slotConditions[i].skillUsable) {
      totalSB += getHasteTurns(m);
      if (delayAsSB) totalSB += getDelayTurns(m);
    }
    slotMultipliers[i] = calcDpsMultiplier(m);
  }

  return { awakenCounts, totalSB, slotMultipliers };
}

/**
 * 候補モンスターが覚醒要件・SB要件・火力倍率要件を維持しているかチェック
 */
function checkOptimizeConstraints(newPicks, baseline) {
  const newAwakenCounts = {};
  let newTotalSB = 0;

  for (let i = 0; i < 6; i++) {
    const m = newPicks[i];
    if (!m) continue;
    const active = getActiveAwakens(m);
    active.forEach(a => { newAwakenCounts[a] = (newAwakenCounts[a] || 0) + 1; });
    newTotalSB += getMonsterSB(m);
    if (slotConditions[i].skillUsable) {
      newTotalSB += getHasteTurns(m);
      if (delayAsSB) newTotalSB += getDelayTurns(m);
    }
  }

  // 覚醒要件チェック（アシスト合計で維持 — 上位互換対応）
  for (const [id, target] of Object.entries(partyRequiredAwakens)) {
    const aid = parseInt(id);
    const have = getVirtualCount(aid, newAwakenCounts);
    if (have < target) return false;
  }

  // SB要件チェック
  if (requiredSB > 0 && newTotalSB < requiredSB) return false;

  // 火力倍率: 各キャラごとに維持
  for (let i = 0; i < 6; i++) {
    const newMult = calcDpsMultiplier(newPicks[i]);
    if (newMult < baseline.slotMultipliers[i]) return false;
  }

  return true;
}

/**
 * 方針に応じた改善スコアを計算
 */
function calcOptimizeScore(newPicks, baseline, strategy) {
  const strat = OPTIMIZE_STRATEGIES[strategy];
  let score = 0;

  if (strategy === 'fire') {
    // 火力向上: 各スロットの倍率向上を評価
    for (let i = 0; i < 6; i++) {
      const newMult = calcDpsMultiplier(newPicks[i]);
      const oldMult = baseline.slotMultipliers[i];
      if (newMult > oldMult) {
        score += (newMult - oldMult) * 100;
      }
    }
  } else {
    // 対象覚醒の増分を評価
    const newAwakenCounts = {};
    for (let i = 0; i < 6; i++) {
      const m = newPicks[i];
      if (!m) continue;
      getActiveAwakens(m).forEach(a => { newAwakenCounts[a] = (newAwakenCounts[a] || 0) + 1; });
    }

    for (const aid of strat.targetAwakens) {
      const oldCount = baseline.awakenCounts[aid] || 0;
      const newCount = newAwakenCounts[aid] || 0;
      const diff = newCount - oldCount;
      if (diff > 0) {
        // 優先度の高い覚醒に高いウェイト
        const weight = (aid === strat.targetAwakens[0] || aid === strat.targetAwakens[1]) ? 100 : 50;
        score += diff * weight;
      }
    }
  }

  return score;
}

/**
 * 最適化検索メイン関数
 */
let optimizeStopRequested = false;

async function runOptimizeSearch(strategy) {
  const resultsEl = document.getElementById('optimize-results');
  const progressEl = document.getElementById('optimize-progress');
  const progressStatus = document.getElementById('optimize-progress-status');
  if (!resultsEl) return;

  optimizeStopRequested = false;
  resultsEl.innerHTML = '';
  if (progressEl) progressEl.style.display = 'block';
  if (progressStatus) progressStatus.textContent = '最適化検索中...';

  // FABをローディング状態に
  const fabBtn = document.getElementById('recalc-btn-el');
  const fabIconLoading = document.getElementById('recalc-icon-loading');
  const fabIconDefault = document.getElementById('recalc-icon-default');
  const fabIconStop = document.getElementById('recalc-icon-stop');
  const fabLabel = document.getElementById('recalc-label');
  if (fabBtn) {
    fabBtn.classList.add('mini', 'loading-state');
    fabBtn.classList.remove('hint-state', 'stop-state');
    if (fabIconLoading) fabIconLoading.style.display = 'flex';
    if (fabIconDefault) fabIconDefault.style.display = 'none';
    if (fabIconStop) fabIconStop.style.display = 'none';
  }
  // 1.5秒後にストップボタンに変化
  const fabHintTimer = setTimeout(() => {
    if (fabBtn && fabBtn.classList.contains('loading-state')) {
      fabBtn.classList.remove('mini', 'loading-state');
      fabBtn.classList.add('hint-state');
      if (fabIconLoading) fabIconLoading.style.display = 'none';
      if (fabIconStop) fabIconStop.style.display = 'flex';
      if (fabLabel) fabLabel.textContent = '最適化停止はここをクリック';
    }
  }, 1500);
  const fabStopTimer = setTimeout(() => {
    if (fabBtn && fabBtn.classList.contains('hint-state')) {
      fabBtn.classList.remove('hint-state');
      fabBtn.classList.add('mini', 'stop-state');
    }
  }, 4000);

  // FABクリックで停止
  const origOnclick = document.getElementById('fab-recalc')?.onclick;
  const fabRecalc = document.getElementById('fab-recalc');
  if (fabRecalc) {
    fabRecalc.onclick = () => {
      optimizeStopRequested = true;
      clearTimeout(fabHintTimer);
      clearTimeout(fabStopTimer);
      resetRecalcBtn();
      if (progressStatus) progressStatus.textContent = '検索を停止しました';
    };
  }

  // ボタンのアクティブ状態を更新
  document.querySelectorAll('.optimize-strategy-btn').forEach(btn => btn.classList.remove('active'));
  const clickedBtn = document.querySelector(`.optimize-strategy-btn.${strategy}`);
  if (clickedBtn) clickedBtn.classList.add('active');

  await new Promise(r => setTimeout(r, 50)); // UI更新待ち

  const baseline = getCurrentBaseline();
  const currentPicks = {};
  for (let i = 0; i < 6; i++) currentPicks[i] = pinnedAssists[i];

  const improvements = [];
  const usedNos = new Set(Object.values(pinnedAssists).map(m => m.no));

  // 1体入替パターン
  for (let i = 0; i < 6; i++) {
    const originalMonster = currentPicks[i];
    if (!originalMonster) continue;

    // 対象スロットの候補モンスターを取得（固定を一時的に解除してフィルタリング）
    const savedPin = pinnedAssists[i];
    delete pinnedAssists[i];
    const candidates = filterCandidatesForSlot(i);
    pinnedAssists[i] = savedPin;

    for (const candidate of candidates) {
      if (candidate.no === originalMonster.no) continue;
      if (usedNos.has(candidate.no) && candidate.no !== originalMonster.no) {
        // 他のスロットで使用中のモンスターは除外（ただし元のモンスターは除く）
        const isUsedElsewhere = Object.entries(pinnedAssists).some(
          ([idx, m]) => parseInt(idx) !== i && m.no === candidate.no
        );
        if (isUsedElsewhere) continue;
      }

      const newPicks = { ...currentPicks };
      newPicks[i] = candidate;

      if (!checkOptimizeConstraints(newPicks, baseline)) continue;

      const score = calcOptimizeScore(newPicks, baseline, strategy);
      if (score > 0) {
        improvements.push({
          slots: [i],
          before: [originalMonster],
          after: [candidate],
          score,
          newPicks,
        });
      }
    }

    // UI応答性のため定期的にyield
    if (i % 2 === 0) {
      if (progressStatus) progressStatus.textContent = `最適化検索中... スロット${i + 1}/6`;
      await new Promise(r => setTimeout(r, 0));
      if (optimizeStopRequested) break;
    }
  }

  // 2体入替パターン（全数探索 + 非同期yield）
  if (progressStatus) progressStatus.textContent = '最適化検索中... 2体入替パターン探索中';
  await new Promise(r => setTimeout(r, 0));

  let checkCount = 0;
  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 6; j++) {
      const origI = currentPicks[i];
      const origJ = currentPicks[j];
      if (!origI || !origJ) continue;

      // 候補取得（全数）
      const savedPinI = pinnedAssists[i];
      const savedPinJ = pinnedAssists[j];
      delete pinnedAssists[i];
      delete pinnedAssists[j];
      const candidatesI = filterCandidatesForSlot(i);
      const candidatesJ = filterCandidatesForSlot(j);
      pinnedAssists[i] = savedPinI;
      pinnedAssists[j] = savedPinJ;

      for (const ci of candidatesI) {
        if (optimizeStopRequested) break;
        if (ci.no === origI.no) continue;
        const isUsedElsewhereI = Object.entries(pinnedAssists).some(
          ([idx, m]) => parseInt(idx) !== i && parseInt(idx) !== j && m.no === ci.no
        );
        if (isUsedElsewhereI) continue;

        for (const cj of candidatesJ) {
          if (optimizeStopRequested) break;
          if (cj.no === origJ.no || cj.no === ci.no) continue;
          const isUsedElsewhereJ = Object.entries(pinnedAssists).some(
            ([idx, m]) => parseInt(idx) !== i && parseInt(idx) !== j && m.no === cj.no
          );
          if (isUsedElsewhereJ) continue;

          checkCount++;
          // 非同期yield: 5000回ごとにUIに制御を返す
          if (checkCount % 5000 === 0) {
            if (progressStatus) progressStatus.textContent = `最適化検索中... ${checkCount.toLocaleString()}件チェック済`;
            await new Promise(r => setTimeout(r, 0));
          }

          const newPicks = { ...currentPicks };
          newPicks[i] = ci;
          newPicks[j] = cj;

          if (!checkOptimizeConstraints(newPicks, baseline)) continue;

          const score = calcOptimizeScore(newPicks, baseline, strategy);
          if (score > 0) {
            improvements.push({
              slots: [i, j],
              before: [origI, origJ],
              after: [ci, cj],
              score,
              newPicks,
            });
          }
        }
      }

      if (optimizeStopRequested) break;
      await new Promise(r => setTimeout(r, 0));
    }
    if (optimizeStopRequested) break;
  }

  // スコア順でソート
  improvements.sort((a, b) => b.score - a.score);

  if (progressEl) progressEl.style.display = 'none';

  // FABをリセット & onclickを元に戻す
  clearTimeout(fabHintTimer);
  clearTimeout(fabStopTimer);
  resetRecalcBtn();
  if (fabRecalc && origOnclick) fabRecalc.onclick = origOnclick;

  // 結果表示
  displayOptimizeResults(improvements.slice(0, 10), baseline, strategy);
}

/**
 * BEFORE/AFTERカードで最適化結果を表示
 */
function displayOptimizeResults(results, baseline, strategy) {
  const container = document.getElementById('optimize-results');
  if (!container) return;
  container.innerHTML = '';

  const strat = OPTIMIZE_STRATEGIES[strategy];

  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:20px; text-align:center;">
        <div class="emoji-lg">😊</div>
        <p>現在の組み合わせが既に最適です！<br>${strat.label}の改善候補は見つかりませんでした。</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `<div class="optimize-results-header">
    <span class="strategy-badge ${strategy}">${strat.label}</span>
    <span style="color:var(--text-muted); font-size:0.82rem">${results.length}件の改善候補</span>
  </div>`;

  results.forEach((result, idx) => {
    const card = document.createElement('div');
    card.className = 'optimize-result-card';

    let slotsHtml = result.slots.map((slotIdx, k) => {
      const before = result.before[k];
      const after = result.after[k];
      const baseMon = baseMonsters[slotIdx];
      const beforeAwakens = getActiveAwakens(before);
      const afterAwakens = getActiveAwakens(after);
      const beforeSkill = getSkillInfo(before);
      const afterSkill = getSkillInfo(after);
      const beforeMult = calcDpsMultiplier(before);
      const afterMult = calcDpsMultiplier(after);
      const multDiff = afterMult - beforeMult;

      return `
        <div class="optimize-slot-row">
          <div class="optimize-slot-label">
            スロット${slotIdx + 1}${baseMon ? ` (${baseMon.name})` : ''}
          </div>
          <div class="optimize-compare">
            <div class="optimize-before">
              <div class="optimize-compare-label">BEFORE</div>
              <div class="optimize-mon-name">No.${before.no} ${before.name}</div>
              <div class="optimize-awakens">${beforeAwakens.map(a => `<img src="${awakenIcon(a)}" title="${awakenName(a)}">`).join('')}</div>
              ${beforeSkill ? `<div class="optimize-skill">${beforeSkill.name} (${beforeSkill.baseTurn}→${beforeSkill.minTurn})</div>` : ''}
              ${beforeMult > 1 ? `<div class="optimize-mult">倍率: x${beforeMult.toFixed(1)}</div>` : ''}
            </div>
            <div class="optimize-arrow">→</div>
            <div class="optimize-after">
              <div class="optimize-compare-label">AFTER</div>
              <div class="optimize-mon-name">No.${after.no} ${after.name}</div>
              <div class="optimize-awakens">${afterAwakens.map(a => `<img src="${awakenIcon(a)}" title="${awakenName(a)}">`).join('')}</div>
              ${afterSkill ? `<div class="optimize-skill">${afterSkill.name} (${afterSkill.baseTurn}→${afterSkill.minTurn})</div>` : ''}
              ${afterMult > 1 ? `<div class="optimize-mult ${multDiff > 0 ? 'improved' : ''}">倍率: x${afterMult.toFixed(1)}${multDiff > 0 ? ` (+${multDiff.toFixed(1)})` : ''}</div>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // 覚醒差分の計算
    const diffHtml = buildAwakenDiffHtml(result.newPicks, baseline, strategy);

    card.innerHTML = `
      <div class="optimize-card-header">
        <span class="optimize-rank">${idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}</span>
        <span class="optimize-score-label">改善スコア: ${result.score.toFixed(0)}</span>
      </div>
      ${slotsHtml}
      ${diffHtml}
      <div class="optimize-actions">
        <button class="btn btn-gold btn-sm btn-apply-optimize" data-idx="${idx}">✅ この変更を適用</button>
      </div>
    `;

    // 適用ボタンのイベント
    card.querySelector('.btn-apply-optimize').addEventListener('click', (e) => {
      const applyBtn = e.currentTarget;

      // pinnedAssistsを更新
      for (let i = 0; i < 6; i++) {
        pinnedAssists[i] = result.newPicks[i];
      }
      updatePinnedUI();

      // ボタンを「適用済み」に変更
      applyBtn.textContent = '✅ 適用済み';
      applyBtn.disabled = true;
      applyBtn.style.opacity = '0.6';

      // 結果をハイライト
      const stLabel = document.getElementById('optimize-progress-status');
      if (stLabel) {
        stLabel.textContent = '適用完了！';
      }

      // 適用された組み合わせパターンを結果カードとして表示
      const awakenCounts = {};
      const assistAwakenCounts = {};
      let sbTotal = 0;
      for (let i = 0; i < 6; i++) {
        const m = result.newPicks[i];
        if (!m) continue;
        // ベース覚醒を含むカウント
        const base = baseMonsters[i];
        if (base) {
          getBaseAwakensContribution(base).forEach(id => {
            if (id === 0 || id === 49) return;
            awakenCounts[id] = (awakenCounts[id] || 0) + 1;
          });
        }
        // アシスト覚醒カウント
        getActiveAwakens(m).forEach(a => {
          awakenCounts[a] = (awakenCounts[a] || 0) + 1;
          assistAwakenCounts[a] = (assistAwakenCounts[a] || 0) + 1;
        });
        // SB計算
        sbTotal += getMonsterSB(m);
        if (slotConditions[i].skillUsable) {
          sbTotal += getHasteTurns(m);
          if (delayAsSB) sbTotal += getDelayTurns(m);
        }
      }

      const appliedResult = {
        picks: result.newPicks,
        awakenCounts,
        assistAwakenCounts,
        score: 0,
        sbTotal
      };

      // 既存の適用結果表示を削除（再適用時の重複防止）
      const existingApplied = card.parentElement.querySelector('.optimize-applied-result');
      if (existingApplied) existingApplied.remove();

      // resultカードを生成して表示
      const appliedWrapper = document.createElement('div');
      appliedWrapper.className = 'optimize-applied-result';
      appliedWrapper.innerHTML = `
        <div class="section-title" style="margin-top:16px;font-size:0.9rem;color:var(--accent-gold)">
          <span class="emoji">📋</span> 適用された組み合わせ
        </div>
      `;
      const resultCard = buildResultCard(appliedResult, 0, false);
      appliedWrapper.appendChild(resultCard);
      card.after(appliedWrapper);

      // 表示位置にスクロール
      setTimeout(() => {
        appliedWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    });

    container.appendChild(card);
  });
}

/**
 * 覚醒差分HTMLを生成
 */
function buildAwakenDiffHtml(newPicks, baseline, strategy) {
  const newAwakenCounts = {};
  for (let i = 0; i < 6; i++) {
    const m = newPicks[i];
    if (!m) continue;
    getActiveAwakens(m).forEach(a => { newAwakenCounts[a] = (newAwakenCounts[a] || 0) + 1; });
  }

  // 全覚醒IDを集める（旧・新の両方）
  const allIds = new Set([
    ...Object.keys(baseline.awakenCounts).map(Number),
    ...Object.keys(newAwakenCounts).map(Number),
  ]);

  // 変化のある覚醒のみ抽出
  let diffItems = [];
  for (const aid of allIds) {
    const oldCount = baseline.awakenCounts[aid] || 0;
    const newCount = newAwakenCounts[aid] || 0;
    const diff = newCount - oldCount;
    if (diff !== 0) {
      diffItems.push({ id: aid, diff, oldCount, newCount });
    }
  }

  if (diffItems.length === 0) return '';

  // 増加を先、減少を後に並べる
  diffItems.sort((a, b) => b.diff - a.diff);

  const diffHtmlItems = diffItems.map(d => {
    const cls = d.diff > 0 ? 'optimize-diff-added' : 'optimize-diff-removed';
    const sign = d.diff > 0 ? '+' : '';
    return `<span class="${cls}"><img src="${awakenIcon(d.id)}" title="${awakenName(d.id)}">${d.oldCount}→${d.newCount}(${sign}${d.diff})</span>`;
  }).join('');

  return `<div class="optimize-diff-section">
    <span class="optimize-diff-label">覚醒合計変化:</span>
    ${diffHtmlItems}
  </div>`;
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
    console.log(`データ読込完了: 全${allMonsters.length} 体, アシスト候補${assistMonsters.length} 体, スキル${Object.keys(skillMap).length} 件`);
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

// FABクリックハンドラ
function handleRecalcClick(event) {
  const btn = document.getElementById('recalc-btn-el');

  // ポップアップ表示中はFABクリックを無視（ポップアップ内ボタンで処理）
  if (searchModePopupActive) return;

  triggerPopEffect(document.getElementById('fab-recalc'));

  if (btn && (btn.classList.contains('stop-state') || btn.classList.contains('hint-state'))) {
    stopOptimization();
    resetRecalcBtn();
  } else if (btn && btn.classList.contains('loading-state')) {
    // ローディング中はクリックを無視
    return;
  } else {
    // 固定3体以上の場合、検索モード選択ポップアップを表示
    const pinnedCount = Object.keys(pinnedAssists).length;
    if (pinnedCount >= 3) {
      showSearchModePopup();
    } else {
      searchModeFast = true; // 2体以下は常に高速（デフォルト）
      runOptimization();
    }
  }
}

// 検索モード選択ポップアップの表示
function showSearchModePopup() {
  searchModePopupActive = true;
  const popup = document.getElementById('search-mode-popup');
  const backdrop = document.getElementById('search-mode-backdrop');
  if (!popup || !backdrop) return;

  // ボタンをリセット
  popup.querySelectorAll('.search-mode-btn').forEach(b => {
    b.classList.remove('sucking', 'fade-away');
    b.style.display = 'flex';
  });

  popup.classList.remove('hide');
  popup.classList.add('show');
  backdrop.classList.remove('hide');
  backdrop.classList.add('show');
}

// 検索モード選択ポップアップの非表示
function hideSearchModePopup() {
  const popup = document.getElementById('search-mode-popup');
  const backdrop = document.getElementById('search-mode-backdrop');
  if (!popup || !backdrop) return;

  popup.classList.remove('show');
  popup.classList.add('hide');
  backdrop.classList.remove('show');
  backdrop.classList.add('hide');
  setTimeout(() => {
    popup.style.display = '';
    popup.classList.remove('hide');
    backdrop.style.display = '';
    backdrop.classList.remove('hide');
    searchModePopupActive = false;
  }, 350);
}

// 検索モード選択後の処理
function selectSearchMode(mode, clickedBtn) {
  // バブルエフェクト
  triggerPopEffect(clickedBtn);

  // もう一方をフェードアウト
  const popup = document.getElementById('search-mode-popup');
  popup.querySelectorAll('.search-mode-btn').forEach(b => {
    if (b !== clickedBtn) b.classList.add('fade-away');
  });

  // 選択ボタンを吸い込み
  setTimeout(() => {
    clickedBtn.classList.add('sucking');
  }, 100);

  // ポップアップ消去 & 計算開始
  setTimeout(() => {
    const backdrop = document.getElementById('search-mode-backdrop');
    popup.classList.remove('show');
    popup.classList.add('hide');
    if (backdrop) {
      backdrop.classList.remove('show');
      backdrop.classList.add('hide');
    }
  }, 500);

  setTimeout(() => {
    searchModePopupActive = false;
    // 検索モードをセット
    searchModeFast = (mode === 'fast');
    runOptimization();
  }, 700);
}

// 弾けるエフェクト
function triggerPopEffect(parent) {
  if (!parent) return;
  const colors = ['#8b5cf6', '#d946ef', '#f59e0b', '#10b981', '#3b82f6'];
  const count = 12;

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'burst-particle';
    const angle = (i / count) * Math.PI * 2;
    const dist = 40 + Math.random() * 40;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;

    p.style.setProperty('--tx', `${tx}px`);
    p.style.setProperty('--ty', `${ty}px`);
    p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    p.style.left = '50%';
    p.style.top = '50%';

    parent.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }
}

// 再計算ボタンの状態リセット
function resetRecalcBtn() {
  const btn = document.getElementById('recalc-btn-el');
  const label = document.getElementById('recalc-label');
  const iconDefault = document.getElementById('recalc-icon-default');
  const iconLoading = document.getElementById('recalc-icon-loading');
  const iconStop = document.getElementById('recalc-icon-stop');

  if (btn) {
    btn.classList.remove('fab-shrink', 'fab-expand', 'loading-state', 'stop-state', 'hint-state', 'mini');
    if (label) {
      label.textContent = '再計算';
      label.style.display = 'block';
    }
    if (iconDefault) iconDefault.style.display = 'block';
    if (iconLoading) iconLoading.style.display = 'none';
    if (iconStop) iconStop.style.display = 'none';
  }
  // ポップアップも非表示に
  hideSearchModePopup();
}
