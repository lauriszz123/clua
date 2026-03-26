const {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	TextDocumentSyncKind,
	CompletionItemKind,
	InsertTextFormat,
} = require("vscode-languageserver/node");
const { TextDocument } = require("vscode-languageserver-textdocument");

const {
	BUILTIN_TYPES,
	buildModel,
	getClassAtLine,
	getMethodAtLine,
	getMethodOverloads,
	findParam,
	inferExpressionType,
	resolveClassByType,
} = require("./parser");
const {
	fileUriToPath,
	pathToFileUri,
	readDocumentTextByUri,
	buildWorkspaceIndex,
	buildImportSuggestions,
	resolveModulePathToFile,
	buildWorkspaceSymbols,
} = require("./workspace");
const {
	renderDocsText,
	makeHover,
	getDisplayParams,
	buildMethodDisplayLabel,
	buildClassHoverData,
	buildClassTypeHoverData,
	buildSignatureInformation,
} = require("./render");
const { validateTextDocument } = require("./diagnostics");
const { LUA_GLOBALS, LUA_LIBS } = require("./lua-stdlib");
const { formatDocument } = require("./formatter");
const { registerCompletionHandler } = require("./completion-handler");
const { registerHoverHandler } = require("./hover-handler");
const { registerDefinitionHandler } = require("./definition-handler");
const { createLspHelpers } = require("./lsp-helpers");
const {
	LOVE_NAMESPACES,
	getLoveChildren,
	getLoveFunction,
	getLoveNamespace,
} = require("./love-api");

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let workspaceFolders = [];
const importSuggestionsCache = new Map();
const ALWAYS_LSP_LOGS = true;
const IDENTIFIER_TRIGGER_CHARACTERS =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_".split("");

function debugLog(message) {
	if (!ALWAYS_LSP_LOGS) {
		return;
	}
	connection.console.log(`[clua-lsp] ${message}`);
}

function clearImportSuggestionCache() {
	importSuggestionsCache.clear();
}

function getImportSuggestionsCached(activeUri) {
	const cacheKey = "workspace";
	if (importSuggestionsCache.has(cacheKey)) {
		return importSuggestionsCache.get(cacheKey);
	}

	const suggestions = buildImportSuggestions(null, workspaceFolders);
	importSuggestionsCache.set(cacheKey, suggestions);
	return suggestions;
}

connection.onInitialize((params) => {
	workspaceFolders = [];
	if (
		Array.isArray(params.workspaceFolders) &&
		params.workspaceFolders.length > 0
	) {
		workspaceFolders = params.workspaceFolders.map((folder) => folder.uri);
	} else if (params.rootUri) {
		workspaceFolders = [params.rootUri];
	}
	debugLog(
		`initialize workspaceFolders=${workspaceFolders.join(",") || "<none>"}`,
	);
	clearImportSuggestionCache();

	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: {
				resolveProvider: false,
				triggerCharacters: [".", " ", ...IDENTIFIER_TRIGGER_CHARACTERS],
			},
			hoverProvider: true,
			definitionProvider: true,
			workspaceSymbolProvider: true,
			signatureHelpProvider: {
				triggerCharacters: ["(", ","],
			},
			documentFormattingProvider: true,
			documentRangeFormattingProvider: true,
		},
	};
});
const {
	getWordAt,
	canAccessPrivateMembers,
	getImportContextAtPosition,
	getImportedModuleForSymbol,
	resolveImportClassTarget,
	buildWorkspaceIndexWithImports,
	buildTypeParamMap,
	getCompletionTargetClass,
	extractCallContext,
	applyTypeParamMap,
	specializeDocs,
	specializeMethod,
	resolveCallSignature,
	resolveCallbackParameterType,
} = createLspHelpers({
	documents,
	getWorkspaceFolders: () => workspaceFolders,
	getImportSuggestionsCached,
	debugLog,
	buildModel,
	buildWorkspaceIndex,
	resolveModulePathToFile,
	pathToFileUri,
	readDocumentTextByUri,
	inferExpressionType,
	resolveClassByType,
	getMethodOverloads,
});

// ---------- LSP handlers ----------
registerHoverHandler({
	connection,
	documents,
	debugLog,
	buildModel,
	buildWorkspaceIndexWithImports,
	getWordAt,
	getImportContextAtPosition,
	resolveImportClassTarget,
	getClassAtLine,
	getMethodAtLine,
	canAccessPrivateMembers,
	inferExpressionType,
	resolveClassByType,
	getMethodOverloads,
	buildTypeParamMap,
	specializeMethod,
	specializeDocs,
	applyTypeParamMap,
	getImportedModuleForSymbol,
	findParam,
	LUA_LIBS,
	LUA_GLOBALS,
	makeHover,
	buildMethodDisplayLabel,
	buildClassHoverData,
	buildClassTypeHoverData,
	getLoveFunction,
	getLoveNamespace,
	resolveCallbackParameterType,
});

registerCompletionHandler({
	connection,
	documents,
	CompletionItemKind,
	InsertTextFormat,
	buildModel,
	buildWorkspaceIndexWithImports,
	getClassAtLine,
	getMethodAtLine,
	getCompletionTargetClass,
	getImportSuggestionsCached,
	getImportContextAtPosition,
	resolveImportClassTarget,
	applyTypeParamMap,
	specializeMethod,
	specializeDocs,
	getDisplayParams,
	renderDocsText,
	buildMethodDisplayLabel,
	BUILTIN_TYPES,
	LUA_GLOBALS,
	LUA_LIBS,
	LOVE_NAMESPACES,
	getLoveChildren,
	getMethodOverloads,
	resolveCallbackParameterType,
	resolveClassByType,
	buildTypeParamMap,
});

registerDefinitionHandler({
	connection,
	documents,
	buildModel,
	buildWorkspaceIndexWithImports,
	getWordAt,
	getImportContextAtPosition,
	resolveImportClassTarget,
	getClassAtLine,
	getMethodAtLine,
	canAccessPrivateMembers,
	inferExpressionType,
	resolveClassByType,
	getMethodOverloads,
	getImportedModuleForSymbol,
	resolveCallbackParameterType,
});

connection.onSignatureHelp((params) => {
	const document = documents.get(params.textDocument.uri);
	if (!document) {
		return null;
	}

	const model = buildModel(document.getText());
	const workspaceIndex = buildWorkspaceIndexWithImports(document.uri, model);
	const lineText = model.lines[params.position.line] || "";
	const beforeCursor = lineText.slice(0, params.position.character);
	const classInfo = getClassAtLine(model, params.position.line);
	const methodInfo = getMethodAtLine(classInfo, params.position.line);
	const callContext = extractCallContext(beforeCursor);

	if (callContext) {
		const loveEntry = getLoveFunction(callContext.callee);
		if (loveEntry) {
			const fakeDocs = {
				description: loveEntry.doc,
				params: new Map((loveEntry.params || []).map((p) => [p.name, p])),
			};
			const fakeMethod = { params: loveEntry.params || [] };
			return {
				signatures: [
					buildSignatureInformation(
						loveEntry.signature.replace(/\(.*/, ""),
						fakeMethod,
						fakeDocs,
					),
				],
				activeSignature: 0,
				activeParameter: Math.min(
					callContext.activeParameter,
					Math.max((loveEntry.params || []).length - 1, 0),
				),
			};
		}

		// Stdlib global signature help
		if (LUA_GLOBALS[callContext.callee]) {
			const entry = LUA_GLOBALS[callContext.callee];
			const fakeDocs = {
				description: entry.doc,
				params: new Map((entry.params || []).map((p) => [p.name, p])),
			};
			const fakeMethod = { params: entry.params || [] };
			return {
				signatures: [
					buildSignatureInformation(
						entry.signature.replace(/\(.*/, ""),
						fakeMethod,
						fakeDocs,
					),
				],
				activeSignature: 0,
				activeParameter: Math.min(
					callContext.activeParameter,
					Math.max((entry.params || []).length - 1, 0),
				),
			};
		}

		// Stdlib lib.method signature help
		const libMethodMatch = callContext.callee.match(
			/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/,
		);
		if (
			libMethodMatch &&
			LUA_LIBS[libMethodMatch[1]] &&
			LUA_LIBS[libMethodMatch[1]][libMethodMatch[2]]
		) {
			const entry = LUA_LIBS[libMethodMatch[1]][libMethodMatch[2]];
			const fakeDocs = {
				description: entry.doc,
				params: new Map((entry.params || []).map((p) => [p.name, p])),
			};
			const fakeMethod = { params: entry.params || [] };
			return {
				signatures: [
					buildSignatureInformation(
						entry.signature.replace(/\(.*/, ""),
						fakeMethod,
						fakeDocs,
					),
				],
				activeSignature: 0,
				activeParameter: Math.min(
					callContext.activeParameter,
					Math.max((entry.params || []).length - 1, 0),
				),
			};
		}
	}

	const resolved = resolveCallSignature(
		callContext,
		model,
		classInfo,
		methodInfo,
		workspaceIndex,
		params.position.line,
	);
	if (!resolved) {
		return null;
	}

	const signatures = resolved.overloads.map((overload) => {
		const specializedOverload = specializeMethod(
			overload,
			resolved.typeParamMap,
		);
		const specializedDocs = specializeDocs(
			overload.docs,
			resolved.typeParamMap,
		);
		return buildSignatureInformation(
			resolved.labelPrefix,
			specializedOverload,
			specializedDocs,
		);
	});

	const activeSignature =
		resolved.activeSignature >= 0 &&
		resolved.activeSignature < signatures.length
			? resolved.activeSignature
			: 0;

	const activeOverload =
		resolved.overloads[activeSignature] || resolved.overloads[0];
	const maxParamIndex = Math.max(
		((activeOverload && activeOverload.params) || []).length - 1,
		0,
	);

	return {
		signatures,
		activeSignature,
		activeParameter: Math.min(callContext.activeParameter, maxParamIndex),
	};
});

connection.onWorkspaceSymbol((params) => {
	const workspaceIndex = buildWorkspaceIndex(
		null,
		null,
		documents,
		workspaceFolders,
	);
	return buildWorkspaceSymbols(workspaceIndex, params.query);
});

function sendDiagnostics(document) {
	const model = buildModel(document.getText());
	const workspaceIndex = buildWorkspaceIndexWithImports(document.uri, model);
	const diagnostics = validateTextDocument(document, workspaceIndex, {
		resolveImport: (modulePath) =>
			resolveImportTarget(modulePath, document.uri),
		resolveCallbackParameterType: (lines, lineIdx, paramName, model, classInfo, methodInfo, wi) =>
			resolveCallbackParameterType(lines, lineIdx, paramName, model, classInfo, methodInfo, wi),
	});
	debugLog(`diagnostics uri=${document.uri} count=${diagnostics.length}`);
	connection.sendDiagnostics({
		uri: document.uri,
		diagnostics,
	});
}

documents.onDidOpen((event) => {
	clearImportSuggestionCache();
	sendDiagnostics(event.document);
});

documents.onDidChangeContent((change) => {
	clearImportSuggestionCache();
	sendDiagnostics(change.document);
});

documents.onDidSave((event) => {
	clearImportSuggestionCache();
	sendDiagnostics(event.document);
});

connection.onDocumentFormatting((params) => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return [];
	const newText = formatDocument(
		document.getText(),
		params.options.tabSize || 4,
		params.options.insertSpaces !== false,
	);
	return [
		{
			range: {
				start: { line: 0, character: 0 },
				end: { line: document.lineCount, character: 0 },
			},
			newText,
		},
	];
});

connection.onDocumentRangeFormatting((params) => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return [];
	// Format the whole document for simplicity (range formatting is tricky with block depth).
	const newText = formatDocument(
		document.getText(),
		params.options.tabSize || 4,
		params.options.insertSpaces !== false,
	);
	return [
		{
			range: {
				start: { line: 0, character: 0 },
				end: { line: document.lineCount, character: 0 },
			},
			newText,
		},
	];
});

documents.listen(connection);
connection.listen();
