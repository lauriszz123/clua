"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { registerDefinitionHandler } = require("../server/definition-handler");

test("definition handler resolves class definitions in the current document", () => {
	const connection = {
		onDefinition(handler) {
			this.handler = handler;
		},
	};
	const documents = {
		get() {
			return {
				uri: "file:///app.clua",
				getText() {
					return "App";
				},
			};
		},
	};
	const classInfo = { name: "App", line: 4, start: 0, end: 3, fields: new Map() };

	registerDefinitionHandler({
		connection,
		documents,
		buildModel: () => ({ lines: ["App"], classes: new Map([["App", classInfo]]), enums: null }),
		buildWorkspaceIndexWithImports: () => new Map(),
		getWordAt: () => ({ word: "App", start: 0, end: 3 }),
		getImportContextAtPosition: () => null,
		resolveImportClassTarget: () => null,
		getClassAtLine: () => null,
		getMethodAtLine: () => null,
		canAccessPrivateMembers: () => false,
		inferExpressionType: () => null,
		resolveClassByType: () => null,
		getMethodOverloads: () => [],
		getImportedModuleForSymbol: () => null,
		resolveCallbackParameterType: () => null,
	});

	const result = connection.handler({
		textDocument: { uri: "file:///app.clua" },
		position: { line: 0, character: 1 },
	});

	assert.deepEqual(result, {
		uri: "file:///app.clua",
		range: {
			start: { line: 4, character: 0 },
			end: { line: 4, character: 3 },
		},
	});
});

test("definition handler returns null when the document is missing", () => {
	const connection = {
		onDefinition(handler) {
			this.handler = handler;
		},
	};

	registerDefinitionHandler({
		connection,
		documents: { get: () => null },
		buildModel: () => null,
		buildWorkspaceIndexWithImports: () => new Map(),
		getWordAt: () => null,
		getImportContextAtPosition: () => null,
		resolveImportClassTarget: () => null,
		getClassAtLine: () => null,
		getMethodAtLine: () => null,
		canAccessPrivateMembers: () => false,
		inferExpressionType: () => null,
		resolveClassByType: () => null,
		getMethodOverloads: () => [],
		getImportedModuleForSymbol: () => null,
		resolveCallbackParameterType: () => null,
	});

	assert.equal(
		connection.handler({
			textDocument: { uri: "file:///missing.clua" },
			position: { line: 0, character: 0 },
		}),
		null,
	);
});

test("definition handler resolves callback receiver member definitions", () => {
	const connection = {
		onDefinition(handler) {
			this.handler = handler;
		},
	};
	const documents = {
		get() {
			return {
				uri: "file:///app.clua",
				getText() {
					return "scene.draw";
				},
			};
		},
	};
	const sceneMethod = {
		name: "draw",
		line: 22,
		start: 1,
		end: 5,
		isPrivate: false,
	};

	registerDefinitionHandler({
		connection,
		documents,
		buildModel: () => ({
			lines: ["scene.draw"],
			classes: new Map(),
			enums: null,
		}),
		buildWorkspaceIndexWithImports: () => new Map(),
		getWordAt: () => ({ word: "draw", start: 6, end: 10 }),
		getImportContextAtPosition: () => null,
		resolveImportClassTarget: () => null,
		getClassAtLine: () => ({ name: "SceneController", fields: new Map() }),
		getMethodAtLine: () => ({ name: "update", locals: new Map() }),
		canAccessPrivateMembers: () => false,
		inferExpressionType: () => null,
		resolveClassByType: (typeName) =>
			typeName === "Scene"
				? {
						uri: "file:///scene.clua",
						classInfo: {
							name: "Scene",
							fields: new Map(),
						},
					}
				: null,
		getMethodOverloads: (classInfo, methodName) => {
			if (classInfo.name === "Scene" && methodName === "draw") {
				return [sceneMethod];
			}
			if (classInfo.name === "SceneController" && methodName === "draw") {
				return [{ ...sceneMethod, line: 1 }];
			}
			return [];
		},
		getImportedModuleForSymbol: () => null,
		resolveCallbackParameterType: () => "Scene",
	});

	const result = connection.handler({
		textDocument: { uri: "file:///app.clua" },
		position: { line: 0, character: 8 },
	});

	assert.deepEqual(result, {
		uri: "file:///scene.clua",
		range: {
			start: { line: 22, character: 1 },
			end: { line: 22, character: 5 },
		},
	});
});

test("definition handler does not fallback in unresolved member context", () => {
	const connection = {
		onDefinition(handler) {
			this.handler = handler;
		},
	};
	const documents = {
		get() {
			return {
				uri: "file:///app.clua",
				getText() {
					return "scene.draw";
				},
			};
		},
	};

	registerDefinitionHandler({
		connection,
		documents,
		buildModel: () => ({
			lines: ["scene.draw"],
			classes: new Map(),
			enums: null,
		}),
		buildWorkspaceIndexWithImports: () => new Map(),
		getWordAt: () => ({ word: "draw", start: 6, end: 10 }),
		getImportContextAtPosition: () => null,
		resolveImportClassTarget: () => null,
		getClassAtLine: () => ({ name: "SceneController", fields: new Map() }),
		getMethodAtLine: () => ({ name: "update", locals: new Map() }),
		canAccessPrivateMembers: () => false,
		inferExpressionType: () => null,
		resolveClassByType: () => null,
		getMethodOverloads: () => [],
		getImportedModuleForSymbol: () => null,
		resolveCallbackParameterType: () => null,
	});

	const result = connection.handler({
		textDocument: { uri: "file:///app.clua" },
		position: { line: 0, character: 8 },
	});

	assert.equal(result, null);
});