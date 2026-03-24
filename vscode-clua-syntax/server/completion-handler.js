"use strict";

const {
	KEYWORD_ITEMS,
	getContextAwareSnippetItems,
} = require("./completion");

function registerCompletionHandler({
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
}) {
	function mergeWithContextSnippets(baseItems, model, line, beforeCursor) {
		const snippetItems = getContextAwareSnippetItems({
			lines: model.lines,
			lineIndex: line,
			beforeCursor,
			CompletionItemKind,
			InsertTextFormat,
		});
		if (!snippetItems.length) {
			return baseItems;
		}

		const seen = new Set();
		const out = [];
		for (const item of [...baseItems, ...snippetItems]) {
			const key = `${item.label}::${item.detail || ""}::${item.insertText || ""}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(item);
		}
		return out;
	}

	connection.onCompletion((params) => {
		const document = documents.get(params.textDocument.uri);
		if (!document) {
			return [];
		}

		const model = buildModel(document.getText());
		const workspaceIndex = buildWorkspaceIndexWithImports(document.uri, model);
		const lineText = model.lines[params.position.line] || "";
		const beforeCursor = lineText.slice(0, params.position.character);
		const classInfo = getClassAtLine(model, params.position.line);
		const methodInfo = getMethodAtLine(classInfo, params.position.line);
		const completionTarget = getCompletionTargetClass(
			beforeCursor,
			model,
			classInfo,
			methodInfo,
			workspaceIndex,
		);
		const completionClass = completionTarget ? completionTarget.classInfo : null;
		const completionAllowsPrivate = completionTarget
			? completionTarget.allowPrivate
			: false;
		const completionTypeParamMap = completionTarget
			? completionTarget.typeParamMap
			: null;

		const items = [];

		const importMatch = beforeCursor.match(/^\s*import\s+([A-Za-z0-9_\.]*)$/);
		if (importMatch) {
			const typedPrefix = importMatch[1] || "";
			const modules = getImportSuggestionsCached(null);
			const moduleItems = [];

			for (const [moduleName, filePath] of modules.entries()) {
				if (
					typedPrefix !== "" &&
					!moduleName.toLowerCase().startsWith(typedPrefix.toLowerCase())
				) {
					continue;
				}

				moduleItems.push({
					label: moduleName,
					kind: CompletionItemKind.Module,
					detail: filePath,
				});
			}

			moduleItems.sort((a, b) => a.label.localeCompare(b.label));
			return mergeWithContextSnippets(
				moduleItems,
				model,
				params.position.line,
				beforeCursor,
			);
		}

		if (/---\s*@?[A-Za-z_]*$/.test(beforeCursor)) {
			return [
				{
					label: "@param",
					kind: CompletionItemKind.Keyword,
					insertText: "@param ${1:name} ${2:type} ${3:description}",
					insertTextFormat: InsertTextFormat.Snippet,
				},
			];
		}

		if (completionClass) {
			for (const field of completionClass.fields.values()) {
				if (field.isPrivate && !completionAllowsPrivate) {
					continue;
				}
				items.push({
					label: field.name,
					kind: CompletionItemKind.Field,
					detail: `field: ${applyTypeParamMap(field.typeName, completionTypeParamMap)}`,
					documentation: renderDocsText(field.docs),
				});
			}

			for (const method of completionClass.methods.values()) {
				if (method.isPrivate && !completionAllowsPrivate) {
					continue;
				}
				const specializedMethod = specializeMethod(
					method,
					completionTypeParamMap,
				);
				const specializedDocs = specializeDocs(
					method.docs,
					completionTypeParamMap,
				);
				const paramsText = getDisplayParams(specializedMethod, specializedDocs)
					.map((p) => `${p.name}: ${p.typeName}`)
					.join(", ");
				items.push({
					label: method.name,
					kind: CompletionItemKind.Method,
					detail: `method ${method.name}(${paramsText})`,
					documentation: renderDocsText(specializedDocs),
				});
			}

			return mergeWithContextSnippets(
				items,
				model,
				params.position.line,
				beforeCursor,
			);
		}

		const libAccessMatch = beforeCursor.match(
			/\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*[A-Za-z0-9_]*$/,
		);
		if (libAccessMatch && LUA_LIBS[libAccessMatch[1]]) {
			const lib = LUA_LIBS[libAccessMatch[1]];
			for (const [name, entry] of Object.entries(lib)) {
				if (typeof entry !== "object" || !entry.signature) {
					continue;
				}
				items.push({
					label: name,
					kind: CompletionItemKind.Function,
					detail: entry.signature,
					documentation: entry.doc,
				});
			}
			return mergeWithContextSnippets(
				items,
				model,
				params.position.line,
				beforeCursor,
			);
		}

		const loveAccessMatch = beforeCursor.match(
			/\b(love(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\.\s*([A-Za-z0-9_]*)$/,
		);
		if (loveAccessMatch) {
			const prefix = loveAccessMatch[1];
			const typedMember = loveAccessMatch[2] || "";
			const children = getLoveChildren(prefix);

			for (const child of children) {
				if (
					typedMember !== "" &&
					!child.label.toLowerCase().startsWith(typedMember.toLowerCase())
				) {
					continue;
				}

				items.push({
					label: child.label,
					kind:
						child.kind === "namespace"
							? CompletionItemKind.Module
							: CompletionItemKind.Function,
					detail: child.detail,
					documentation: child.doc,
				});
			}

			return mergeWithContextSnippets(
				items,
				model,
				params.position.line,
				beforeCursor,
			);
		}

		const enumAccessMatch = beforeCursor.match(
			/\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z0-9_]*)$/,
		);
		if (enumAccessMatch && model.enums && model.enums.has(enumAccessMatch[1])) {
			const enumInfo = model.enums.get(enumAccessMatch[1]);
			const typedMember = enumAccessMatch[2] || "";
			for (const member of enumInfo.members.values()) {
				if (
					typedMember !== "" &&
					!member.name.toLowerCase().startsWith(typedMember.toLowerCase())
				) {
					continue;
				}
				items.push({
					label: member.name,
					kind: CompletionItemKind.EnumMember,
					detail: `${enumInfo.name}.${member.name} = ${member.valueExpr}`,
				});
			}
			return mergeWithContextSnippets(
				items,
				model,
				params.position.line,
				beforeCursor,
			);
		}

		for (const keyword of KEYWORD_ITEMS) {
			items.push({ label: keyword, kind: CompletionItemKind.Keyword });
		}

		for (const typeName of BUILTIN_TYPES.values()) {
			items.push({ label: typeName, kind: CompletionItemKind.TypeParameter });
		}

		for (const [name, entry] of Object.entries(LUA_GLOBALS)) {
			items.push({
				label: name,
				kind: CompletionItemKind.Function,
				detail: entry.signature,
				documentation: entry.doc,
			});
		}

		for (const libName of Object.keys(LUA_LIBS)) {
			items.push({
				label: libName,
				kind: CompletionItemKind.Module,
				detail: `Lua standard library: ${libName}`,
			});
		}

		if (LOVE_NAMESPACES.love) {
			items.push({
				label: "love",
				kind: CompletionItemKind.Module,
				detail: "L�VE root namespace",
				documentation: LOVE_NAMESPACES.love.doc,
			});
		}

		for (const cls of model.classes.values()) {
			const ctor = cls.methods.get("new");
			const ctorDetail = ctor
				? buildMethodDisplayLabel(`new ${cls.name}`, ctor, ctor.docs)
				: `class ${cls.name}`;
			items.push({
				label: cls.name,
				kind: CompletionItemKind.Class,
				detail: ctorDetail,
				documentation: renderDocsText(
					ctor && ctor.docs && ctor.docs.description ? ctor.docs : cls.docs,
				),
			});
		}

		if (model.enums) {
			for (const enumInfo of model.enums.values()) {
				items.push({
					label: enumInfo.name,
					kind: CompletionItemKind.Enum,
					detail: `enum ${enumInfo.name}`,
				});
			}
		}

		for (const [name, entry] of workspaceIndex.entries()) {
			if (model.classes.has(name)) {
				continue;
			}
			const ctor = entry.classInfo.methods.get("new");
			const ctorDetail = ctor
				? buildMethodDisplayLabel(`new ${name}`, ctor, ctor.docs)
				: `class ${name}`;
			items.push({
				label: name,
				kind: CompletionItemKind.Class,
				detail: ctorDetail,
				documentation: renderDocsText(
					ctor && ctor.docs && ctor.docs.description
						? ctor.docs
						: entry.classInfo.docs,
				),
			});
		}

		if (methodInfo) {
			const localNames = new Set();

			for (const param of methodInfo.params) {
				const doc = methodInfo.docs.params.get(param.name);
				items.push({
					label: param.name,
					kind: CompletionItemKind.Variable,
					detail: `param: ${param.typeName}`,
					documentation: doc
						? `${doc.typeName}${doc.description ? ` - ${doc.description}` : ""}`
						: undefined,
				});
				localNames.add(param.name);
			}

			for (const localInfo of methodInfo.locals.values()) {
				items.push({
					label: localInfo.name,
					kind: CompletionItemKind.Variable,
					detail: `local: ${localInfo.typeName}`,
				});
				localNames.add(localInfo.name);
			}

			for (const localInfo of model.topLevelLocals.values()) {
				if (localNames.has(localInfo.name)) {
					continue;
				}
				items.push({
					label: localInfo.name,
					kind: CompletionItemKind.Variable,
					detail: `local: ${localInfo.typeName}`,
				});
				localNames.add(localInfo.name);
			}
		} else if (model.topLevelLocals) {
			for (const localInfo of model.topLevelLocals.values()) {
				items.push({
					label: localInfo.name,
					kind: CompletionItemKind.Variable,
					detail: `local: ${localInfo.typeName}`,
				});
			}
		}

		return mergeWithContextSnippets(
			items,
			model,
			params.position.line,
			beforeCursor,
		);
	});
}

module.exports = {
	registerCompletionHandler,
};
