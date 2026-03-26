"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateTextDocument } = require("../server/diagnostics");
const { createLspHelpers } = require("../server/lsp-helpers");
const parser = require("../server/parser");

function makeResolveCallbackParameterType() {
	const helpers = createLspHelpers({
		documents: { get: () => null },
		getWorkspaceFolders: () => [],
		getImportSuggestionsCached: () => new Map(),
		debugLog: () => {},
		buildModel: parser.buildModel,
		buildWorkspaceIndex: () => new Map(),
		resolveModulePathToFile: () => null,
		pathToFileUri: () => null,
		readDocumentTextByUri: () => null,
		inferExpressionType: parser.inferExpressionType,
		resolveClassByType: parser.resolveClassByType,
		getMethodOverloads: parser.getMethodOverloads,
	});
	return helpers.resolveCallbackParameterType;
}

function validate(text) {
	const document = {
		getText() {
			return text;
		},
	};
	return validateTextDocument(document, new Map());
}

function validateWithCallbacks(text) {
	const document = {
		getText() {
			return text;
		},
	};
	return validateTextDocument(document, new Map(), {
		resolveCallbackParameterType: makeResolveCallbackParameterType(),
	});
}

test("diagnostics flags local default type mismatch", () => {
	const text = [
		"class App",
		"\tfunction run()",
		"\t\tlocal x: string = 1",
		"\tend",
		"end",
	].join("\n");

	const diagnostics = validate(text);
	assert.ok(
		diagnostics.some((d) =>
			d.message.includes("Type mismatch for x: expected string, got number"),
		),
	);
});

test("diagnostics flags return type mismatches", () => {
	const text = [
		"class App",
		"\tfunction run(): number",
		"\t\treturn \"bad\"",
		"\tend",
		"end",
	].join("\n");

	const diagnostics = validate(text);
	assert.ok(
		diagnostics.some((d) =>
			d.message.includes("Return type mismatch in App.run: expected number, got string"),
		),
	);
});

test("diagnostics flags unknown return type", () => {
	const text = [
		"class App",
		"\tfunction run(): MissingType",
		"\t\treturn nil",
		"\tend",
		"end",
	].join("\n");

	const diagnostics = validate(text);
	assert.ok(
		diagnostics.some((d) =>
			d.message.includes("Unknown return type MissingType in App.run"),
		),
	);
});

test("diagnostics flags top-level local mismatches", () => {
	const text = "local value: number = \"nope\"";
	const diagnostics = validate(text);
	assert.ok(
		diagnostics.some((d) =>
			d.message.includes("Type mismatch for value: expected number, got string"),
		),
	);
});

test("diagnostics flags unknown member on non-self typed receiver", () => {
	const text = [
		"class Scene",
		"\tfunction draw()",
		"\tend",
		"end",
		"",
		"class App",
		"\tfunction run()",
		"\t\tlocal scene: Scene = new Scene()",
		"\t\tscene.missing",
		"\tend",
		"end",
	].join("\n");

	const diagnostics = validate(text);
	assert.ok(
		diagnostics.some((d) => d.message.includes("Type Scene has no member 'missing'")),
	);
});

test("diagnostics flags non-self method arity mismatch", () => {
	const text = [
		"class Scene",
		"\tfunction draw(dt: number)",
		"\tend",
		"end",
		"",
		"class App",
		"\tfunction run()",
		"\t\tlocal scene: Scene = new Scene()",
		"\t\tscene.draw()",
		"\tend",
		"end",
	].join("\n");

	const diagnostics = validate(text);
	assert.ok(
		diagnostics.some((d) =>
			d.message.includes("Method Scene.draw expects 1 arguments, got 0"),
		),
	);
});

test("diagnostics flags non-self method argument type mismatch", () => {
	const text = [
		"class Scene",
		"\tfunction draw(dt: number)",
		"\tend",
		"end",
		"",
		"class App",
		"\tfunction run()",
		"\t\tlocal scene: Scene = new Scene()",
		"\t\tscene.draw(\"bad\")",
		"\tend",
		"end",
	].join("\n");

	const diagnostics = validate(text);
	assert.ok(
		diagnostics.some((d) =>
			d.message.includes("Argument 1 of Scene.draw expects number, got string"),
		),
	);
});

test("diagnostics flags unknown method on callback parameter type", () => {
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
		"\t\t\tscene.ast()",
		"\t\tend)",
		"\tend",
		"end",
	].join("\n");

	const diagnostics = validateWithCallbacks(text);
	assert.ok(
		diagnostics.some((d) => d.message.includes("Scene") && d.message.includes("ast")),
		`Expected unknown-member diagnostic for scene.ast, got: ${JSON.stringify(diagnostics.map((d) => d.message))}`,
	);
});

test("diagnostics flags arity mismatch on callback parameter method", () => {
	const text = [
		"class List<T>",
		"\tfunction forEach(func: function(item: T))",
		"\tend",
		"end",
		"",
		"class Scene",
		"\tfunction draw(dt: number)",
		"\tend",
		"end",
		"",
		"class SceneController",
		"\tlocal scenes: List<Scene>",
		"\tfunction update()",
		"\t\tself.scenes.forEach(function(scene)",
		"\t\t\tscene.draw()",
		"\t\tend)",
		"\tend",
		"end",
	].join("\n");

	const diagnostics = validateWithCallbacks(text);
	assert.ok(
		diagnostics.some((d) =>
			d.message.includes("Scene.draw") && d.message.includes("expects"),
		),
		`Expected arity diagnostic for scene.draw(), got: ${JSON.stringify(diagnostics.map((d) => d.message))}`,
	);
});
