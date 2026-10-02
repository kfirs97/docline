import * as vscode from 'vscode';
import { Definition, findDefinitionAbove, parseDefinition } from './parse';
import { docstring, snippetToText, Style } from './generate';
import { License } from './license';
import { BUY_URL } from './licenseVerify';
import { recordUse } from './nudge';

const settings = () => {
  const c = vscode.workspace.getConfiguration('docline');
  return { style: c.get<Style>('style', 'google'), includeTypes: c.get<boolean>('includeTypes', true), placeholder: c.get<string>('placeholder', '_description_') };
};

const indentBody = (snippet: string, indent: string) => snippet.split('\n').map((l, i) => (i === 0 || !l ? l : indent + l)).join('\n');
const linesOf = (doc: vscode.TextDocument) => doc.getText().split(/\r?\n/);

/** Offers "Generate Docstring" right after typing """ under a def/class header. */
class DocstringCompletion implements vscode.CompletionItemProvider {
  provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] | undefined {
    const lineText = doc.lineAt(pos.line).text;
    const before = lineText.slice(0, pos.character);
    const quote = /([rRuUbBfF]*)("""|''')$/.exec(before.trimStart());
    if (!quote || before.trim() !== quote[0]) return undefined;
    const lines = linesOf(doc);
    const start = findDefinitionAbove(lines, pos.line);
    if (start === undefined) return undefined;
    const def = parseDefinition(lines, start);
    if (!def || def.headerEnd !== pos.line - 1) return undefined;
    const { style, includeTypes, placeholder } = settings();
    const snippet = docstring(def, style, { includeTypes, placeholder }).replace(/^"""/, quote[2]).replace(/"""$/, quote[2]);
    const item = new vscode.CompletionItem('Generate Docstring', vscode.CompletionItemKind.Snippet);
    item.detail = `Docline · ${style} style`;
    item.insertText = new vscode.SnippetString(indentBody(snippet, def.bodyIndent));
    // Replace the typed quotes and any auto-closed quotes after the cursor.
    const after = lineText.slice(pos.character);
    const closing = after.startsWith(quote[2]) ? 3 : 0;
    item.range = new vscode.Range(pos.line, pos.character - quote[2].length, pos.line, pos.character + closing);
    item.filterText = quote[2];
    item.sortText = '\0';
    item.preselect = true;
    item.command = { command: 'docline.used', title: '' };
    return [item];
  }
}

function definitionAt(doc: vscode.TextDocument, line: number): Definition | undefined {
  const lines = linesOf(doc);
  for (let i = line; i >= 0 && i >= line - 200; i--) {
    if (!/^\s*(async\s+)?(def|class)\s/.test(lines[i])) continue;
    return parseDefinition(lines, i); // nearest definition at or above the cursor
  }
  return undefined;
}

async function insertDocstring(editor: vscode.TextEditor, def: Definition): Promise<void> {
  const { style, includeTypes, placeholder } = settings();
  const snippet = indentBody(docstring(def, style, { includeTypes, placeholder }), def.bodyIndent);
  const at = new vscode.Position(def.headerEnd + 1, 0);
  await editor.insertSnippet(new vscode.SnippetString(`${def.bodyIndent}${snippet}\n`), at);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const license = new License(context);
  // Don't block activation on the license check: the completion provider must be ready immediately.
  void license.init();

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider({ language: 'python' }, new DocstringCompletion(), '"', "'"),
    vscode.commands.registerTextEditorCommand('docline.generate', async editor => {
      const def = definitionAt(editor.document, editor.selection.active.line);
      if (!def) return void vscode.window.showInformationMessage('Put the cursor inside a Python function or class to generate its docstring.');
      if (def.hasDocstring) return void vscode.window.showInformationMessage(`${def.name} already has a docstring.`);
      await insertDocstring(editor, def);
      void recordUse(context, license);
    }),
    vscode.commands.registerTextEditorCommand('docline.generateFile', async editor => {
      if (!(await license.require('Documenting a whole file'))) return;
      const lines = linesOf(editor.document);
      const defs = lines
        .map((l, i) => (/^\s*(async\s+)?(def|class)\s/.test(l) ? parseDefinition(lines, i) : undefined))
        .filter((d): d is Definition => !!d && !d.hasDocstring);
      if (!defs.length) return void vscode.window.showInformationMessage('Every function and class in this file already has a docstring.');
      const { style, includeTypes, placeholder } = settings();
      await editor.edit(edit => {
        for (const def of defs) {
          const text = indentBody(snippetToText(docstring(def, style, { includeTypes, placeholder })), def.bodyIndent);
          edit.insert(new vscode.Position(def.headerEnd + 1, 0), `${def.bodyIndent}${text}\n`);
        }
      });
      void vscode.window.showInformationMessage(`Docline added ${defs.length} docstring${defs.length === 1 ? '' : 's'}.`);
    }),
    vscode.commands.registerCommand('docline.used', () => recordUse(context, license)),
    vscode.commands.registerCommand('docline.enterLicense', () => license.enterKey()),
    vscode.commands.registerCommand('docline.removeLicense', () => license.removeKey()),
    vscode.commands.registerCommand('docline.buyPro', () => vscode.env.openExternal(vscode.Uri.parse(BUY_URL))),
  );
}

export function deactivate(): void {}
