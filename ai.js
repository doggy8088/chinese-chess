// ============================================================
// 中國象棋 AI 引擎 —— negamax + alpha-beta 剪枝 + 靜態搜索
// 純邏輯，可在 Web Worker 或主執行緒使用
// 難度：easy（淺層＋隨機）/ medium（3 層）/ hard（迭代加深至 6 層，殘局更深）
// 加強：置換表、killer/history 排序、將軍延伸、應將靜態搜索、重複局面偵測
// ============================================================
import { ROWS, COLS, RED, BLACK, getMoves, legalMoves, kingsFacing, kingPos, inCheck, hashBoard } from './game.js?v=4db85cd210';

const INF = 1e9;
const MATE = 100000;

// 子力基礎分（兵 20 為一個單位基準）
const VAL = { K: 10000, R: 200, C: 96, N: 88, B: 40, A: 40, P: 20 };

// ---------------- 位置加成表（以己方底線為 row 0，列左右對稱） ----------------
const P_PST = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [2, 4, 6, 8, 10, 8, 6, 4, 2],
  [10, 14, 18, 22, 26, 22, 18, 14, 10],
  [14, 20, 26, 32, 36, 32, 26, 20, 14],
  [16, 24, 32, 40, 44, 40, 32, 24, 16],
  [14, 22, 30, 38, 42, 38, 30, 22, 14],
  [6, 10, 14, 18, 20, 18, 14, 10, 6],
];
const N_PST = [
  [0, -4, 0, 0, 0, 0, 0, -4, 0],
  [0, 2, 4, 4, -2, 4, 4, 2, 0],
  [4, 6, 8, 8, 8, 8, 8, 6, 4],
  [2, 6, 8, 10, 6, 10, 8, 6, 2],
  [4, 12, 16, 14, 12, 14, 16, 12, 4],
  [6, 16, 14, 18, 18, 18, 14, 16, 6],
  [8, 24, 18, 24, 20, 24, 18, 24, 8],
  [12, 14, 16, 20, 18, 20, 16, 14, 12],
  [4, 10, 28, 16, 8, 16, 28, 10, 4],
  [4, 8, 16, 12, 4, 12, 16, 8, 4],
];
const R_PST = [
  [-2, 10, 6, 14, 12, 14, 6, 10, -2],
  [8, 4, 8, 16, 8, 16, 8, 4, 8],
  [4, 8, 6, 14, 12, 14, 6, 8, 4],
  [6, 10, 8, 14, 14, 14, 8, 10, 6],
  [12, 16, 14, 20, 20, 20, 14, 16, 12],
  [12, 14, 12, 18, 18, 18, 12, 14, 12],
  [12, 18, 16, 22, 22, 22, 16, 18, 12],
  [12, 12, 12, 18, 18, 18, 12, 12, 12],
  [16, 20, 18, 24, 26, 24, 18, 20, 16],
  [14, 14, 12, 18, 16, 18, 12, 14, 14],
];
const C_PST = [
  [0, 0, 2, 6, 6, 6, 2, 0, 0],
  [0, 2, 4, 6, 6, 6, 4, 2, 0],
  [4, 0, 8, 6, 10, 6, 8, 0, 4],
  [0, 0, 0, 2, 4, 2, 0, 0, 0],
  [-2, 0, 4, 2, 6, 2, 4, 0, -2],
  [0, 0, 0, 2, 8, 2, 0, 0, 0],
  [0, 0, -2, 4, 10, 4, -2, 0, 0],
  [0, 2, 4, 6, 12, 6, 4, 2, 0],
  [2, 2, 0, 8, 14, 8, 0, 2, 2],
  [4, 4, 0, 10, 12, 10, 0, 4, 4],
];

function pst(p, r, c) {
  const rr = p.side === RED ? r : 9 - r; // 換算成「距己方底線」的行數
  switch (p.type) {
    case 'P': return P_PST[rr][c];
    case 'N': return N_PST[rr][c];
    case 'R': return R_PST[rr][c];
    case 'C': return C_PST[rr][c];
    case 'A': return rr === 1 && c === 4 ? 3 : 0;
    case 'B': return rr === 2 && c === 4 ? 6 : rr === 0 ? 2 : 0;
    case 'K': return rr === 0 ? 2 : -6 * rr; // 將帥離底線越遠越危險
    default: return 0;
  }
}

const EVAL_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** 機動性：不配置陣列的輕量走法數（車：可走格數） */
function rookMobility(b, r, c) {
  let m = 0;
  for (const [dr, dc] of EVAL_DIRS) {
    let nr = r + dr, nc = c + dc;
    while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
      m++;
      if (b[nr][nc]) break;
      nr += dr; nc += dc;
    }
  }
  return m;
}

/** 炮：翻山前可移動格＋翻山後可吃的第一個子 */
function cannonMobility(b, r, c) {
  let m = 0;
  for (const [dr, dc] of EVAL_DIRS) {
    let nr = r + dr, nc = c + dc, screen = false;
    while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
      const p = b[nr][nc];
      if (!screen) {
        if (p) screen = true;
        else m++;
      } else if (p) { m++; break; }
      nr += dr; nc += dc;
    }
  }
  return m;
}

/** 馬：不蹩腿的落點數 */
function knightMobility(b, r, c) {
  let m = 0;
  for (const [dr, dc, leg] of N_STEPS) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
    if (b[r + leg[0]][c + leg[1]]) continue; // 蹩馬腿
    m++;
  }
  return m;
}

/** 王的直線受壓：敵車／炮與王同線且遮擋稀少（窺王） */
function filePressure(b, k, foe) {
  if (!k) return 0;
  let pen = 0;
  for (const dir of [1, -1]) {
    let r = k.r + dir, blockers = 0;
    while (r >= 0 && r < ROWS) {
      const p = b[r][k.c];
      if (p) {
        if (p.side === foe) {
          if (p.type === 'R') pen += blockers === 0 ? 16 : 8;
          else if (p.type === 'C' && blockers === 1) pen += 10;
          break;
        }
        if (++blockers > 2) break;
      }
      r += dir;
    }
  }
  return pen;
}

/** 兵：過河後的通頭兵加成＋兵臨城下（逼近敵帥） */
function pawnBonus(b, r, c, side, ek) {
  const rr = side === RED ? r : 9 - r;
  if (rr < 5) return 0;
  const fwd = side === RED ? 1 : -1;
  let v = 0;
  let passed = true;
  for (let r2 = r + fwd; r2 >= 0 && r2 < ROWS; r2 += fwd) {
    const p = b[r2][c];
    if (p && p.type === 'P' && p.side !== side) { passed = false; break; }
  }
  if (passed) v += 8;
  if (ek) {
    const dist = Math.max(Math.abs(r - ek.r), Math.abs(c - ek.c));
    if (dist <= 2) v += 10;
  }
  return v;
}

/** 全盤評估：紅方視角（紅多為正）
 *  子力＋位置表＋機動性（車炮馬）＋士象完整度＋窺王壓力＋兵陣 */
export function evaluate(b) {
  let s = 0;
  const kings = { [RED]: null, [BLACK]: null };
  const guards = { [RED]: 0, [BLACK]: 0 };
  const bishops = { [RED]: 0, [BLACK]: 0 };
  const pawns = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p) continue;
      let v = VAL[p.type] + pst(p, r, c);
      if (p.type === 'R') v += rookMobility(b, r, c);
      else if (p.type === 'C') v += cannonMobility(b, r, c) >> 1;
      else if (p.type === 'N') v += knightMobility(b, r, c) * 2;
      else if (p.type === 'A') guards[p.side]++;
      else if (p.type === 'B') bishops[p.side]++;
      else if (p.type === 'P') pawns.push(p.side, r, c);
      else if (p.type === 'K') kings[p.side] = { r, c };
      s += p.side === RED ? v : -v;
    }
  // 士象完整度：缺仕缺象會被車炮趁虛而入
  s -= (2 - guards[RED]) * 10 + (2 - bishops[RED]) * 8;
  s += (2 - guards[BLACK]) * 10 + (2 - bishops[BLACK]) * 8;
  // 窺王：敵車／炮與我王同線且遮擋稀少
  s -= filePressure(b, kings[RED], BLACK);
  s += filePressure(b, kings[BLACK], RED);
  // 兵陣：通頭兵、兵臨城下
  for (let i = 0; i < pawns.length; i += 3) {
    const side = pawns[i], r = pawns[i + 1], c = pawns[i + 2];
    const v = pawnBonus(b, r, c, side, kings[side === RED ? BLACK : RED]);
    s += side === RED ? v : -v;
  }
  return s;
}

const other = (side) => (side === RED ? BLACK : RED);
const evalFor = (b, side) => (side === RED ? evaluate(b) : -evaluate(b));

// ---------------- Zobrist 雜湊（置換表用） ----------------
const TYPE_ID = { K: 0, A: 1, B: 2, N: 3, R: 4, C: 5, P: 6 };
const PIECE_IDX = { [RED]: {}, [BLACK]: {} };
for (const [t, i] of Object.entries(TYPE_ID)) {
  PIECE_IDX[RED][t] = i;
  PIECE_IDX[BLACK][t] = i + 7;
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}
const zrnd = mulberry32(0x1A2B3C4D);
const ZA = [], ZB = [];
for (let i = 0; i < 14; i++) {
  ZA.push(Array.from({ length: 90 }, () => zrnd() & 0x1FFFFF)); // 21-bit，確保組合鍵不超過 2^53
  ZB.push(Array.from({ length: 90 }, () => zrnd() >>> 0));
}
const SIDE_A = zrnd() & 0x1FFFFF, SIDE_B = zrnd() >>> 0;
let za = 0, zb = 0;

function initZobrist(b, side) {
  za = 0; zb = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p) continue;
      const i = PIECE_IDX[p.side][p.type], s = r * 9 + c;
      za ^= ZA[i][s]; zb ^= ZB[i][s];
    }
  if (side === BLACK) { za ^= SIDE_A; zb ^= SIDE_B; }
}

/** 產生某方所有伪合法著法（含飛將吃王，送將由搜索以「被吃王」懲罰） */
function genMoves(b, side) {
  const out = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p || p.side !== side) continue;
      for (const m of getMoves(b, r, c)) out.push({ fr: r, fc: c, tr: m.r, tc: m.c });
    }
  if (kingsFacing(b)) {
    const k = kingPos(b, side), ek = kingPos(b, other(side));
    if (k && ek) out.push({ fr: k.r, fc: k.c, tr: ek.r, tc: ek.c });
  }
  return out;
}

const make = (b, m) => {
  const p = b[m.fr][m.fc];
  const cap = b[m.tr][m.tc];
  b[m.tr][m.tc] = p;
  b[m.fr][m.fc] = null;
  const pi = PIECE_IDX[p.side][p.type];
  za ^= ZA[pi][m.fr * 9 + m.fc] ^ ZA[pi][m.tr * 9 + m.tc];
  zb ^= ZB[pi][m.fr * 9 + m.fc] ^ ZB[pi][m.tr * 9 + m.tc];
  if (cap) {
    const ci = PIECE_IDX[cap.side][cap.type];
    za ^= ZA[ci][m.tr * 9 + m.tc];
    zb ^= ZB[ci][m.tr * 9 + m.tc];
  }
  za ^= SIDE_A; zb ^= SIDE_B;
  return cap;
};
const unmake = (b, m, cap) => {
  const p = b[m.tr][m.tc];
  b[m.fr][m.fc] = p;
  b[m.tr][m.tc] = cap;
  const pi = PIECE_IDX[p.side][p.type];
  za ^= ZA[pi][m.fr * 9 + m.fc] ^ ZA[pi][m.tr * 9 + m.tc];
  zb ^= ZB[pi][m.fr * 9 + m.fc] ^ ZB[pi][m.tr * 9 + m.tc];
  if (cap) {
    const ci = PIECE_IDX[cap.side][cap.type];
    za ^= ZA[ci][m.tr * 9 + m.tc];
    zb ^= ZB[ci][m.tr * 9 + m.tc];
  }
  za ^= SIDE_A; zb ^= SIDE_B;
};

/** MVV-LVA ＋ 置換表著法 ＋ killer/history：先吃大子、用小子吃 */
const sameMove = (a, m2) => a && a.fr === m2.fr && a.fc === m2.fc && a.tr === m2.tr && a.tc === m2.tc;
let killers = [];
let histH = { [RED]: {}, [BLACK]: {} };

function orderMoves(b, moves, ttMove, side, ply) {
  for (const m of moves) {
    if (ttMove && sameMove(ttMove, m)) { m.o = 1e9; continue; }
    const v = b[m.tr][m.tc];
    if (v) { m.o = VAL[v.type] * 8 - VAL[b[m.fr][m.fc].type]; continue; }
    const k = killers[ply];
    if (sameMove(k && k[0], m)) { m.o = 1e6; continue; }
    if (sameMove(k && k[1], m)) { m.o = 1e6 - 1; continue; }
    m.o = histH[side][b[m.fr][m.fc].type + (m.tr * 9 + m.tc)] || 0;
  }
  moves.sort((a, b2) => b2.o - a.o);
}

// ---------------- 搜索 ----------------
const TIMEOUT = Symbol('timeout');
let deadline = 0;
let nodes = 0;

/** 快速判斷 side 是否被將軍（與 game.js inCheck 等價，但直接掃攻擊線，供搜索內層使用） */
const N_STEPS = [[-2, -1, [-1, 0]], [-2, 1, [-1, 0]], [-1, 2, [0, 1]], [-1, -2, [0, -1]], [1, 2, [0, 1]], [1, -2, [0, -1]], [2, 1, [1, 0]], [2, -1, [1, 0]]];
function inCheckFast(b, side) {
  const foe = other(side);
  const k = kingPos(b, side);
  if (!k) return true;
  if (kingsFacing(b)) return true;
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let r = k.r + dr, c = k.c + dc, screen = false;
    while (r >= 0 && r < 10 && c >= 0 && c < 9) {
      const p = b[r][c];
      if (!screen) {
        if (p) {
          if (p.side === foe && p.type === 'R') return true;
          screen = true;
        }
      } else if (p) {
        if (p.side === foe && p.type === 'C') return true;
        break;
      }
      r += dr; c += dc;
    }
  }
  for (const [dr, dc, leg] of N_STEPS) {
    const nr = k.r - dr, nc = k.c - dc;
    if (nr < 0 || nr >= 10 || nc < 0 || nc >= 9) continue;
    const p = b[nr][nc];
    if (p && p.side === foe && p.type === 'N' && !b[nr + leg[0]][nc + leg[1]]) return true;
  }
  const dir = foe === RED ? 1 : -1;
  for (const [dr, dc] of [[-dir, 0], [0, 1], [0, -1]]) {
    const nr = k.r + dr, nc = k.c + dc;
    if (nr < 0 || nr >= 10 || nc < 0 || nc >= 9) continue;
    const p = b[nr][nc];
    if (!p || p.side !== foe || p.type !== 'P') continue;
    if (dc !== 0) { // 側面攻擊須過河
      const crossed = foe === RED ? nr >= 5 : nr <= 4;
      if (!crossed) continue;
    }
    return true;
  }
  return false;
}

const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;
let TT = new Map();

function checkTime() {
  if (deadline && (++nodes & 1023) === 0 && Date.now() > deadline) throw TIMEOUT;
}

function quiesce(b, side, alpha, beta, ply) {
  checkTime();
  const moves = genMoves(b, side);
  // 能直接吃到對方將帥（含飛將）＝殺
  for (const m of moves) {
    const t = b[m.tr][m.tc];
    if (t && t.type === 'K') return MATE - ply;
  }
  const checked = inCheckFast(b, side);
  let best, stand = 0;
  if (checked) {
    // 被將軍時不能「站著估值」，必須展開所有應將著法，否則看不見連將殺
    if (ply > 32) return evalFor(b, side);
    best = -INF;
  } else {
    stand = evalFor(b, side);
    if (ply > 24) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    best = stand;
  }
  const cands = checked ? moves : moves.filter((m) => b[m.tr][m.tc]);
  orderMoves(b, cands, null, side, ply);
  for (const m of cands) {
    const cap = b[m.tr][m.tc];
    if (!checked && cap && stand + VAL[cap.type] + 60 < alpha) continue; // delta 剪枝
    make(b, m);
    const sc = -quiesce(b, other(side), -beta, -alpha, ply + 1);
    unmake(b, m, cap);
    if (sc > best) best = sc;
    if (sc > alpha) alpha = sc;
    if (alpha >= beta) break;
  }
  if (checked && best === -INF) return -MATE + ply; // 無路可解＝被將死
  return best;
}

function negamax(b, side, depth, alpha, beta, ply) {
  checkTime();
  const checked = inCheckFast(b, side);
  if (checked && ply < 32) depth++; // 將軍延伸：連將殺與解殺看得更遠
  if (depth <= 0) return quiesce(b, side, alpha, beta, ply);

  const key = za * 4294967296 + zb;
  const hit = TT.get(key);
  let ttMove = null;
  if (hit) {
    ttMove = hit.m;
    if (hit.d >= depth) {
      let s = hit.s;
      if (s > MATE - 1000) s -= ply; else if (s < -(MATE - 1000)) s += ply;
      if (hit.f === TT_EXACT) return s;
      if (hit.f === TT_LOWER && s >= beta) return s;
      if (hit.f === TT_UPPER && s <= alpha) return s;
    }
  }

  const moves = genMoves(b, side);
  if (!moves.length) return -MATE + ply; // 無子可動：將死或困斃皆輸
  orderMoves(b, moves, ttMove, side, ply);
  let best = -INF, bestM = moves[0], flag = TT_UPPER;
  for (const m of moves) {
    const cap = b[m.tr][m.tc];
    if (cap && cap.type === 'K') return MATE - ply;
    make(b, m);
    const sc = -negamax(b, other(side), depth - 1, -beta, -alpha, ply + 1);
    unmake(b, m, cap);
    if (sc > best) { best = sc; bestM = m; }
    if (sc > alpha) { alpha = sc; flag = TT_EXACT; }
    if (alpha >= beta) {
      flag = TT_LOWER;
      if (!cap) { // 安靜著法致截斷：記 killer 與 history
        const k = killers[ply] || (killers[ply] = []);
        if (!sameMove(k[0], m)) { k[1] = k[0]; k[0] = { fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc }; }
        const hk = b[m.fr][m.fc].type + (m.tr * 9 + m.tc);
        histH[side][hk] = Math.min((histH[side][hk] || 0) + depth * depth, 5000);
      }
      break;
    }
  }
  let sStore = best;
  if (sStore > MATE - 1000) sStore += ply; else if (sStore < -(MATE - 1000)) sStore -= ply;
  TT.set(key, { d: depth, s: sStore, f: flag, m: bestM });
  return best;
}

// ---------------- 難度設定 ----------------
// window：與最佳著法分差在此範圍內的著法隨機挑選（兼顧變化與強度）
const LEVELS = {
  easy:   { maxDepth: 1, timeMs: 400,  window: 50, randomRate: 0.3 },
  medium: { maxDepth: 3, timeMs: 900,  window: 8,  randomRate: 0 },
  hard:   { maxDepth: 6, timeMs: 4500, window: 0,  randomRate: 0 },
};

/**
 * 找出 side 方的最佳著法。
 * @param {Array} recent 近期局面雜湊（hashBoard 字串），會懲罰走回原局面的著法
 * @returns {{from:{r,c}, to:{r,c}, score:number, depth:number}|null} 無合法著法時回 null
 */
export function findBestMove(srcBoard, side, level = 'medium', recent = []) {
  const cfg = LEVELS[level] || LEVELS.medium;
  let b = srcBoard.map((row) => row.map((p) => (p ? { type: p.type, side: p.side } : null)));

  // 根節點只考慮「嚴格合法」的著法（不送將、不對臉）
  const rootMoves = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p || p.side !== side) continue;
      for (const m of legalMoves(b, r, c)) rootMoves.push({ fr: r, fc: c, tr: m.r, tc: m.c });
    }
  if (!rootMoves.length) return null;

  const fmt = (m, score, depth) => ({ from: { r: m.fr, c: m.fc }, to: { r: m.tr, c: m.tc }, score, depth });

  // 簡單模式：一定機率直接亂走
  if (cfg.randomRate && Math.random() < cfg.randomRate) {
    return fmt(rootMoves[(Math.random() * rootMoves.length) | 0], 0, 0);
  }

  // 殘局子少時加深搜索
  let pieceCount = 0;
  for (const row of b) for (const p of row) if (p) pieceCount++;
  let maxDepth = cfg.maxDepth;
  if (level === 'hard') {
    if (pieceCount <= 6) maxDepth = Math.max(maxDepth, 12);       // 子少分支小，可深算
    else if (pieceCount <= 10) maxDepth += 2;
  } else if (level === 'medium' && pieceCount <= 8) maxDepth += 1;

  nodes = 0;
  deadline = Date.now() + cfg.timeMs;
  TT = new Map();
  killers = [];
  histH = { [RED]: {}, [BLACK]: {} };
  initZobrist(b, side);
  let scored = rootMoves.map((m) => ({ m, score: 0 }));
  let completed = 0;
  const freshBoard = () => {
    const nb = srcBoard.map((row) => row.map((p) => (p ? { type: p.type, side: p.side } : null)));
    initZobrist(nb, side);
    return nb;
  };

  for (let d = 1; d <= maxDepth; d++) {
    const iter = [];
    let alpha = -INF;
    try {
      for (const e of scored) {
        const cap = make(b, e.m);
        let sc = -negamax(b, other(side), d - 1, -INF, -alpha, 1);
        // sc === alpha 可能只是提前截斷的界值（非精確分數），全窗口重搜確認，
        // 避免假分數與真殺著同分而被誤選
        if (sc === alpha && alpha > -INF) {
          sc = -negamax(b, other(side), d - 1, -INF, INF, 1);
        }
        unmake(b, e.m, cap);
        iter.push({ m: e.m, score: sc });
        if (sc > alpha) alpha = sc;
      }
    } catch (err) {
      if (err !== TIMEOUT) throw err;
      // 逾時例外會跳過搜索內層的 make/unmake，直接換新盤面
      b = freshBoard();
      break;
    }
    iter.sort((a, b2) => b2.score - a.score);
    scored = iter;
    completed = d;
    if (scored[0].score > MATE - 200) break; // 已見必殺，不必再深
  }
  deadline = 0;

  // 沒有殺棋時：把接近最佳的著法以全窗口重搜，取得精確分數再隨機挑選。
  // （窄窗口下的 fail-low 分數只是上界，直接拿來挑會誤選弱著）
  if (completed >= 1 && scored[0].score <= MATE - 200 && cfg.window > 0) {
    const topScore = scored[0].score;
    const near = scored.filter((e) => topScore - e.score <= cfg.window).slice(0, 6);
    try {
      deadline = Date.now() + cfg.timeMs;
      for (const e of near) {
        const cap = make(b, e.m);
        e.score = -negamax(b, other(side), completed - 1, -INF, INF, 1);
        unmake(b, e.m, cap);
      }
    } catch (err) {
      b = freshBoard();
      if (err !== TIMEOUT) throw err;
    }
    deadline = 0;
    near.sort((a, b2) => b2.score - a.score);
    // 會走回近期出現過局面的著法扣分，避免殘局來回搗棋（殺棋不受影響）
    if (recent && recent.length) {
      const seen = new Map();
      for (const h of recent) seen.set(h, (seen.get(h) || 0) + 1);
      for (const e of near) {
        if (Math.abs(e.score) > MATE - 200) continue;
        const cap = make(b, e.m);
        const h = hashBoard(b);
        unmake(b, e.m, cap);
        const n = seen.get(h) || 0;
        if (n) e.score -= 12 * n;
      }
      near.sort((a, b2) => b2.score - a.score);
    }
    const best = near[0].score;
    const top = near.filter((e) => best - e.score <= cfg.window);
    const pick = top[(Math.random() * top.length) | 0];
    return fmt(pick.m, pick.score, completed);
  }

  // 會走回近期出現過局面的著法扣分，避免殘局來回搗棋（殺棋不受影響）
  if (recent && recent.length) {
    const seen = new Map();
    for (const h of recent) seen.set(h, (seen.get(h) || 0) + 1);
    for (const e of scored) {
      if (Math.abs(e.score) > MATE - 200) continue;
      const cap = make(b, e.m);
      const h = hashBoard(b);
      unmake(b, e.m, cap);
      const n = seen.get(h) || 0;
      if (n) e.score -= 12 * n;
    }
    scored.sort((a, b2) => b2.score - a.score);
  }

  // hard（window=0）或有殺棋：直接取最佳著法（同分著法隨機）
  const topScore = scored[0].score;
  const top = scored.filter((e) => e.score === topScore);
  const pick = top[(Math.random() * top.length) | 0];
  return fmt(pick.m, pick.score, completed);
}
