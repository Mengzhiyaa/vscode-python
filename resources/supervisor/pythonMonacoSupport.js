const LANGUAGE_ID = "python";

let languageRegistered = false;
let providersRegistered = false;

const modelRegistry = new Map();

const KEYWORDS = [
    "False",
    "None",
    "True",
    "_",
    "and",
    "as",
    "assert",
    "async",
    "await",
    "break",
    "case",
    "class",
    "continue",
    "def",
    "del",
    "elif",
    "else",
    "except",
    "exec",
    "finally",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "match",
    "nonlocal",
    "not",
    "or",
    "pass",
    "print",
    "raise",
    "return",
    "try",
    "type",
    "while",
    "with",
    "yield",
    "int",
    "float",
    "long",
    "complex",
    "hex",
    "abs",
    "all",
    "any",
    "apply",
    "basestring",
    "bin",
    "bool",
    "buffer",
    "bytearray",
    "callable",
    "chr",
    "classmethod",
    "cmp",
    "coerce",
    "compile",
    "complex",
    "delattr",
    "dict",
    "dir",
    "divmod",
    "enumerate",
    "eval",
    "execfile",
    "file",
    "filter",
    "format",
    "frozenset",
    "getattr",
    "globals",
    "hasattr",
    "hash",
    "help",
    "id",
    "input",
    "intern",
    "isinstance",
    "issubclass",
    "iter",
    "len",
    "locals",
    "list",
    "map",
    "max",
    "memoryview",
    "min",
    "next",
    "object",
    "oct",
    "open",
    "ord",
    "pow",
    "print",
    "property",
    "repr",
    "reversed",
    "round",
    "self",
    "set",
    "setattr",
    "slice",
    "sorted",
    "staticmethod",
    "str",
    "sum",
    "super",
    "tuple",
    "type",
    "unichr",
    "unicode",
    "vars",
    "xrange",
    "zip",
    "__dict__",
    "__methods__",
    "__members__",
    "__class__",
    "__bases__",
    "__name__",
    "__mro__",
    "__subclasses__",
    "__init__",
    "__import__",
];

const LANGUAGE_DEFINITION = {
    defaultToken: "",
    tokenPostfix: ".python",
    keywords: KEYWORDS,
    brackets: [
        { open: "{", close: "}", token: "delimiter.curly" },
        { open: "[", close: "]", token: "delimiter.bracket" },
        { open: "(", close: ")", token: "delimiter.parenthesis" },
    ],
    tokenizer: {
        root: [
            { include: "@whitespace" },
            { include: "@numbers" },
            { include: "@strings" },
            [/[,:;]/, "delimiter"],
            [/[{}\[\]()]/, "@brackets"],
            [/@[a-zA-Z_]\w*/, "tag"],
            [
                /[a-zA-Z_]\w*/,
                {
                    cases: {
                        "@keywords": "keyword",
                        "@default": "identifier",
                    },
                },
            ],
        ],
        whitespace: [
            [/\s+/, "white"],
            [/(^#.*$)/, "comment"],
            [/'''/, "string", "@endDocString"],
            [/"""/, "string", "@endDblDocString"],
        ],
        endDocString: [
            [/[^']+/, "string"],
            [/\\'/, "string"],
            [/'''/, "string", "@popall"],
            [/'/, "string"],
        ],
        endDblDocString: [
            [/[^"]+/, "string"],
            [/\\"/, "string"],
            [/"""/, "string", "@popall"],
            [/"/, "string"],
        ],
        numbers: [
            [/-?0x([abcdef]|[ABCDEF]|\d)+[lL]?/, "number.hex"],
            [/-?(\d*\.)?\d+([eE][+\-]?\d+)?[jJ]?[lL]?/, "number"],
        ],
        strings: [
            [/'$/, "string.escape", "@popall"],
            [/f'{1,3}/, "string.escape", "@fStringBody"],
            [/'/, "string.escape", "@stringBody"],
            [/"$/, "string.escape", "@popall"],
            [/f"{1,3}/, "string.escape", "@fDblStringBody"],
            [/"/, "string.escape", "@dblStringBody"],
        ],
        fStringBody: [
            [/[^\\'\{\}]+$/, "string", "@popall"],
            [/[^\\'\{\}]+/, "string"],
            [/\{[^\}':!=]+/, "identifier", "@fStringDetail"],
            [/\\./, "string"],
            [/'/, "string.escape", "@popall"],
            [/\\$/, "string"],
        ],
        stringBody: [
            [/[^\\']+$/, "string", "@popall"],
            [/[^\\']+/, "string"],
            [/\\./, "string"],
            [/'/, "string.escape", "@popall"],
            [/\\$/, "string"],
        ],
        fDblStringBody: [
            [/[^\\"\{\}]+$/, "string", "@popall"],
            [/[^\\"\{\}]+/, "string"],
            [/\{[^\}':!=]+/, "identifier", "@fStringDetail"],
            [/\\./, "string"],
            [/"/, "string.escape", "@popall"],
            [/\\$/, "string"],
        ],
        dblStringBody: [
            [/[^\\"]+$/, "string", "@popall"],
            [/[^\\"]+/, "string"],
            [/\\./, "string"],
            [/"/, "string.escape", "@popall"],
            [/\\$/, "string"],
        ],
        fStringDetail: [
            [/[:][^}]+/, "string"],
            [/[!][ars]/, "string"],
            [/=/, "string"],
            [/\}/, "identifier", "@pop"],
        ],
    },
};

function createLanguageConfiguration(monaco) {
    return {
        comments: {
            lineComment: "#",
            blockComment: ["'''", "'''"],
        },
        brackets: [
            ["{", "}"],
            ["[", "]"],
            ["(", ")"],
        ],
        autoClosingPairs: [
            { open: "{", close: "}" },
            { open: "[", close: "]" },
            { open: "(", close: ")" },
            { open: '"', close: '"', notIn: ["string"] },
            { open: "'", close: "'", notIn: ["string", "comment"] },
        ],
        surroundingPairs: [
            { open: "{", close: "}" },
            { open: "[", close: "]" },
            { open: "(", close: ")" },
            { open: '"', close: '"' },
            { open: "'", close: "'" },
        ],
        onEnterRules: [
            {
                beforeText: new RegExp(
                    "^\\s*(?:def|class|for|if|elif|else|while|try|with|finally|except|async|match|case).*?:\\s*$",
                ),
                action: { indentAction: monaco.languages.IndentAction.Indent },
            },
        ],
        folding: {
            offSide: true,
            markers: {
                start: new RegExp("^\\s*#region\\b"),
                end: new RegExp("^\\s*#endregion\\b"),
            },
        },
    };
}

function getModelContext(model) {
    return modelRegistry.get(model);
}

function formatDocumentation(value) {
    if (!value) {
        return undefined;
    }

    if (typeof value === "string") {
        return value;
    }

    if (typeof value === "object" && typeof value.value === "string") {
        return {
            value: value.value,
            isTrusted: true,
        };
    }

    return String(value);
}

function toCompletionRange(model, position) {
    const word = model.getWordUntilPosition(position);
    return {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
    };
}

function mapLspCompletionKind(monaco, kind) {
    switch (kind) {
        case 1:
            return monaco.languages.CompletionItemKind.Text;
        case 2:
            return monaco.languages.CompletionItemKind.Method;
        case 3:
            return monaco.languages.CompletionItemKind.Function;
        case 4:
            return monaco.languages.CompletionItemKind.Constructor;
        case 5:
            return monaco.languages.CompletionItemKind.Field;
        case 6:
            return monaco.languages.CompletionItemKind.Variable;
        case 7:
            return monaco.languages.CompletionItemKind.Class;
        case 8:
            return monaco.languages.CompletionItemKind.Interface;
        case 9:
            return monaco.languages.CompletionItemKind.Module;
        case 10:
            return monaco.languages.CompletionItemKind.Property;
        case 11:
            return monaco.languages.CompletionItemKind.Unit;
        case 12:
            return monaco.languages.CompletionItemKind.Value;
        case 13:
            return monaco.languages.CompletionItemKind.Enum;
        case 14:
            return monaco.languages.CompletionItemKind.Keyword;
        case 15:
            return monaco.languages.CompletionItemKind.Snippet;
        case 16:
            return monaco.languages.CompletionItemKind.Color;
        case 17:
            return monaco.languages.CompletionItemKind.File;
        case 18:
            return monaco.languages.CompletionItemKind.Reference;
        case 19:
            return monaco.languages.CompletionItemKind.Folder;
        case 21:
            return monaco.languages.CompletionItemKind.Constant;
        case 24:
            return monaco.languages.CompletionItemKind.Operator;
        default:
            return monaco.languages.CompletionItemKind.Text;
    }
}

function mapKernelCompletionKind(monaco, kind) {
    switch (kind) {
        case "class":
            return monaco.languages.CompletionItemKind.Class;
        case "constant":
            return monaco.languages.CompletionItemKind.Constant;
        case "field":
            return monaco.languages.CompletionItemKind.Field;
        case "function":
            return monaco.languages.CompletionItemKind.Function;
        case "keyword":
            return monaco.languages.CompletionItemKind.Keyword;
        case "method":
            return monaco.languages.CompletionItemKind.Method;
        case "module":
            return monaco.languages.CompletionItemKind.Module;
        case "property":
            return monaco.languages.CompletionItemKind.Property;
        case "variable":
            return monaco.languages.CompletionItemKind.Variable;
        default:
            return monaco.languages.CompletionItemKind.Text;
    }
}

async function requestLspCompletion(connection, sessionId, code, position) {
    const result = await connection.sendRequest("lsp/completion", {
        code,
        position,
        sessionId,
    });

    if (!result || !Array.isArray(result.items)) {
        return { items: [], isIncomplete: false };
    }

    return {
        items: result.items,
        isIncomplete: !!result.isIncomplete,
    };
}

export function registerLanguage(monaco) {
    if (languageRegistered) {
        return;
    }

    if (!monaco.languages.getLanguages().some((language) => language.id === LANGUAGE_ID)) {
        monaco.languages.register({
            id: LANGUAGE_ID,
            extensions: [".py", ".pyw"],
            aliases: ["Python", "py"],
            firstLine: "^#!/.*\\bpython[0-9.-]*\\b",
        });
    }

    monaco.languages.setLanguageConfiguration(
        LANGUAGE_ID,
        createLanguageConfiguration(monaco),
    );
    // NOTE: Do NOT register a Monarch tokenizer here.
    // The supervisor framework provides TextMate tokenization via
    // MagicPython.tmLanguage.json (ensureLanguageTextMateTokenizerReady).
    // Monarch tokens (e.g. "keyword") are incompatible with the TextMate
    // theme rules (e.g. "keyword.control.flow.python"), causing broken
    // highlighting. This aligns with how vscode-ark handles R.
    languageRegistered = true;
}

export async function ensureTokenizerReady() {
    return;
}

export function ensureProviders(monaco) {
    if (providersRegistered) {
        return;
    }

    providersRegistered = true;

    monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
        triggerCharacters: [".", "_"],
        provideCompletionItems: async (model, position) => {
            const context = getModelContext(model);
            if (!context) {
                return { suggestions: [] };
            }

            const { connection, sessionId } = context;
            const code = model.getValue();
            const lspPosition = {
                line: position.lineNumber - 1,
                character: position.column - 1,
            };

            try {
                const lspResult = await requestLspCompletion(
                    connection,
                    sessionId,
                    code,
                    lspPosition,
                );

                if (lspResult.items.length > 0) {
                    return {
                        suggestions: lspResult.items.map((item) => {
                            const insertText =
                                item.insertText ||
                                (item.textEdit && item.textEdit.newText) ||
                                item.label;
                            const hasSnippetSyntax =
                                typeof insertText === "string" &&
                                /(?:\$\d|\$\{)/.test(insertText);

                            return {
                                label: item.label,
                                kind: mapLspCompletionKind(monaco, item.kind),
                                detail: item.detail,
                                documentation: formatDocumentation(item.documentation),
                                insertText,
                                insertTextRules: hasSnippetSyntax
                                    ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                                    : undefined,
                                filterText: item.filterText,
                                sortText: item.sortText,
                                range: toCompletionRange(model, position),
                            };
                        }),
                        incomplete: lspResult.isIncomplete,
                    };
                }

                const kernelResult = await connection.sendRequest("console/complete", {
                    code,
                    cursorPos: model.getOffsetAt(position),
                    sessionId,
                });

                const items = Array.isArray(kernelResult && kernelResult.items)
                    ? kernelResult.items
                    : [];

                return {
                    suggestions: items.map((item) => ({
                        label: item.label,
                        kind: mapKernelCompletionKind(monaco, item.kind),
                        detail: item.detail,
                        insertText: item.insertText || item.label,
                        range: toCompletionRange(model, position),
                    })),
                };
            } catch (error) {
                console.error("[pythonMonacoSupport] Completion request failed", error);
                return { suggestions: [] };
            }
        },
    });

    monaco.languages.registerHoverProvider(LANGUAGE_ID, {
        provideHover: async (model, position) => {
            const context = getModelContext(model);
            if (!context) {
                return null;
            }

            const { connection, sessionId } = context;
            const code = model.getValue();

            try {
                const result = await connection.sendRequest("lsp/hover", {
                    code,
                    position: {
                        line: position.lineNumber - 1,
                        character: position.column - 1,
                    },
                    sessionId,
                });

                if (!result) {
                    return null;
                }

                const contents = [];
                if (typeof result.contents === "string") {
                    contents.push({ value: result.contents });
                } else if (Array.isArray(result.contents)) {
                    for (const part of result.contents) {
                        contents.push({
                            value: typeof part === "string" ? part : part.value,
                            isTrusted: true,
                        });
                    }
                } else if (result.contents && typeof result.contents.value === "string") {
                    contents.push({
                        value: result.contents.value,
                        isTrusted: true,
                    });
                }

                let range;
                if (result.range) {
                    range = {
                        startLineNumber: result.range.start.line + 1,
                        startColumn: result.range.start.character + 1,
                        endLineNumber: result.range.end.line + 1,
                        endColumn: result.range.end.character + 1,
                    };
                }

                return {
                    contents,
                    range,
                };
            } catch (error) {
                console.error("[pythonMonacoSupport] Hover request failed", error);
                return null;
            }
        },
    });

    monaco.languages.registerSignatureHelpProvider(LANGUAGE_ID, {
        signatureHelpTriggerCharacters: ["(", ","],
        signatureHelpRetriggerCharacters: [",", ")"],
        provideSignatureHelp: async (model, position) => {
            const context = getModelContext(model);
            if (!context) {
                return null;
            }

            const { connection, sessionId } = context;
            const code = model.getValue();

            try {
                const result = await connection.sendRequest("lsp/signatureHelp", {
                    code,
                    position: {
                        line: position.lineNumber - 1,
                        character: position.column - 1,
                    },
                    sessionId,
                });

                if (!result || !Array.isArray(result.signatures) || result.signatures.length === 0) {
                    return null;
                }

                return {
                    value: {
                        signatures: result.signatures.map((signature) => ({
                            label: signature.label,
                            documentation: formatDocumentation(signature.documentation),
                            parameters: Array.isArray(signature.parameters)
                                ? signature.parameters.map((parameter) => ({
                                    label: parameter.label,
                                    documentation: formatDocumentation(parameter.documentation),
                                }))
                                : [],
                        })),
                        activeSignature: result.activeSignature || 0,
                        activeParameter: result.activeParameter || 0,
                    },
                    dispose() {},
                };
            } catch (error) {
                console.error("[pythonMonacoSupport] Signature help request failed", error);
                return null;
            }
        },
    });
}

export function registerModel(_monaco, model, sessionId, connection) {
    modelRegistry.set(model, {
        sessionId,
        connection,
    });
}

export function unregisterModel(_monaco, model) {
    modelRegistry.delete(model);
}
