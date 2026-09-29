import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDefinitionAbove, parseDefinition, splitTopLevel } from '../src/parse';
import { docstring, snippetToText, yieldType } from '../src/generate';

const parse = (src: string, line = 0) => parseDefinition(src.split('\n'), line)!;

test('splits parameters at top level only', () => {
  assert.deepEqual(splitTopLevel('a, b: dict[str, int] = {"x": 1, "y": 2}, c="a,b", *args, **kw'), [
    'a', 'b: dict[str, int] = {"x": 1, "y": 2}', 'c="a,b"', '*args', '**kw',
  ]);
});

test('parses a multi-line typed signature with defaults, *args, **kwargs, / and *', () => {
  const d = parse([
    'async def fetch(',
    '    url: str,  # the target',
    '    /,',
    '    retries: int = 3,',
    '    *args,',
    '    timeout: float | None = None,',
    '    **kwargs: Any,',
    ') -> dict[str, Any]:',
    '    if not url:',
    '        raise ValueError("url")',
    '    return {"ok": True}',
  ].join('\n'));
  assert.equal(d.name, 'fetch');
  assert.equal(d.headerEnd, 7);
  assert.deepEqual(d.params.map(p => [p.name, p.type, p.default, p.kind]), [
    ['url', 'str', undefined, 'normal'],
    ['retries', 'int', '3', 'normal'],
    ['args', undefined, undefined, 'args'],
    ['timeout', 'float | None', 'None', 'normal'],
    ['kwargs', 'Any', undefined, 'kwargs'],
  ]);
  assert.equal(d.returnType, 'dict[str, Any]');
  assert.deepEqual(d.raises, ['ValueError']);
  assert.equal(d.returns, true);
  assert.equal(d.bodyIndent, '    ');
});

test('methods drop self/cls; nested functions and strings do not leak returns/raises', () => {
  const src = [
    'class Repo:',
    '    def load(self, path):',
    '        """Old docstring mentions raise KeyError and return x."""',
    '        def helper():',
    '            return 1',
    '        # raise NotImplementedError',
    '        print("yield me")',
  ].join('\n');
  const d = parse(src, 1);
  assert.equal(d.isMethod, true);
  assert.deepEqual(d.params.map(p => p.name), ['path']);
  assert.equal(d.returns, false);
  assert.equal(d.yields, false);
  assert.deepEqual(d.raises, []);
  assert.equal(d.hasDocstring, true);
  assert.equal(parse(src, 0).kind, 'class');
});

test('finds the definition above the line where """ was typed', () => {
  const lines = ['def a(x):', '    """', '    pass', 'y = 1', 'def b(', '    q,', '):', '    """'];
  assert.equal(findDefinitionAbove(lines, 1), 0);
  assert.equal(findDefinitionAbove(lines, 7), 4);
  assert.equal(findDefinitionAbove(lines, 3), undefined, 'not directly under a header');
});

test('yield types come from Generator/Iterator annotations', () => {
  assert.equal(yieldType('Iterator[int]'), 'int');
  assert.equal(yieldType('Generator[tuple[str, int], None, None]'), 'tuple[str, int]');
  assert.equal(yieldType('typing.AsyncGenerator[bytes, None]'), 'bytes');
  assert.equal(yieldType('list[int]'), undefined);
});

const sample = parse([
  'def area(width: float, height: float = 1.0) -> float:',
  '    if width < 0:',
  '        raise ValueError("negative")',
  '    return width * height',
].join('\n'));

test('google style', () => {
  assert.equal(snippetToText(docstring(sample, 'google')), [
    '"""_summary_',
    '',
    'Args:',
    '    width (float): _description_',
    '    height (float, optional): _description_ Defaults to 1.0.',
    '',
    'Returns:',
    '    float: _description_',
    '',
    'Raises:',
    '    ValueError: _description_',
    '"""',
  ].join('\n'));
});

test('numpy style', () => {
  assert.equal(snippetToText(docstring(sample, 'numpy')), [
    '"""_summary_', '', 'Parameters', '----------', 'width : float', '    _description_', 'height : float, optional', '    _description_, by default 1.0',
    '', 'Returns', '-------', 'float', '    _description_', '', 'Raises', '------', 'ValueError', '    _description_', '"""',
  ].join('\n'));
});

test('sphinx style', () => {
  assert.equal(snippetToText(docstring(sample, 'sphinx')), [
    '"""_summary_', '', ':param width: _description_', ':type width: float', ':param height: _description_, defaults to 1.0', ':type height: float, optional',
    ':return: _description_', ':rtype: float', ':raises ValueError: _description_', '"""',
  ].join('\n'));
});

test('generators get Yields, not Returns; tab stops are sequential', () => {
  const gen = parse('def chunks(data: bytes, size=4) -> Iterator[bytes]:\n    for i in range(0, len(data), size):\n        yield data[i:i + size]');
  const snip = docstring(gen, 'google');
  assert.match(snippetToText(snip), /Yields:\n {4}bytes: _description_/);
  assert.doesNotMatch(snippetToText(snip), /Returns/);
  assert.deepEqual([...snip.matchAll(/\$\{(\d+):/g)].map(m => Number(m[1])), [1, 2, 3, 4]);
});

test('no params and no return gives a one-line docstring; $ and } are escaped', () => {
  assert.equal(docstring(parse('def ping():\n    print("x")'), 'google'), '"""${1:_summary_}"""');
  const d = parse('def f(a: "Dict[str, ${x}]"):\n    pass');
  assert.equal(snippetToText(docstring(d, 'google')).split('\n')[3], '    a ("Dict[str, ${x}]"): _description_');
});
