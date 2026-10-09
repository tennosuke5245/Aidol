#!/usr/bin/env node
// 發佈前檢查：列出 git 會公開的檔案，找出本機路徑、帳號名稱、憑證、私人對話連結，
// 以及不該公開的資料夾（設計稿、驗收紀錄、開發用 skills、本機角色資料、建置產物）。
//
// 用法（在 git 儲存庫內）：bun run check:oss   或   node scripts/check-oss.mjs
// 額外要擋的字詞（例如真實姓名、公司名）：OSS_CHECK_EXTRA="字詞一,字詞二" bun run check:oss
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const self = path.relative(root, fileURLToPath(import.meta.url)).split(path.sep).join('/');

let files;
try {
  files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
} catch {
  console.error('check-oss：需要在 git 儲存庫內執行（先 git init）。');
  process.exit(2);
}

const forbiddenPaths = [
  [/(^|\/)(AGENTS|CLAUDE)[^/]*\.md$/i, '個人的 agent 指示檔'],
  [/(^|\/)\.(codex|claude)\//, '個人的 agent 工具設定'],
  [/^\.agents\/(?!skills\/aidol\/)/, '開發用 skills（只公開 .agents/skills/aidol/）'],
  [/^docs\//, '設計稿與驗收紀錄'],
  [/(^|\/)design-qa[^/]*$/i, '設計驗收紀錄'],
  [/^src\/assets\/brand\/[^/]*-v2/, '舊版品牌稿'],
  [/^src-tauri\/icons(-v2)?\//, '舊版品牌圖示'],
  [/^src\/assets\/fonts\/(specimen\.html|comparison\/|source-metrics\.json)/, '字型比較與樣張'],
  [/^scripts\/import-placeholders\.py$/, '設計來源工具'],
  [/^\.aidol(-[^/]+)?\//, '本機角色資料或 QA 資料'],
  [/^\.qa\//, 'QA 暫存'],
  [/^dist\//, '建置產物'],
  [/^src-tauri\/(target|binaries|resources|gen)\//, '桌面建置產物'],
  [/(^|\/)node_modules\//, '相依套件'],
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, '環境設定檔'],
  [/\.(exe|dll|msi|pdb|zip|7z|rar)$/i, '執行檔或封裝檔'],
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const variants = (value) => [...new Set([value, value.replace(/\\/g, '/'), value.replace(/\\/g, '\\\\')])];

// 這台電腦的路徑與帳號名稱：任何檔案（含圖片、字型）出現都算外洩。
const needles = new Set();
for (const local of [root, os.homedir()]) if (local && local.length > 3) for (const v of variants(local)) needles.add(v);
// 後面接著英數、點或連字號的不算（例如 /root 不該命中 /root-ca.crt）
const needlePatterns = [...needles].map((needle) => new RegExp(`${escapeRegExp(needle)}(?![\\w.-])`, 'i'));
const commonNames = new Set(['root', 'user', 'users', 'admin', 'administrator', 'runner', 'node', 'dev', 'test', 'public', 'default']);
let username = '';
try { username = os.userInfo().username || ''; } catch { /* 部分環境沒有帳號資訊 */ }
const extra = (process.env.OSS_CHECK_EXTRA || '').split(',').map((word) => word.trim()).filter(Boolean);

const textPatterns = [
  [/[A-Za-z]:(\\\\|\\|\/)+Users(\\\\|\\|\/)+(?!(Public|Default)\b)[^\\/\s"'`<>]+/i, 'Windows 使用者資料夾路徑'],
  [/(?<![\w.:])\/Users\/(?!Shared\b)[A-Za-z0-9._-]+/, 'macOS 使用者資料夾路徑'],
  [/(?<![\w.])\/home\/[a-z_][a-z0-9_.-]*/, 'Linux 使用者資料夾路徑'],
  [/(?<![\w])[A-Za-z]:(\\\\|\\|\/)(?!(\\\\|\\|\/)*(Program Files|Windows)\b)[^\s"'`<>|*?]+/, 'Windows 磁碟絕對路徑'],
  [/[A-Za-z0-9._%+-]+@(?!\d+x\.)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, 'Email'],  // 排除 icon@2x.png 這類檔名
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '私鑰'],
  [/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/(chatgpt\.com|chat\.openai\.com)\/(c|share|g|project)\/|claude\.ai\/(chat|project|share)\//i, '私人對話或專案連結'],
  [/(?<![\w.-])(?!aidol\.local\b)[a-z0-9-]+\.(local|lan|internal|corp|home\.arpa)\b/i, '區域網路主機名稱'],
  [/\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/, '私有 IP 位址'],
];
if (username.length >= 3 && !commonNames.has(username.toLowerCase())) textPatterns.push([new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(username)}(?![A-Za-z0-9])`, 'i'), '這台電腦的帳號名稱']);
for (const word of extra) textPatterns.push([new RegExp(escapeRegExp(word), 'i'), `自訂字詞「${word}」`]);

const textExtensions = /\.(m?[jt]sx?|json|ya?ml|md|txt|html?|css|svg|toml|rs|py|lock|xml|plist|cjs|mjs|sh|ps1|bat|cmd|ini|cfg|conf)$|(^|\/)\.[^/]+$|(^|\/)(LICENSE|Dockerfile|Makefile)$/i;
const problems = [];
let total = 0;

for (const file of files) {
  for (const [pattern, reason] of forbiddenPaths) if (pattern.test(file)) problems.push(`${file}：不應公開（${reason}）`);
  const absolute = path.join(root, file);
  let buffer;
  try { if (!statSync(absolute).isFile()) continue; buffer = readFileSync(absolute); } catch { continue; }
  total += buffer.length;
  if (file === self) continue;
  const latin = buffer.toString('latin1');
  if (needlePatterns.some((pattern) => pattern.test(latin))) problems.push(`${file}：含有這台電腦的路徑`);
  const isText = textExtensions.test(file) || !buffer.subarray(0, 8000).includes(0);
  if (!isText) {
    if (username.length >= 3 && !commonNames.has(username.toLowerCase()) && latin.toLowerCase().includes(username.toLowerCase())) problems.push(`${file}：二進位內容含有帳號名稱「${username}」，請確認不是中繼資料`);
    continue;
  }
  const lines = buffer.toString('utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const [pattern, reason] of textPatterns) {
      const match = pattern.exec(line);
      if (match) problems.push(`${file}:${index + 1}：${reason} → ${match[0].slice(0, 80)}`);
    }
  });
}

// commit 的作者與提交者 Email 會跟著 git 歷史公開：只接受 GitHub 的 noreply 地址。
const isPrivateEmail = (email) => /@users\.noreply\.github\.com$/i.test(email);
const gitOutput = (args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return ''; } };
const configuredEmail = gitOutput(['config', 'user.email']);
if (configuredEmail && !isPrivateEmail(configuredEmail)) problems.push(`git user.email「${configuredEmail}」會寫進每個 commit；請在這個儲存庫執行 git config user.email <id>+<帳號>@users.noreply.github.com`);
const historyEmails = new Set(gitOutput(['log', '--all', '--format=%ae%n%ce']).split('\n').filter(Boolean));
for (const email of historyEmails) if (!isPrivateEmail(email)) problems.push(`git 歷史中的 commit 含有 Email「${email}」；發佈前請改寫歷史或重新建立儲存庫`);

const size = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
if (problems.length) {
  console.error(`check-oss：${files.length} 個要公開的檔案（${size(total)}）中發現 ${problems.length} 個問題：\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\n修正後再發佈；確定是誤判的話，調整 scripts/check-oss.mjs 的規則。');
  process.exit(1);
}
console.log(`check-oss：${files.length} 個要公開的檔案（${size(total)}），沒有發現本機資訊或不該公開的內容。`);
