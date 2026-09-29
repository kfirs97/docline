/** A parsed Python function or class header plus what its body reveals. */
export interface Param {
  name: string;
  type?: string;
  default?: string;
  kind: 'normal' | 'args' | 'kwargs';
}

export interface Definition {
  kind: 'function' | 'class';
  name: string;
  params: Param[];
  returnType?: string;
  /** Line index of the last line of the header (the one ending with ':'). */
  headerEnd: number;
  /** Indentation of the body (for placing the docstring). */
  bodyIndent: string;
  returns: boolean;
  yields: boolean;
  raises: string[];
  hasDocstring: boolean;
  isMethod: boolean;
}

const DEF = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
const CLASS = /^(\s*)class\s+([A-Za-z_]\w*)\s*[(:]/;

/** Finds the definition whose header contains or directly precedes `line` (e.g. the line where `"""` was typed). */
export function findDefinitionAbove(lines: string[], line: number): number | undefined {
  for (let i = line; i >= 0 && i >= line - 40; i--) {
    if (DEF.test(lines[i]) || CLASS.test(lines[i])) {
      const end = headerEnd(lines, i);
      if (end !== undefined && end >= line - 1) return i;
      return undefined;
    }
  }
  return undefined;
}

/** Index of the line that ends the header (the ':' at bracket depth 0), skipping strings and comments. */
function headerEnd(lines: string[], start: number): number | undefined {
  let depth = 0;
  for (let i = start; i < lines.length && i < start + 60; i++) {
    const text = lines[i];
    let quote: string | null = null;
    for (let j = 0; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === '\\') j++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '#') break;
      if (c === '"' || c === "'") quote = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ':' && depth === 0) return i;
    }
  }
  return undefined;
}

/** Splits on commas at bracket depth 0, respecting strings. */
export function splitTopLevel(s: string, sep = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === '\\') cur += s[++i] ?? '';
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (c === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map(p => p.trim()).filter(Boolean);
}

/** Splits `name: type = default` at the first top-level ':' and '='. */
function parseParam(raw: string): Param | undefined {
  if (raw === '*' || raw === '/') return undefined;
  let kind: Param['kind'] = 'normal';
  let text = raw;
  if (text.startsWith('**')) (kind = 'kwargs'), (text = text.slice(2));
  else if (text.startsWith('*')) (kind = 'args'), (text = text.slice(1));
  const eq = splitTopLevel(text, '=');
  const [head, ...rest] = eq;
  const dflt = rest.length ? text.slice(text.indexOf('=', head.length) + 1).trim() : undefined;
  const colon = head.indexOf(':');
  const name = (colon === -1 ? head : head.slice(0, colon)).trim();
  const type = colon === -1 ? undefined : head.slice(colon + 1).trim() || undefined;
  return { name, type, default: dflt, kind };
}

export function parseDefinition(lines: string[], start: number): Definition | undefined {
  const end = headerEnd(lines, start);
  if (end === undefined) return undefined;
  const header = lines.slice(start, end + 1).map(l => l.replace(/#.*$/, '')).join(' ');
  const defMatch = DEF.exec(lines[start]);
  const classMatch = CLASS.exec(lines[start]);
  const indent = (defMatch ?? classMatch)![1];
  const bodyIndent = detectBodyIndent(lines, end, indent);
  const body = bodyLines(lines, end + 1, indent);
  const hasDocstring = body.length > 0 && /^\s*[rRuUbBfF]*("""|''')/.test(body.find(l => l.trim()) ?? '');
  const isMethod = indent.length > 0 && isInsideClass(lines, start, indent);

  if (classMatch) {
    return { kind: 'class', name: classMatch[2], params: [], headerEnd: end, bodyIndent, returns: false, yields: false, raises: [], hasDocstring, isMethod };
  }

  const open = header.indexOf('(');
  let depth = 0;
  let close = open;
  for (let i = open; i < header.length; i++) {
    if (header[i] === '(') depth++;
    else if (header[i] === ')' && --depth === 0) {
      close = i;
      break;
    }
  }
  const params = splitTopLevel(header.slice(open + 1, close))
    .map(parseParam)
    .filter((p): p is Param => !!p)
    .filter((p, i) => !(i === 0 && isMethod && (p.name === 'self' || p.name === 'cls')));
  const arrow = /\)\s*->\s*(.+?)\s*:\s*$/.exec(header.trimEnd());
  const code = stripStringsAndComments(body);
  const nested = nestedDefRanges(code);
  const own = code.filter((_, i) => !nested.has(i));
  const raises = [...new Set(own.flatMap(l => [...l.matchAll(/\braise\s+([A-Za-z_][\w.]*)/g)].map(m => m[1])))];
  return {
    kind: 'function',
    name: defMatch![2],
    params,
    returnType: arrow?.[1],
    headerEnd: end,
    bodyIndent,
    returns: own.some(l => /\breturn\s+(?!None\s*$)\S/.test(l)),
    yields: own.some(l => /\byield\b/.test(l)),
    raises,
    hasDocstring,
    isMethod,
  };
}

function detectBodyIndent(lines: string[], end: number, indent: string): string {
  for (let i = end + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const m = /^\s*/.exec(lines[i])![0];
    if (m.length > indent.length) return m;
    break;
  }
  return indent + '    ';
}

/** Lines of the body: everything after the header indented deeper than the definition. */
function bodyLines(lines: string[], from: number, indent: string): string[] {
  const out: string[] = [];
  for (let i = from; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && /^\s*/.exec(l)![0].length <= indent.length) break;
    out.push(l);
  }
  return out;
}

function isInsideClass(lines: string[], start: number, indent: string): boolean {
  for (let i = start - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l.trim()) continue;
    const ind = /^\s*/.exec(l)![0].length;
    if (ind < indent.length) return CLASS.test(l);
  }
  return false;
}

/** Blanks out string literals (incl. triple-quoted) and comments so keywords inside them are ignored. */
function stripStringsAndComments(body: string[]): string[] {
  let triple: string | null = null;
  return body.map(line => {
    let out = '';
    for (let i = 0; i < line.length; i++) {
      if (triple) {
        if (line.startsWith(triple, i)) (triple = null), (i += 2);
        continue;
      }
      const c = line[i];
      if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
        triple = line.slice(i, i + 3);
        i += 2;
        continue;
      }
      if (c === '#') break;
      if (c === '"' || c === "'") {
        const endQ = line.indexOf(c, i + 1);
        i = endQ === -1 ? line.length : endQ;
        out += '""';
        continue;
      }
      out += c;
    }
    return out;
  });
}

/** Line indexes (within body) belonging to nested functions/classes, whose returns/yields aren't ours. */
function nestedDefRanges(code: string[]): Set<number> {
  const set = new Set<number>();
  for (let i = 0; i < code.length; i++) {
    const m = /^(\s*)(?:async\s+)?(def|class)\s/.exec(code[i]);
    if (!m) continue;
    const ind = m[1].length;
    set.add(i);
    for (let j = i + 1; j < code.length; j++) {
      if (code[j].trim() && /^\s*/.exec(code[j])![0].length <= ind) break;
      set.add(j);
    }
  }
  return set;
}
