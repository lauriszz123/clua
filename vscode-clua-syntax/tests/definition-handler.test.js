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
	});

	assert.equal(
		connection.handler({
			textDocument: { uri: "file:///missing.clua" },
			position: { line: 0, character: 0 },
		}),
		null,
	);
});