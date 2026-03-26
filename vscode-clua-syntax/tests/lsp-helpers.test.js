"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { createLspHelpers } = require("../server/lsp-helpers");
const workspace = require("../server/workspace");
const parser = require("../server/parser");

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

test("resolveModulePathToFile prefers authoritative LuaRocks CLua install for std modules", () => {
	const originalExecFileSync = require("node:child_process").execFileSync;
	const originalExistsSync = require("node:fs").existsSync;

	require("node:child_process").execFileSync = () =>
		"Installed in: C:/LuaRocks/rocks\n";
	require("node:fs").existsSync = (targetPath) =>
		targetPath ===
			path.normalize("C:/LuaRocks/rocks/share/lua/5.4/clua/std/List/List.clua");

	try {
		const resolved = workspace.resolveModulePathToFile(
			"std.List",
			null,
			[],
			null,
		);
		assert.equal(
			resolved,
			path.normalize("C:/LuaRocks/rocks/share/lua/5.4/clua/std/List/List.clua"),
		);
	} finally {
		require("node:child_process").execFileSync = originalExecFileSync;
		require("node:fs").existsSync = originalExistsSync;
	}
});

test("resolveCallbackParameterType infers callback param type from generic receiver", () => {
	const text = [
		"class List<T>",
		"\tfunction forEach(func: function(item: T))",
		"\tend",
		"end",
		"",
		"class Scene",
		"\tfunction draw()",
		"\tend",
		"end",
		"",
		"class SceneController",
		"\tlocal scenes: List<Scene>",
		"\tfunction draw()",
		"\t\tself.scenes.forEach(function(scene)",
		"\t\t\tscene.draw()",
		"\t\tend)",
		"\tend",
		"end",
	].join("\n");

	const model = parser.buildModel(text);
	const classInfo = parser.getClassAtLine(model, 14);
	const methodInfo = parser.getMethodAtLine(classInfo, 14);

	const helpers = makeHelpers({
		inferExpressionType: parser.inferExpressionType,
		resolveClassByType: parser.resolveClassByType,
		getMethodOverloads: parser.getMethodOverloads,
	});

	const callbackType = helpers.resolveCallbackParameterType(
		model.lines,
		14,
		"scene",
		model,
		classInfo,
		methodInfo,
		new Map(),
	);

	assert.equal(callbackType, "Scene");
});

test("resolveCallSignature resolves callback receiver methods", () => {
	const text = [
		"class List<T>",
		"\tfunction forEach(func: function(item: T))",
		"\tend",
		"end",
		"",
		"class Scene",
		"\tfunction draw()",
		"\tend",
		"end",
		"",
		"class SceneController",
		"\tlocal scenes: List<Scene>",
		"\tfunction update()",
		"\t\tself.scenes.forEach(function(scene)",
		"\t\t\tscene.draw(",
		"\t\tend)",
		"\tend",
		"end",
	].join("\n");

	const model = parser.buildModel(text);
	const classInfo = parser.getClassAtLine(model, 14);
	const methodInfo = parser.getMethodAtLine(classInfo, 14);

	const helpers = makeHelpers({
		inferExpressionType: parser.inferExpressionType,
		resolveClassByType: parser.resolveClassByType,
		getMethodOverloads: parser.getMethodOverloads,
	});

	const callContext = helpers.extractCallContext("\t\t\tscene.draw(");
	const resolved = helpers.resolveCallSignature(
		callContext,
		model,
		classInfo,
		methodInfo,
		new Map(),
		14,
	);

	assert.ok(resolved);
	assert.equal(resolved.labelPrefix, "Scene.draw");
	assert.ok(Array.isArray(resolved.overloads));
	assert.equal(resolved.overloads.length > 0, true);
});

test("resolveCallbackParameterType supports multi-parameter callback signatures", () => {
	const text = [
		"class List<T>",
		"\tfunction forEachIndexed(func: function(item: T, index: number))",
		"\tend",
		"end",
		"",
		"class Scene",
		"end",
		"",
		"class SceneController",
		"\tlocal scenes: List<Scene>",
		"\tfunction draw()",
		"\t\tself.scenes.forEachIndexed(function(scene, i)",
		"\t\t\tprint(i)",
		"\t\tend)",
		"\tend",
		"end",
	].join("\n");

	const model = parser.buildModel(text);
	const classInfo = parser.getClassAtLine(model, 12);
	const methodInfo = parser.getMethodAtLine(classInfo, 12);

	const helpers = makeHelpers({
		inferExpressionType: parser.inferExpressionType,
		resolveClassByType: parser.resolveClassByType,
		getMethodOverloads: parser.getMethodOverloads,
	});

	const callbackType = helpers.resolveCallbackParameterType(
		model.lines,
		12,
		"i",
		model,
		classInfo,
		methodInfo,
		new Map(),
	);

	assert.equal(callbackType, "number");
});

test("resolveCallbackParameterType supports nested callbacks", () => {
	const text = [
		"class List<T>",
		"\tfunction forEach(func: function(item: T))",
		"\tend",
		"end",
		"",
		"class Scene",
		"\tfunction draw()",
		"\tend",
		"end",
		"",
		"class SceneController",
		"\tlocal scenes: List<List<Scene>>",
		"\tfunction draw()",
		"\t\tself.scenes.forEach(function(group)",
		"\t\t\tgroup.forEach(function(scene)",
		"\t\t\t\tscene.draw()",
		"\t\t\tend)",
		"\t\tend)",
		"\tend",
		"end",
	].join("\n");

	const model = parser.buildModel(text);
	const classInfo = parser.getClassAtLine(model, 15);
	const methodInfo = parser.getMethodAtLine(classInfo, 15);

	const helpers = makeHelpers({
		inferExpressionType: parser.inferExpressionType,
		resolveClassByType: parser.resolveClassByType,
		getMethodOverloads: parser.getMethodOverloads,
	});

	const callbackType = helpers.resolveCallbackParameterType(
		model.lines,
		15,
		"scene",
		model,
		classInfo,
		methodInfo,
		new Map(),
	);

	assert.equal(callbackType, "Scene");
});
