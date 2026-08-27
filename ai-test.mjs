// AI 引擎自測
import { initialBoard, applyMove, legalMoves, inCheck, RED, BLACK, hashBoard } from './game.js';
import { findBestMove, evaluate } from './ai.js';

let failed = 0;
function ok(cond, msg) {
  if (cond) { console.log('  ✓', msg); }
  else { failed++; console.error('  ✗', msg); }
}
const emptyBoard = () => Array.from({ length: 10 }, () => Array(9).fill(null));
const isLegal = (b, mv) =>
  !!mv && legalMoves(b, mv.from.r, mv.from.c).some((m) => m.r === mv.to.r && m.c === mv.to.c);

// ---------- 初始局面：三種難度都要回傳合法著法 ----------
for (const lv of ['easy', 'medium', 'hard']) {
  const b = initialBoard();
  const t0 = Date.now();
  const mv = findBestMove(b, RED, lv);
  const ms = Date.now() - t0;
  ok(isLegal(b, mv), `${lv}：初始局面回傳合法著法（${ms}ms, depth=${mv?.depth}）`);
}

// ---------- 黑方也能走 ----------
{
  const b = initialBoard();
  applyMove(b, { r: 2, c: 1 }, { r: 2, c: 4 }); // 紅炮平五
  const mv = findBestMove(b, BLACK, 'medium');
  ok(isLegal(b, mv), '黑方（medium）回傳合法著法');
}

// ---------- 白吃大子：中等以上要吃掉沒人保護的車 ----------
{
  const b = emptyBoard();
  b[0][4] = { type: 'K', side: RED };
  b[9][3] = { type: 'K', side: BLACK };
  b[5][0] = { type: 'R', side: RED };  // 紅車在 (5,0)
  b[5][8] = { type: 'R', side: BLACK }; // 黑車同列，可直取
  const mv = findBestMove(b, BLACK, 'medium');
  ok(mv && mv.to.r === 5 && mv.to.c === 0, `medium：白吃無根紅車（實走 ${JSON.stringify(mv?.to)}）`);
}

// ---------- 解將：被將軍時必須應將 ----------
{
  const b = emptyBoard();
  b[0][4] = { type: 'K', side: RED };
  b[9][4] = { type: 'K', side: BLACK };
  b[5][4] = { type: 'N', side: BLACK }; // 擋對臉
  b[3][4] = { type: 'R', side: BLACK }; // 將軍
  b[0][0] = { type: 'R', side: RED };
  for (const lv of ['easy', 'medium', 'hard']) {
    const mv = findBestMove(b, RED, lv);
    const nb = b.map((r) => r.slice());
    applyMove(nb, mv.from, mv.to);
    ok(!inCheck(nb, RED), `${lv}：被將時應將（實走 ${JSON.stringify(mv)}）`);
  }
}

// ---------- 殺棋：困難模式找到一步殺 ----------
{
  // 黑將 (9,4)，紅雙俥：一俥 (8,0) 控制第 8 行，另一俥 (7,8) 走到 (9,8)... 改用鐵門栓型
  const b = emptyBoard();
  b[9][4] = { type: 'K', side: BLACK };
  b[0][3] = { type: 'K', side: RED };
  b[8][0] = { type: 'R', side: RED };  // 控制 row 8（黑將無法下來）
  b[6][8] = { type: 'R', side: RED };  // 俥進 (9,8) 抽底線將軍
  b[5][3] = { type: 'P', side: RED };
  const mv = findBestMove(b, RED, 'hard');
  const nb = b.map((r) => r.slice());
  applyMove(nb, mv.from, mv.to);
  const mated = inCheck(nb, BLACK) &&
    ![...Array(10).keys()].some((r) => [...Array(9).keys()].some((c) => {
      const p = nb[r][c];
      return p && p.side === BLACK && legalMoves(nb, r, c).length > 0;
    }));
  ok(mated, `hard：找到一步殺（實走 ${JSON.stringify(mv)}，score=${mv?.score}）`);
}

// ---------- 殺棋：困難模式看到兩步連將殺（應將靜態搜索＋將軍延伸） ----------
{
  const b = emptyBoard();
  b[9][4] = { type: 'K', side: BLACK };
  b[8][6] = { type: 'C', side: BLACK }; // 黑砲只能墊將，被吃後無子可擋
  b[0][0] = { type: 'K', side: RED };
  b[8][0] = { type: 'R', side: RED };  // 控制 row 8 的宮位出口
  b[5][8] = { type: 'R', side: RED };  // 俥進 (9,8) 開始連將
  const mv = findBestMove(b, RED, 'hard');
  ok(mv && mv.score > 100000 - 200,
    `hard：看出兩步連將殺（實走 ${JSON.stringify(mv?.from)}→${JSON.stringify(mv?.to)}，score=${mv?.score}）`);
}

// ---------- 重複局面：近期出現過的局面要扣分避開 ----------
{
  // 注意：紅帥須在九宮內（(0,0) 會造成紅方無子可動→全為殺棋分數，測試失真）
  const b = emptyBoard();
  b[0][3] = { type: 'K', side: RED };
  b[9][5] = { type: 'K', side: BLACK };
  const mv1 = findBestMove(b, BLACK, 'medium');
  const nb1 = b.map((r) => r.slice());
  applyMove(nb1, mv1.from, mv1.to);
  const h = hashBoard(nb1);
  const mv2 = findBestMove(b, BLACK, 'medium', [h]);
  const nb2 = b.map((r) => r.slice());
  applyMove(nb2, mv2.from, mv2.to);
  ok(hashBoard(nb2) !== h, `medium：給定近期局面後避開重複（第一次 ${JSON.stringify(mv1?.to)}，第二次 ${JSON.stringify(mv2?.to)}）`);
}

// ---------- 評估函數對稱 ----------
{
  ok(evaluate(initialBoard()) === 0, '初始局面評估為 0（紅黑對稱）');
}

// ---------- 效能：hard 在初始局面 5.5 秒內回覆 ----------
{
  const t0 = Date.now();
  findBestMove(initialBoard(), RED, 'hard');
  const ms = Date.now() - t0;
  ok(ms < 5500, `hard 思考時間 ${ms}ms < 5500ms`);
}

console.log(failed === 0 ? '\n全部通過 ✔' : `\n${failed} 項失敗 ✘`);
process.exit(failed === 0 ? 0 : 1);
