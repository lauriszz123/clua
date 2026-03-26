"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getContextAwareSnippetItems } = require("../server/completion");
const { registerCompletionHandler } = require("../server/completion-handler");
const { buildModel, getClassAtLine, getMethodAtLine } = require("../server/parser");
const { createLspHelpers } = require("../server/lsp-helpers");

const CompletionItemKind = { Snippet: 15, Method: 2, Field: 5 };
const InsertTextFormat = { Snippet: 2 };

test("completion suggests catch and finally inside a try block", () => {
	const lines = ["try", "\tlocal a = 1", ""]; 
	const items = getContextAwareSnippetItems({
		lines,
		lineIndex: 2,
		beforeCursor: "",
		CompletionItemKind,
		InsertTextFormat,
	});

	const labels = items.map((item) => item.label);
	assert.ok(labels.includes("catch"));
	assert.ok(labels.includes("finally"));
});

test("completion suggests only finally after catch", () => {
	const lines = ["try", "\twork()", "catch err", ""]; 
	const items = getContextAwareSnippetItems({
		lines,
		lineIndex: 3,
		beforeCursor: "",
		CompletionItemKind,
		InsertTextFormat,
	});

	const labels = items.map((item) => item.label);
	assert.ok(!labels.includes("catch"));
	assert.ok(labels.includes("finally"));
});

test("completion suppresses snippets for member access contexts", () => {
	const lines = ["obj."]; 
	const items = getContextAwareSnippetItems({
		lines,
		lineIndex: 0,
		beforeCursor: "obj.",
		CompletionItemKind,
		InsertTextFormat,
	});

	assert.equal(items.length, 0);
});

test("member completion returns snippet insert text for generic methods", async () => {
	const uri = "file:///test.clua";
	const text = [
		"class List<T>",
		"\tfunction forEach(func: function(item: T))",
		"\tend",
		"end",
		"",
		"class Demo",
		"\tfunction demo()",
		"\t\tlocal xs: List<number> = new List<number>()",
		"\t\txs.for",
		"\tend",
		"end",
	].join("\n");

	const docs = new Map([[uri, { getText: () => text }]]);

	const helpers = createLspHelpers({
		documents: { get: (docUri) => docs.get(docUri) },
		getWorkspaceFolders: () => [],
		getImportSuggestionsCached: () => new Map(),
		debugLog: () => {},
		buildModel,
		buildWorkspaceIndex: (_activeUri, activeModel) => {
			const index = new Map();
			for (const classInfo of activeModel.classes.values()) {
				index.set(classInfo.name, { uri, classInfo });
			}
			return index;
		},
		resolveModulePathToFile: () => null,
		pathToFileUri: () => uri,
		readDocumentTextByUri: (docUri) => {
			if (docUri === uri) return text;
			return null;
		},
		inferExpressionType: (expr, model, classInfo, methodInfo) => {
			if (!methodInfo) {
				const resolvedClassInfo = getClassAtLine(model, 8);
				methodInfo = getMethodAtLine(resolvedClassInfo, 8);
			}
			if (expr === "xs") {
				return methodInfo.locals.get("xs").typeName;
			}
			return null;
		},
		resolveClassByType: (typeName, model, workspaceIndex) => {
			const bare = String(typeName || "").replace(/<.*$/, "");
			const entry = workspaceIndex.get(bare);
			return entry ? { classInfo: entry.classInfo } : null;
		},
		getMethodOverloads: () => [],
	});

	let completionHandler = null;
	registerCompletionHandler({
		connection: { onCompletion: (handler) => { completionHandler = handler; } },
		documents: { get: (docUri) => docs.get(docUri) },
		CompletionItemKind,
		InsertTextFormat,
		buildModel,
		buildWorkspaceIndexWithImports: helpers.buildWorkspaceIndexWithImports,
		getClassAtLine,
		getMethodAtLine,
		getCompletionTargetClass: helpers.getCompletionTargetClass,
		getImportSuggestionsCached: () => new Map(),
		getImportContextAtPosition: helpers.getImportContextAtPosition,
		resolveImportClassTarget: helpers.resolveImportClassTarget,
		applyTypeParamMap: helpers.applyTypeParamMap,
		specializeMethod: helpers.specializeMethod,
		specializeDocs: helpers.specializeDocs,
		getDisplayParams: ({ params }) => params,
		renderDocsText: () => undefined,
		buildMethodDisplayLabel: () => "",
		BUILTIN_TYPES: new Set(),
		LUA_GLOBALS: {},
		LUA_LIBS: {},
		LOVE_NAMESPACES: {},
		getLoveChildren: () => [],
		getMethodOverloads: () => [],
	});

	assert.ok(completionHandler);
	const items = await completionHandler({
		textDocument: { uri },
		position: { line: 8, character: 8 },
	});

	const forEach = items.find((item) => item.label === "forEach");
	assert.ok(forEach);
	assert.equal(forEach.insertTextFormat, InsertTextFormat.Snippet);
	assert.equal(forEach.insertText, "forEach(${1:func: function(item:number)})");
	assert.equal(items.some((item) => item.label === "new"), false);
});
