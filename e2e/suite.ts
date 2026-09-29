import * as vscode from 'vscode';
import assert from 'node:assert/strict';

export async function run(): Promise<void> {
  await vscode.extensions.getExtension('branchline.docline-python-docstring-generator')!.activate();
  const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, 'geo.py');
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);

  // 1) Typing """ on the empty body line offers the docstring completion.
  await editor.edit(e => e.insert(new vscode.Position(1, 4), '"""'));
  const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', uri, new vscode.Position(1, 7), '"');
  const item = list.items.find(i => i.label === 'Generate Docstring');
  assert.ok(item, `completion offered (got: ${list.items.slice(0, 5).map(i => i.label)})`);
  const snippet = (item!.insertText as vscode.SnippetString).value;
  assert.match(snippet, /Args:\n {8}w \(float\): \$\{2:_description_\}/);
  assert.match(snippet, /Returns:\n {8}float:/);

  // 2) The command inserts a docstring under the function at the cursor.
  editor.selection = new vscode.Selection(6, 8, 6, 8);
  await vscode.commands.executeCommand('docline.generate');
  await new Promise(r => setTimeout(r, 300));
  const text = doc.getText();
  assert.match(text, /def scale\(x, k=2\):\n {4}"""_summary_\n\n {4}Args:\n {8}x: _description_\n {8}k \(optional\): _description_ Defaults to 2\./, text);
  console.log('E2E: all checks passed');
}
