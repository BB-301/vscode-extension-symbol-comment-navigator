import * as vscode from 'vscode';
import { registerCodeActionsProviders, registerCommands, registerEventListeners, registerSymbolProviders, updateDecorations, disposeOfInternallyTrackedDisposables } from './helpers';

const EXTENSION_NAME: string = "symbol-comment-navigator";

function reactivate(context: vscode.ExtensionContext) {
	// https://github.com/microsoft/vscode/issues/45774
	deactivate();
	context.subscriptions.forEach(s => {
		try { s.dispose() } catch (error) { console.error(error); }
	});
	activate(context);
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(_ => {
		reactivate(context);
	}));
	registerCommands(context);
	registerSymbolProviders(context);
	registerEventListeners(context);
	registerCodeActionsProviders(context);
	vscode.window.visibleTextEditors.forEach(editor => {
		updateDecorations(editor);
	});
	console.info(`Extension '${EXTENSION_NAME}' is now active!`);
}

export function deactivate() {
	disposeOfInternallyTrackedDisposables();
	console.info(`Extension '${EXTENSION_NAME}' has been deactivated.`);
}
