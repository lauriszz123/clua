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
		resolveCallbackParameterType: () => null,
	});

	const result = connection.handler({
		textDocument: { uri: "file:///app.clua" },
		position: { line: 0, character: 2 },
	});

	assert.equal(result.signature, "print(...)");
	assert.equal(result.docs.description, "Writes values");
});

test("hover on callback member prefers callback receiver type", () => {
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
					return "scene.draw";
				},
			};
		},
	};

	const sceneClass = {
		name: "Scene",
		fields: new Map(),
		methods: new Map(),
	};
	const sceneControllerClass = {
		name: "SceneController",
		fields: new Map(),
		methods: new Map(),
	};

	registerHoverHandler({
		connection,
		documents,
		debugLog: () => {},
		buildModel: () => ({
			lines: ["scene.draw"],
			classes: new Map(),
			topLevelLocals: new Map(),
		}),
		buildWorkspaceIndexWithImports: () => new Map(),
		getWordAt: () => ({ word: "draw", start: 6, end: 10 }),
		getImportContextAtPosition: () => null,
		resolveImportClassTarget: () => null,
		getClassAtLine: () => sceneControllerClass,
		getMethodAtLine: () => ({ name: "update", params: [], locals: new Map(), docs: { params: new Map() } }),
		canAccessPrivateMembers: () => false,
		inferExpressionType: () => null,
		resolveClassByType: (typeName) =>
			typeName === "Scene" ? { classInfo: sceneClass } : null,
		getMethodOverloads: (classInfo, methodName) => {
			if (classInfo.name === "Scene" && methodName === "draw") {
				return [
					{ name: "draw", params: [], docs: { description: "Scene draw", params: new Map() } },
				];
			}
			if (classInfo.name === "SceneController" && methodName === "draw") {
				return [
					{ name: "draw", params: [], docs: { description: "Controller draw", params: new Map() } },
				];
			}
			return [];
		},
		buildTypeParamMap: () => null,
		specializeMethod: (value) => value,
		specializeDocs: (value) => value,
		applyTypeParamMap: (value) => value,
		getImportedModuleForSymbol: () => null,
		findParam: () => null,
		LUA_LIBS: {},
		LUA_GLOBALS: {},
		makeHover: (signature, docs) => ({ signature, docs }),
		buildMethodDisplayLabel: (prefix) => prefix,
		buildClassHoverData: () => null,
		buildClassTypeHoverData: () => null,
		getLoveFunction: () => null,
		getLoveNamespace: () => null,
		resolveCallbackParameterType: () => "Scene",
	});

	const result = connection.handler({
		textDocument: { uri: "file:///app.clua" },
		position: { line: 0, character: 8 },
	});

	assert.ok(result);
	assert.ok(String(result.signature).includes("function Scene.draw"));
});

test("hover in unresolved member context does not fall back to class method", () => {
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
					return "scene.draw";
				},
			};
		},
	};

	const sceneControllerClass = {
		name: "SceneController",
		fields: new Map(),
		methods: new Map(),
	};

	registerHoverHandler({
		connection,
		documents,
		debugLog: () => {},
		buildModel: () => ({
			lines: ["scene.draw"],
			classes: new Map(),
			topLevelLocals: new Map(),
		}),
		buildWorkspaceIndexWithImports: () => new Map(),
		getWordAt: () => ({ word: "draw", start: 6, end: 10 }),
		getImportContextAtPosition: () => null,
		resolveImportClassTarget: () => null,
		getClassAtLine: () => sceneControllerClass,
		getMethodAtLine: () => ({ name: "update", params: [], locals: new Map(), docs: { params: new Map() } }),
		canAccessPrivateMembers: () => false,
		inferExpressionType: () => null,
		resolveClassByType: () => null,
		getMethodOverloads: (classInfo, methodName) => {
			if (classInfo.name === "SceneController" && methodName === "draw") {
				return [
					{ name: "draw", params: [], docs: { description: "Controller draw", params: new Map() } },
				];
			}
			return [];
		},
		buildTypeParamMap: () => null,
		specializeMethod: (value) => value,
		specializeDocs: (value) => value,
		applyTypeParamMap: (value) => value,
		getImportedModuleForSymbol: () => null,
		findParam: () => null,
		LUA_LIBS: {},
		LUA_GLOBALS: {},
		makeHover: (signature, docs) => ({ signature, docs }),
		buildMethodDisplayLabel: (prefix) => prefix,
		buildClassHoverData: () => null,
		buildClassTypeHoverData: () => null,
		getLoveFunction: () => null,
		getLoveNamespace: () => null,
		resolveCallbackParameterType: () => null,
	});

	const result = connection.handler({
		textDocument: { uri: "file:///app.clua" },
		position: { line: 0, character: 8 },
	});

	assert.equal(result, null);
});