import type { Definition, Param } from './parse';

export type Style = 'google' | 'numpy' | 'sphinx';

/** Escapes text for use inside a VS Code snippet. */
const esc = (s: string) => s.replace(/[$}\\]/g, m => `\\${m}`);

/** Element type of Generator[Y, ...] / Iterator[Y] / Iterable[Y] / AsyncGenerator[Y, ...]. */
export function yieldType(returnType?: string): string | undefined {
  const m = /^(?:typing\.|collections\.abc\.)?(?:Async)?(?:Generator|Iterator|Iterable)\[(.+)\]$/.exec(returnType?.trim() ?? '');
  if (!m) return undefined;
  let depth = 0;
  for (let i = 0; i < m[1].length; i++) {
    const c = m[1][i];
    if ('[('.includes(c)) depth++;
    else if ('])'.includes(c)) depth--;
    else if (c === ',' && depth === 0) return m[1].slice(0, i).trim();
  }
  return m[1].trim();
}

/**
 * Builds a docstring snippet (without the surrounding indentation) for a definition.
 * Placeholders are numbered in reading order so Tab walks through them.
 */
export function docstring(def: Definition, style: Style, opts: { includeTypes?: boolean; placeholder?: string } = {}): string {
  const includeTypes = opts.includeTypes ?? true;
  const ph = opts.placeholder ?? '_description_';
  let n = 0;
  const tab = (text: string) => `\${${++n}:${esc(text)}}`;
  const summary = tab(def.kind === 'class' ? `_summary_` : '_summary_');
  const lines: string[] = [`"""${summary}`];
  const params = def.params;
  const yt = def.yields ? yieldType(def.returnType) : undefined;
  const returnType = def.returnType && def.returnType !== 'None' && !def.yields ? def.returnType : undefined;
  const showReturns = !def.yields && (def.returns || !!returnType) && def.kind === 'function';
  const section = (items: string[]) => (items.length ? ['', ...items] : []);
  const pname = (p: Param) => (p.kind === 'args' ? `*${p.name}` : p.kind === 'kwargs' ? `**${p.name}` : p.name);
  const optional = (p: Param) => p.default !== undefined;

  if (style === 'google') {
    if (params.length) {
      lines.push('', 'Args:');
      for (const p of params) {
        const t = includeTypes && p.type ? ` (${esc(p.type)}${optional(p) ? ', optional' : ''})` : optional(p) ? ' (optional)' : '';
        const d = optional(p) ? ` Defaults to ${esc(p.default!)}.` : '';
        lines.push(`    ${esc(pname(p))}${t}: ${tab(ph)}${d}`);
      }
    }
    if (showReturns) lines.push('', 'Returns:', `    ${returnType && includeTypes ? `${esc(returnType)}: ` : ''}${tab(ph)}`);
    if (def.yields) lines.push('', 'Yields:', `    ${yt && includeTypes ? `${esc(yt)}: ` : ''}${tab(ph)}`);
    if (def.raises.length) {
      lines.push('', 'Raises:');
      for (const r of def.raises) lines.push(`    ${esc(r)}: ${tab(ph)}`);
    }
  } else if (style === 'numpy') {
    if (params.length) {
      lines.push('', 'Parameters', '----------');
      for (const p of params) {
        const t = [includeTypes && p.type ? esc(p.type) : '', optional(p) ? 'optional' : ''].filter(Boolean).join(', ');
        lines.push(`${esc(pname(p))}${t ? ` : ${t}` : ''}`);
        lines.push(`    ${tab(ph)}${optional(p) ? `, by default ${esc(p.default!)}` : ''}`);
      }
    }
    if (showReturns) lines.push('', 'Returns', '-------', `${returnType && includeTypes ? esc(returnType) : '_type_'}`, `    ${tab(ph)}`);
    if (def.yields) lines.push('', 'Yields', '------', `${yt && includeTypes ? esc(yt) : '_type_'}`, `    ${tab(ph)}`);
    if (def.raises.length) {
      lines.push('', 'Raises', '------');
      for (const r of def.raises) lines.push(esc(r), `    ${tab(ph)}`);
    }
  } else {
    const items: string[] = [];
    for (const p of params) {
      items.push(`:param ${esc(p.name)}: ${tab(ph)}${optional(p) ? `, defaults to ${esc(p.default!)}` : ''}`);
      if (includeTypes && p.type) items.push(`:type ${esc(p.name)}: ${esc(p.type)}${optional(p) ? ', optional' : ''}`);
    }
    if (showReturns) {
      items.push(`:return: ${tab(ph)}`);
      if (includeTypes && returnType) items.push(`:rtype: ${esc(returnType)}`);
    }
    if (def.yields) {
      items.push(`:yield: ${tab(ph)}`);
      if (includeTypes && yt) items.push(`:ytype: ${esc(yt)}`);
    }
    for (const r of def.raises) items.push(`:raises ${esc(r)}: ${tab(ph)}`);
    lines.push(...section(items));
  }
  if (lines.length === 1) return `${lines[0]}"""`;
  lines.push('"""');
  return lines.join('\n');
}

/** Resolves snippet syntax to plain text (placeholders become their defaults) — used for batch insertion. */
export function snippetToText(snippet: string): string {
  return snippet.replace(/\$\{\d+:((?:\\.|[^}\\])*)\}|\\([$}\\])/g, (_, placeholder: string | undefined, escaped: string | undefined) =>
    placeholder !== undefined ? placeholder.replace(/\\(.)/g, '$1') : escaped!,
  );
}
