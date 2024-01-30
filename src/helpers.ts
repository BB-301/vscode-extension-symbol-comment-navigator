import * as vscode from 'vscode';

type EditorDisposablePair = { editor: vscode.TextEditor, decoration: vscode.Disposable };

const decorationsManager = new class {
    private disposables: EditorDisposablePair[] = [];
    clear(editor: vscode.TextEditor) {
        const preserved: EditorDisposablePair[] = [];
        const removed: EditorDisposablePair[] = [];
        this.disposables.forEach(d => {
            if (editor === d.editor) {
                removed.push(d);
            } else {
                preserved.push(d);
            }
        })
        removed.forEach(d => d.decoration.dispose());
        this.disposables = preserved;
    }
    clearAll() {
        this.disposables.forEach(d => d.decoration.dispose());
        this.disposables = [];
    }
    register(editor: vscode.TextEditor, decoration: vscode.Disposable) {
        this.disposables.push({ editor, decoration });
    }
}

interface LanguageInfo {
    languageId: string;
    lineComment: string;
    closing?: string;
}

const INCLUDED_DEFINED_LANGUAGES: LanguageInfo[] = [
    { languageId: "c", lineComment: "//" },
    { languageId: "cpp", lineComment: "//" },
    { languageId: "csharp", lineComment: "//" },
    { languageId: "java", lineComment: "//" },
    { languageId: "go", lineComment: "//" },
    { languageId: "javascript", lineComment: "//" },
    { languageId: "typescript", lineComment: "//" },
    { languageId: "php", lineComment: "//" },
    { languageId: "python", lineComment: "#" },
    { languageId: "r", lineComment: "#" },
    { languageId: "rust", lineComment: "//" },
    { languageId: "ruby", lineComment: "#" },
    { languageId: "shellscript", lineComment: "#" },
    { languageId: "html", lineComment: "<!--", closing: "-->" },
    { languageId: "xml", lineComment: "<!--", closing: "-->" },
    { languageId: "css", lineComment: "/*", closing: "*/" },
];

export const registerSymbolProviders = (context: vscode.ExtensionContext) => {
    getEnabledLanguages().forEach(({ languageId: name, lineComment, closing }) => {
        context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(
            name,
            new MyDocumentSymbolProvider(lineComment, closing)
        ));
    });
}

const EXTENSION_CONFIG_PROPERTY_NAME = "symbolCommentNavigator";
const COMMENT_SYMBOL_INSERTION_PLACEHOLDER = "[SYMBOL TITLE]";

const insertSymbolComment = async (textEditor: vscode.TextEditor) => {
    const mark = Configurations.getMark();
    const id = textEditor.document.languageId;
    const info: LanguageInfo | undefined = getEnabledLanguages().find(info => info.languageId == id);
    if (!info) {
        vscode.window.showErrorMessage(`Could not insert mark: unsupported (or disabled) language '${id}'.`);
        return;
    }
    let text = `${info.lineComment} ${mark}: \${0:${COMMENT_SYMBOL_INSERTION_PLACEHOLDER}}`;
    if (info.closing) {
        text += ` ${info.closing}`;
    }
    const snippet = new vscode.SnippetString(text);
    textEditor.insertSnippet(snippet);
}

const moveToNextSymbolComment = (textEditor: vscode.TextEditor) => {
    const currentLine = textEditor.selection.active.line;
    const symbols = getParserListForEditor(textEditor);
    for (let s of symbols) {
        if (s.lineIndex > currentLine) {
            textEditor.selection = s.getEndOfLinePosition();
            textEditor.revealRange(s.getRange(LineParserRangeType.visibleText), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }
}

const moveToPreviousSymbolComment = (textEditor: vscode.TextEditor) => {
    const currentLine = textEditor.selection.active.line;
    const symbols = getParserListForEditor(textEditor);
    for (let s of symbols.reverse()) {
        if (s.lineIndex < currentLine) {
            textEditor.selection = s.getEndOfLinePosition();
            textEditor.revealRange(s.getRange(LineParserRangeType.visibleText), vscode.TextEditorRevealType.InCenter);
            return;
        }
    }
}

const renameSymbolComment = async (textEditor: vscode.TextEditor, parser: LineParser) => {
    const selection = parser.getLabelSelection();
    textEditor.selection = selection;
    const result = await vscode.window.showInputBox({
        value: parser.text,
        placeHolder: "e.g. Implementation",
        title: `Rename symbol comment (line: ${parser.lineIndex + 1})`,
        validateInput: (value: string): string | undefined => {
            if (value.length > 0) {
                return undefined;
            }
            return "Cannot be empty"
        }
    });
    if (!result) return;
    await textEditor.edit(async (edit) => {
        edit.delete(selection);
        edit.insert(selection.start, result);
    });
    // textEditor.selection = new vscode.Selection(position.line, startPosition, position.line, endPosition);
}

const COMMAND_KEY_INSERT_SYMBOL: string = "extension.insertSymbolComment";
const COMMAND_KEY_MOVE_TO_NEXT_SYMBOL: string = "extension.moveToNextSymbolComment";
const COMMAND_KEY_MOVE_TO_PREVIOUS_SYMBOL: string = "extension.moveToPreviousSymbolComment";
const COMMAND_KEY_RENAME_SYMBOL: string = "extension.renameSymbolComment";

export const registerCommands = (context: vscode.ExtensionContext) => {
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(COMMAND_KEY_INSERT_SYMBOL, insertSymbolComment));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(COMMAND_KEY_MOVE_TO_NEXT_SYMBOL, moveToNextSymbolComment));
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(COMMAND_KEY_MOVE_TO_PREVIOUS_SYMBOL, moveToPreviousSymbolComment));
    context.subscriptions.push(vscode.commands.registerCommand(COMMAND_KEY_RENAME_SYMBOL, renameSymbolComment));
}

export const registerCodeActionsProviders = (context: vscode.ExtensionContext) => {
    getEnabledLanguages().forEach(({ languageId: name, lineComment, closing }) => {
        context.subscriptions.push(vscode.languages.registerCodeActionsProvider(
            name,
            new MyCodeActionProvider(lineComment, closing),
            MyCodeActionProvider.getMetadata()
        ));
    });
}

export const registerEventListeners = (context: vscode.ExtensionContext) => {
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.visibleTextEditors.filter(editor => editor.document.uri == event.document.uri);
        if (editor.length != 1) {
            throw new Error("Fix this");
        }
        updateDecorations(editor[0]);
    }));
    context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors((event) => {
        event.forEach(editor => {
            updateDecorations(editor);
        })
    }));
}

const getEnabledLanguages = (): LanguageInfo[] => {
    const disabled = Configurations.getDisabledLanguages();
    const custom = Configurations.getCustomLanguages();
    INCLUDED_DEFINED_LANGUAGES.forEach(language => {
        if (custom.findIndex(l => l.languageId == language.languageId) == -1) {
            custom.push({ ...language });
        }
    });
    return custom.filter(language => !disabled.includes(language.languageId));
}

namespace Configurations {
    const MARK_KEY: string = "mark";
    const DECORATIONS_ENABLED_KEY: string = "decorationsEnabled";
    const DISABLED_LANGUAGES_KEY: string = "languages.disabled";
    const CUSTOM_LANGUAGES_KEY: string = "languages.custom";
    const SYMBOL_LINE_NUMBERS_ENABLED_KEY: string = "symbolLineNumbersEnabled";
    export const getMark = (): string => {
        return vscode.workspace.getConfiguration(EXTENSION_CONFIG_PROPERTY_NAME).get(MARK_KEY)!;
    }
    export const getSymbolLineNumbersEnabled = (): boolean => {
        return vscode.workspace.getConfiguration(EXTENSION_CONFIG_PROPERTY_NAME).get(SYMBOL_LINE_NUMBERS_ENABLED_KEY)!;
    }
    export const getDecorationsEnabled = (): boolean => {
        return vscode.workspace.getConfiguration(EXTENSION_CONFIG_PROPERTY_NAME).get(DECORATIONS_ENABLED_KEY)!;
    }
    export const getCustomLanguages = (): LanguageInfo[] => {
        return vscode.workspace.getConfiguration(EXTENSION_CONFIG_PROPERTY_NAME).get(CUSTOM_LANGUAGES_KEY)!;
    }
    export const getDisabledLanguages = (): string[] => {
        return vscode.workspace.getConfiguration(EXTENSION_CONFIG_PROPERTY_NAME).get(DISABLED_LANGUAGES_KEY)!;
    }
}

interface LineParserParams {
    line: string;
    index: number;
    prefix: string;
    suffix?: string;
    mark: string;
    lineNumbersEnabled: boolean;
}
enum LineParserRangeType {
    fullLine,
    markWord,
    visibleText,
    labelOnly
}
class LineParser {
    private params: LineParserParams;
    readonly text: string;
    private constructor(params: LineParserParams) {
        const prefix = `${params.prefix}: `;
        const trimmedLine = params.line.trimStart();
        if (!trimmedLine.startsWith(prefix) || trimmedLine.length == prefix.length) {
            throw new Error("Invalid line");
        }
        this.params = { ...params };
        this.text = trimmedLine.replace(prefix, "");
        if (params.suffix) {
            // This could be improved
            this.text = this.text.replace(params.suffix, "");
            this.text = this.text.trimEnd();
        }
    }
    get lineIndex(): number {
        return this.params.index;
    }
    get lineLength(): number {
        return this.params.line.length;
    }
    toInfo(document: vscode.TextDocument): vscode.SymbolInformation {
        return new vscode.SymbolInformation(
            this.params.lineNumbersEnabled ? `[${this.lineIndex + 1}] ${this.text}` : this.text,
            vscode.SymbolKind.Null,
            "",
            new vscode.Location(document.uri, new vscode.Position(this.lineIndex, this.lineLength))
        );
    }
    getEndOfLinePosition(): vscode.Selection {
        const position = new vscode.Position(this.lineIndex, this.params.line.length);
        return new vscode.Selection(position, position);
    }
    getLabelSelection(): vscode.Selection {
        const range = this.getRange(LineParserRangeType.labelOnly);
        return new vscode.Selection(range.start, range.end);
    }
    getRange(rangeType: LineParserRangeType): vscode.Range {
        let start: vscode.Position;
        let end: vscode.Position;
        switch (rangeType) {
            case LineParserRangeType.fullLine:
                {
                    start = new vscode.Position(this.lineIndex, 0);
                    end = new vscode.Position(this.lineIndex, this.params.line.length);
                }
                break;
            case LineParserRangeType.markWord:
                {
                    const mark = this.params.mark;
                    const index = this.params.line.indexOf(mark);
                    if (index == -1) throw new Error("Oups... Something is wrong.");
                    start = new vscode.Position(this.lineIndex, index);
                    end = new vscode.Position(this.lineIndex, index + mark.length);
                }
                break;
            case LineParserRangeType.visibleText:
                {
                    const index = this.params.line.indexOf(this.params.prefix);
                    if (index == -1) throw new Error("Oups... Something is wrong.");
                    start = new vscode.Position(this.lineIndex, index);
                    end = new vscode.Position(this.lineIndex, this.params.line.length);
                }
                break;
            case LineParserRangeType.labelOnly:
                {
                    const mark = `${this.params.mark}: `;
                    const index = this.params.line.indexOf(mark);
                    if (index == -1) throw new Error("Oups... Something is wrong.");
                    start = new vscode.Position(this.lineIndex, index + mark.length);
                    end = new vscode.Position(this.lineIndex, this.params.line.length);
                }
                break;
            default: throw new Error(`Invalid value: ${rangeType}`);
        }
        return new vscode.Range(start, end);
    }
    private updateDecorationStyleOne(editor: vscode.TextEditor) {
        const decoration = vscode.window.createTextEditorDecorationType({
            fontWeight: "bold",
        });
        decorationsManager.register(editor, decoration);
        editor.setDecorations(decoration, [{
            range: this.getRange(LineParserRangeType.visibleText),
        }]);
    }
    private updateDecorationStyleTwo(editor: vscode.TextEditor) {
        // [Theme Color Reference](https://code.visualstudio.com/api/references/theme-color#color-formats)
        const decoration = vscode.window.createTextEditorDecorationType({
            borderWidth: "1px 0",
            borderStyle: "solid",
        });
        decorationsManager.register(editor, decoration);
        editor.setDecorations(decoration, [{ range: this.getRange(LineParserRangeType.markWord) }]);
    }
    updateDecoration(editor: vscode.TextEditor) {
        this.updateDecorationStyleTwo(editor);
        this.updateDecorationStyleOne(editor);
    }
    static fromLine(params: LineParserParams): LineParser | undefined {
        try {
            return new LineParser(params);
        } catch (_) {
            return undefined;
        }
    }
}

const buildCommentMarkPrefix = (lineComment: string): string => {
    return `${lineComment} ${Configurations.getMark()}`;
}

const getMarkPrefixAndSuffix = (editor: vscode.TextEditor): { prefix: string, suffix?: string } | undefined => {
    const id = editor.document.languageId;
    const info: LanguageInfo | undefined = getEnabledLanguages().find(info => info.languageId == id);
    if (!info) {
        return;
    }
    const prefix = buildCommentMarkPrefix(info.lineComment);
    const suffix = info.closing;
    return { prefix, suffix };
}

class MyCodeActionProvider implements vscode.CodeActionProvider {
    private lineComment: string;
    private closing?: string;
    constructor(lineComment: string, closing?: string) {
        this.lineComment = lineComment;
        this.closing = closing;
    }
    private get commentMark(): string {
        return buildCommentMarkPrefix(this.lineComment);
    }
    private get lineNumbersEnabled(): boolean {
        return Configurations.getSymbolLineNumbersEnabled();
    }
    private get mark(): string {
        return Configurations.getMark();
    }
    provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, _context: vscode.CodeActionContext, _token: vscode.CancellationToken): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined || editor.document.uri !== document.uri) {
            return undefined;
        }
        const parsers = document
            .getText(undefined)
            .split("\n")
            .map((line, index) => LineParser.fromLine({
                line,
                index,
                prefix: this.commentMark,
                suffix: this.closing,
                mark: this.mark,
                lineNumbersEnabled: this.lineNumbersEnabled
            }))
            .filter(o => o !== undefined)
            .map(o => o!);
        const parserIndex = parsers.findIndex(parser => parser.getRange(LineParserRangeType.fullLine).contains(range));
        if (parserIndex === -1) return undefined;
        const out: vscode.CodeAction[] = [];
        {
            const editMark = new vscode.CodeAction("Edit Mark Label", vscode.CodeActionKind.Empty);
            editMark.command = {
                title: editMark.title,
                command: COMMAND_KEY_RENAME_SYMBOL,
                arguments: [editor, parsers[parserIndex]]
            }
            out.push(editMark);
        }
        if (parserIndex > 0) {
            const previousMark = new vscode.CodeAction("Go To Previous Mark", vscode.CodeActionKind.Empty);
            previousMark.command = {
                title: previousMark.title,
                command: COMMAND_KEY_MOVE_TO_PREVIOUS_SYMBOL,
                arguments: [editor]
            }
            out.push(previousMark);
        }
        if (parserIndex < (parsers.length - 1)) {
            const nextMark = new vscode.CodeAction("Go To Next Mark", vscode.CodeActionKind.Empty);
            nextMark.command = {
                title: nextMark.title,
                command: COMMAND_KEY_MOVE_TO_NEXT_SYMBOL,
                arguments: [editor]
            }
            out.push(nextMark);
        }
        return out;
    }
}
namespace MyCodeActionProvider {
    export const getMetadata = (): vscode.CodeActionProviderMetadata => {
        return new class implements vscode.CodeActionProviderMetadata {
            get providedCodeActionKinds(): any[] {
                return [
                    vscode.CodeActionKind.Empty,
                ]
            }
        }
    }
}

class MyDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    private lineComment: string;
    private closing?: string;
    constructor(lineComment: string, closing?: string) {
        this.lineComment = lineComment;
        this.closing = closing;
    }
    private get commentMark(): string {
        return buildCommentMarkPrefix(this.lineComment);
    }
    private get mark(): string {
        return Configurations.getMark();
    }
    private get lineNumbersEnabled(): boolean {
        return Configurations.getSymbolLineNumbersEnabled();
    }
    public provideDocumentSymbols(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        return document
            .getText(undefined)
            .split("\n")
            .map((line, index) => LineParser.fromLine({
                line,
                index,
                prefix: this.commentMark,
                suffix: this.closing,
                mark: this.mark,
                lineNumbersEnabled: this.lineNumbersEnabled
            }))
            .filter(o => o !== undefined)
            .map(o => o!.toInfo(document));
    }
}

const getParserListForEditor = (editor: vscode.TextEditor): LineParser[] => {
    const prefixAndSuffix = getMarkPrefixAndSuffix(editor);
    if (!prefixAndSuffix) {
        return [];
    }
    const { prefix, suffix } = prefixAndSuffix;
    return editor.document
        .getText(undefined)
        .split("\n")
        .map((line, index) => LineParser.fromLine({
            line,
            index,
            prefix,
            suffix,
            mark: Configurations.getMark(),
            lineNumbersEnabled: Configurations.getSymbolLineNumbersEnabled()
        }))
        .filter(o => o !== undefined)
        .map(p => p!);
}

export const updateDecorations = (editor: vscode.TextEditor) => {
    decorationsManager.clear(editor);
    if (!Configurations.getDecorationsEnabled()) {
        return;
    }
    getParserListForEditor(editor)
        .forEach(o => o!.updateDecoration(editor));
}

export const disposeOfInternallyTrackedDisposables = () => {
    decorationsManager.clearAll();
}