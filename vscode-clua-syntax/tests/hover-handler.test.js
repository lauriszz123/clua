"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { registerHoverHandler } = require("../server/hover-handler");

test("hover handler returns stdlib global hover info", () => {
	const connection = {
		onHover(handler) {
			this.handler = handler;
		},
	};
	const documents = {
		get() {
			return {
				uri: "file:///app.clua",
				getText() {
					return "print";
				},
			};
		},
	};

	registerHoverHandler({
		connection,
		documents,
		debugLog: () => {},
		buildModel: () => ({ lines: ["print"], classes: new Map(), topLevelLocals: new Map() }),
		buildWorkspaceIndexWithImports: () => new Map(),
		getWordAt: () => ({ word: "print", start: 0, end: 5 }),
		getImportContextAtPosition: () => null,
		resolveImportClassTarget: () => null,
		getClassAtLine: () => null,
		getMethodAtLine: () => null,
		canAccessPrivateMembers: () => false,
		inferExpressionType: () => null,
		resolveClassByType: () => null,
		getMethodOverloads: () => [],
		buildTypeParamMap: () => null,
		specializeMethod: (value) => value,
		specializeDocs: (value) => value,
		applyTypeParamMap: (value) => value,
		getImportedModuleForSymbol: () => null,
		findParam: () => null,
		LUA_LIBS: {},
		LUA_GLOBALS: {
			print: {
				signature: "print(...)",
				doc: "Writes values",
				params: [],
			},
		},
		makeHover: (signature, docs) => ({ signature, docs }),
		buildMethodDisplayLabel: () => "",
		buildClassHoverData: () => null,
		buildClassTypeHoverData: () => null,
		getLoveFunction: () => null,
		getLoveNamespace: () => null,
	});

	const result = connection.handler({
		textDocument: { uri: "file:///app.clua" },
		position: { line: 0, character: 2 },
	});

	assert.equal(result.signature, "print(...)");
	assert.equal(result.docs.description, "Writes values");
});