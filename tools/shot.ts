/** Renders a VS Code-like editor showing a docstring produced by the real parser/generator. */
import { writeFileSync } from 'node:fs';
import { parseDefinition } from '../src/parse';
import { docstring, snippetToText, Style } from '../src/generate';

const [out, style = 'google'] = process.argv.slice(2);
const src = [
  'async def fetch_user(',
  '    user_id: int,',
  '    client: HttpClient,',
  '    retries: int = 3,',
  '    timeout: float | None = None,',
  ') -> User:',
  '    if user_id <= 0:',
  '        raise ValueError("user_id must be positive")',
  '    resp = await client.get(f"/users/{user_id}", timeout=timeout)',
  '    if resp.status == 404:',
  '        raise UserNotFound(user_id)',
  '    return User.from_json(resp.json())',
];
const def = parseDefinition(src, 0)!;
const doc = snippetToText(docstring(def, style as Style)).split('\n').map((l, i) => (i === 0 || !l ? `    ${l}` : `    ${l}`));
const lines = [...src.slice(0, def.headerEnd + 1), ...doc, ...src.slice(def.headerEnd + 1)];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kw = /\b(async|def|await|return|raise|if|None)\b/g;
const color = (l: string, inDoc: boolean) => {
  if (inDoc) return `<span style="color:#ce9178">${esc(l)}</span>`;
  return esc(l)
    .replace(/(f?"[^"]*")/g, '<span style="color:#ce9178">$1</span>')
    .replace(kw, '<span style="color:#569cd6">$1</span>')
    .replace(/\b(int|float|User|HttpClient|ValueError|UserNotFound)\b/g, '<span style="color:#4ec9b0">$1</span>')
    .replace(/\b(fetch_user|get|from_json|json)\b(?=\()/g, '<span style="color:#dcdcaa">$1</span>')
    .replace(/\b(\d+)\b/g, '<span style="color:#b5cea8">$1</span>');
};
const docStart = def.headerEnd + 1, docEnd = docStart + doc.length - 1;
const body = lines.map((l, i) => `<div class="ln"><span class="num">${i + 1}</span><span>${color(l, i >= docStart && i <= docEnd) || ' '}</span></div>`).join('');
writeFileSync(out, `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#1f1f1f;color:#d4d4d4;font:13px -apple-system,sans-serif}
.tabs{height:35px;background:#181818;border-bottom:1px solid #2b2b2b}.tab{display:inline-block;height:35px;line-height:35px;padding:0 16px;background:#1f1f1f;border-top:1px solid #0078d4;color:#fff}
.code{white-space:pre;padding:8px 0 16px;font:13.5px/20px Menlo,monospace}.num{display:inline-block;width:40px;text-align:right;padding-right:24px;color:#6e7681}
.badge{position:fixed;right:16px;top:44px;background:#0078d4;color:#fff;padding:4px 10px;border-radius:4px;font-size:12px}
</style></head><body><div class="tabs"><span class="tab">users.py</span></div><span class="badge">Docline · ${style} style</span><div class="code">${body}</div></body></html>`);
