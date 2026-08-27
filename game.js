// ============================================================
// 中國象棋規則引擎（純邏輯，不依賴 three.js）
// 棋盘坐标：row 0 = 紅方底线（下方），row 9 = 黑方底线（上方）
// col 0..8 从左到右
// ============================================================

export const ROWS = 10;
export const COLS = 9;
export const RED = 'red';
export const BLACK = 'black';

const RED_NAMES =   { K: '帥', A: '仕', B: '相', N: '傌', R: '俥', C: '炮', P: '兵' };
const BLACK_NAMES = { K: '將', A: '士', B: '象', N: '馬', R: '車', C: '砲', P: '卒' };

export function name(side, type) {
  return (side === RED ? RED_NAMES : BLACK_NAMES)[type];
}

export function initialBoard() {
  const b = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const back = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
  for (let c = 0; c < COLS; c++) {
    b[0][c] = { type: back[c], side: RED };
    b[9][c] = { type: back[c], side: BLACK };
  }
  b[2][1] = { type: 'C', side: RED };
  b[2][7] = { type: 'C', side: RED };
  b[7][1] = { type: 'C', side: BLACK };
  b[7][7] = { type: 'C', side: BLACK };
  for (const c of [0, 2, 4, 6, 8]) {
    b[3][c] = { type: 'P', side: RED };
    b[6][c] = { type: 'P', side: BLACK };
  }
  return b;
}

const inb = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

/** 某棋子所有“伪合法”走法（含吃子，未过滤送将/对脸） */
export function getMoves(b, r, c) {
  const p = b[r][c];
  if (!p) return [];
  const out = [];
  const side = p.side;
  const foe = side === RED ? BLACK : RED;
  const add = (r, c) => out.push({ r, c });
  const target = (r, c) => {
    if (!inb(r, c)) return false;
    const t = b[r][c];
    if (t === null) { add(r, c); return true; }
    if (t.side === foe) add(r, c);
    return false;
  };

  switch (p.type) {
    case 'K': {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (!inb(nr, nc)) continue;
        if (nc < 3 || nc > 5) continue;
        const inPalace = side === RED ? (nr >= 0 && nr <= 2) : (nr >= 7 && nr <= 9);
        if (!inPalace) continue;
        target(nr, nc);
      }
      break;
    }
    case 'A': {
      const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (!inb(nr, nc)) continue;
        if (nc < 3 || nc > 5) continue;
        const inPalace = side === RED ? (nr >= 0 && nr <= 2) : (nr >= 7 && nr <= 9);
        if (!inPalace) continue;
        target(nr, nc);
      }
      break;
    }
    case 'B': {
      const dirs = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (!inb(nr, nc)) continue;
        const onOwnSide = side === RED ? nr <= 4 : nr >= 5;
        if (!onOwnSide) continue;
        if (b[r + dr / 2][c + dc / 2]) continue; // 塞象眼
        target(nr, nc);
      }
      break;
    }
    case 'N': {
      const steps = [
        [-2, -1, [-1, 0]], [-2, 1, [-1, 0]],
        [-1, 2, [0, 1]],   [-1, -2, [0, -1]],
        [1, 2, [0, 1]],    [1, -2, [0, -1]],
        [2, 1, [1, 0]],    [2, -1, [1, 0]],
      ];
      for (const [dr, dc, leg] of steps) {
        const nr = r + dr, nc = c + dc;
        if (!inb(nr, nc)) continue;
        if (b[r + leg[0]][c + leg[1]]) continue; // 蹩馬腿
        target(nr, nc);
      }
      break;
    }
    case 'R': {
      slideMoves(b, r, c, out, side, foe, false);
      break;
    }
    case 'C': {
      slideMoves(b, r, c, out, side, foe, true);
      break;
    }
    case 'P': {
      const dir = side === RED ? 1 : -1; // 紅向上（row 增大），黑向下
      if (inb(r + dir, c)) target(r + dir, c);
      const crossed = side === RED ? r >= 5 : r <= 4; // 过河后可横走
      if (crossed) {
        if (inb(r, c - 1)) target(r, c - 1);
        if (inb(r, c + 1)) target(r, c + 1);
      }
      break;
    }
  }
  return out;
}

function slideMoves(b, r, c, out, side, foe, isCannon) {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dr, dc] of dirs) {
    let nr = r + dr, nc = c + dc;
    let mounted = false; // 炮是否已翻过炮架
    while (inb(nr, nc)) {
      const t = b[nr][nc];
      if (t === null) {
        if (!isCannon || !mounted) out.push({ r: nr, c: nc });
      } else if (!mounted) {
        if (isCannon) {
          mounted = true; // 炮：記下砲架繼續向前
        } else {
          if (t.side === foe) out.push({ r: nr, c: nc }); // 車：吃掉第一個敵子
          break;
        }
      } else {
        if (t.side === foe) out.push({ r: nr, c: nc }); // 炮翻山吃子
        break;
      }
      nr += dr; nc += dc;
    }
  }
}

/** 雙方將/帥同一列且中間無子（對臉/飛將） */
export function kingsFacing(b) {
  const rk = kingPos(b, RED), bk = kingPos(b, BLACK);
  if (!rk || !bk) return false;
  if (rk.c !== bk.c) return false;
  const lo = Math.min(rk.r, bk.r), hi = Math.max(rk.r, bk.r);
  for (let r = lo + 1; r < hi; r++) if (b[r][rk.c]) return false;
  return true;
}

export function kingPos(b, side) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (p && p.type === 'K' && p.side === side) return { r, c };
    }
  return null;
}

/** 局面雜湊字串（用於重複局面偵測） */
export function hashBoard(b) {
  let s = '';
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      s += p ? p.type + (p.side === RED ? 'r' : 'b') : '.';
    }
  return s;
}

/** 某一方是否被將（含白臉將：將帥同列相照） */
export function inCheck(b, side) {
  if (kingsFacing(b)) return true;
  const k = kingPos(b, side);
  if (!k) return true;
  const foe = side === RED ? BLACK : RED;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p || p.side !== foe) continue;
      for (const m of getMoves(b, r, c))
        if (m.r === k.r && m.c === k.c) return true;
    }
  return false;
}

/** 過濾後真正合法的走法（不送將、不對臉） */
export function legalMoves(b, r, c) {
  const p = b[r][c];
  if (!p) return [];
  return getMoves(b, r, c).filter((m) => {
    const nb = b.map((row) => row.slice());
    nb[m.r][m.c] = p;
    nb[r][c] = null;
    return !inCheck(nb, p.side) && !kingsFacing(nb);
  });
}

/** 執行一步棋，回被吃的子（null 表示沒吃到） */
export function applyMove(b, from, to) {
  const captured = b[to.r][to.c];
  b[to.r][to.c] = b[from.r][from.c];
  b[from.r][from.c] = null;
  return captured;
}

export function hasAnyLegalMove(b, side) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (p && p.side === side && legalMoves(b, r, c).length > 0) return true;
    }
  return false;
}

// ---------------- 棋譜 notation ----------------
// 普通記錄法：
//   平（橫走）/ 斜走（傌象仕）：第四字＝到達的線路號
//   直線進退（車炮將兵）：第四字＝進退的格數
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 生成傳統棋譜，例如「傌八進七」「炮二平五」「兵五進一」 */
export function notation(b, from, to) {
  const p = b[from.r][from.c];
  if (!p) return '?';
  const side = p.side;
  const fileOf = (c) => (side === RED ? 9 - c : c + 1);
  const head = name(side, p.type);
  const f1 = CN[fileOf(from.c)];
  if (from.c === to.c) {
    // 直線進退：格數
    const steps = Math.abs(to.r - from.r);
    const advancing = (side === RED) ? to.r > from.r : to.r < from.r;
    return `${head}${f1}${advancing ? '進' : '退'}${CN[steps]}`;
  }
  if (to.r === from.r) {
    return `${head}${f1}平${CN[fileOf(to.c)]}`;
  }
  const advancing = (side === RED) ? to.r > from.r : to.r < from.r;
  // 斜走（傌象仕）：到達線路
  return `${head}${f1}${advancing ? '進' : '退'}${CN[fileOf(to.c)]}`;
}
