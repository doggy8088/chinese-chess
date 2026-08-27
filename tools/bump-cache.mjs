#!/usr/bin/env node
// ============================================================
// 快取清除：為本地 JS/CSS 產生「內容雜湊」版本號 ?v=<hash>
// ------------------------------------------------------------
// GitHub Pages 固定回應 Cache-Control: max-age=600（10 分鐘），
// 更版後瀏覽器仍可能拿到舊的 JS/CSS。此腳本把目前內容的雜湊
// 寫進 index.html 與所有本地模組的引用位址（?v=<hash>），
// 讓每次內容變更都對應到全新網址，瀏覽器立即載入新版。
//
// 用法：
//   node tools/bump-cache.mjs           # 依內容重算並改寫版本號
//   node tools/bump-cache.mjs --check   # 只檢查是否需要更新（CI／hook 用）
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// 參與雜湊的本地檔案（內容任一變動 → 版本號改變）
const ASSETS = ['css/style.css', 'main.js', 'game.js', 'ai.js', 'ai-worker.js'];

// 去掉既有 ?v= 後再計算雜湊 → 同內容重複執行不會改寫（冪等）
const normalized = ASSETS.map((p) => readFileSync(join(root, p), 'utf8').replace(/\?v=[0-9a-f]+/g, ''));
const version = createHash('sha256').update(normalized.join('\0')).digest('hex').slice(0, 10);

// 每個檔案中「本地資源引用位址」的改寫規則（?v= 直接內嵌在引用處）
const V = `?v=${version}`;
const RULES = [
  ['index.html', [
    [/((?:href|src)="\.\/(?:css\/style\.css|main\.js))(\?v=[0-9a-f]+)?"/g, `$1${V}"`],
  ]],
  ['main.js', [
    [/(\.\/game\.js)(\?v=[0-9a-f]+)?(?=['"])/g, `$1${V}`],
    [/(\.\/ai-worker\.js)(\?v=[0-9a-f]+)?(?=['"])/g, `$1${V}`],
    [/(\.\/ai\.js)(\?v=[0-9a-f]+)?(?=['"])/g, `$1${V}`],
  ]],
  ['ai-worker.js', [
    [/(\.\/ai\.js)(\?v=[0-9a-f]+)?(?=['"])/g, `$1${V}`],
  ]],
  ['ai.js', [
    [/(\.\/game\.js)(\?v=[0-9a-f]+)?(?=['"])/g, `$1${V}`],
  ]],
];

const check = process.argv.includes('--check');
let dirty = false;

for (const [file, rules] of RULES) {
  const path = join(root, file);
  const original = readFileSync(path, 'utf8');
  const updated = rules.reduce((acc, [re, rep]) => acc.replace(re, rep), original);
  if (updated !== original) {
    dirty = true;
    if (!check) writeFileSync(path, updated);
    console.log(`  ✎ ${file} → ?v=${version}`);
  }
}

if (check) {
  console.log(dirty ? `需要更新版本號（${version}）` : `版本號已是最新（${version}）`);
  process.exit(dirty ? 1 : 0);
}
console.log(dirty ? `已更新版本號：${version}` : `版本號無變更（${version}）`);