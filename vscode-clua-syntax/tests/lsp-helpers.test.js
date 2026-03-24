"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createLspHelpers } = require("../server/lsp-helpers");

function makeHelpers(overrides = {}) {
	return createLspHelpers({
		documents: { get: () => null },
		getWorkspaceFolders: () => [],
		getImportSuggestionsCached: () => new Map(),
		debugLog: () => {},
		buildModel: (text) => ({ lines: String(text || "").split(/\r?\n/), classes: new Map(), imports: [] }),
		buildWorkspaceIndex: () => new Map(),
		resolveModulePathToFile: () => null,
		pathToFileUri: () => null,
		readDocumentTextByUri: () => null,
		inferExpressionType: () => null,
		resolveClassByType: () => null,
		getMethodOverloads: () => [],
		...overrides,
	});
}

test("getWordAt resolves token under cursor", () => {
	const helpers = makeHelpers();
	const token = helpers.getWordAt("local helloWorld = 1", 9);
	assert.equal(token.word, "helloWorld");
	assert.equal(token.start, 6);
	assert.equal(token.end, 16);
});

test("getImportContextAtPosition identifies import module token", () => {
	const helpers = makeHelpers();
	const line = "import clua.std.Option";
	const token = helpers.getWordAt(line, line.length - 1);
	const ctx = helpers.getImportContextAtPosition(line, line.length - 1, token);
	assert.equal(ctx.modulePath, "clua.std.Option");
	assert.equal(ctx.terminalName, "Option");
});

test("extractCallContext tracks active parameter inside nested calls", () => {
	const helpers = makeHelpers();
	const ctx = helpers.extractCallContext("foo(bar(1), baz(");
	assert.equal(ctx.callee, "baz");
	assert.equal(ctx.activeParameter, 0);
	assert.equal(ctx.argumentCount, 0);
});

test("buildTypeParamMap and applyTypeParamMap specialize generic types", () => {
	const helpers = makeHelpers();
	const map = helpers.buildTypeParamMap({ typeParams: ["T", "K"] }, "Pair<number, string>");
	assert.equal(helpers.applyTypeParamMap("Map<T, K>", map), "Map<number, string>");
});

test("resolveCallSignature chooses closest overload by arity", () => {
	const classInfo = { name: "Foo" };
	const overloads = [
		{ params: [{ name: "a" }] },
		{ params: [{ name: "a" }, { name: "b" }, { name: "c" }] },
	];

	const helpers = makeHelpers({
		resolveClassByType: () => ({ classInfo }),
		getMethodOverloads: () => overloads,
	});

	const resolved = helpers.resolveCallSignature(
		{ callee: "new Foo", activeParameter: 2, argumentCount: 3 },
		{ classes: new Map() },
		null,
		null,
		new Map(),
	);

	assert.equal(resolved.activeSignature, 1);
	assert.equal(resolved.overloads.length, 2);
});
