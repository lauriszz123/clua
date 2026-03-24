"use strict";

function registerHoverHandler({
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
}) {
	connection.onHover((params) => {
		const hoverStartMs = Date.now();
		const document = documents.get(params.textDocument.uri);
		if (!document) {
			return null;
		}

		const model = buildModel(document.getText());
		const workspaceIndex = buildWorkspaceIndexWithImports(document.uri, model);
		const lineText = model.lines[params.position.line] || "";
		const token = getWordAt(lineText, params.position.character);
		if (!token) {
			return null;
		}
		debugLog(
			`hover token=${token.word} uri=${params.textDocument.uri} line=${params.position.line}`,
		);

		const importContext = getImportContextAtPosition(
			lineText,
			params.position.character,
			token,
		);
		if (importContext) {
			debugLog(
				`hover import token=${token.word} modulePath=${importContext.modulePath}`,
			);
			const importTarget = resolveImportClassTarget(importContext, document.uri);
			if (importTarget && importTarget.classInfo) {
				debugLog(
					`hover import resolved module=${importContext.modulePath} class=${importTarget.classInfo.name} uri=${importTarget.targetUri}`,
				);
				const hoverData = buildClassTypeHoverData(importTarget.classInfo);
				return makeHover(hoverData.signature, hoverData.docs);
			}
			if (importTarget) {
				debugLog(
					`hover import resolved module-only module=${importTarget.modulePath} uri=${importTarget.targetUri}`,
				);
				return makeHover(`module ${importTarget.modulePath}`, {
					description: "Imported module",
					params: new Map(),
				});
			}
			debugLog(`hover import unresolved module=${importContext.modulePath}`);
		}

		const word = token.word;
		const classInfo = getClassAtLine(model, params.position.line);
		const methodInfo = getMethodAtLine(classInfo, params.position.line);
		const beforeMember = lineText.slice(0, token.start);
		const memberReceiverMatch = beforeMember.match(
			/([A-Za-z_][A-Za-z0-9_\.]*)\s*\.\s*$/,
		);

		if (memberReceiverMatch) {
			const receiverExpr = memberReceiverMatch[1];
			const normalizedReceiver = receiverExpr.replace(/\s+/g, "");
			const loveFullName = `${normalizedReceiver}.${word}`;
			const loveFnEntry = getLoveFunction(loveFullName);
			if (loveFnEntry) {
				const fakeDocs = {
					description: loveFnEntry.doc,
					params: new Map((loveFnEntry.params || []).map((p) => [p.name, p])),
				};
				return makeHover(loveFnEntry.signature, fakeDocs);
			}

			const loveNsEntry = getLoveNamespace(loveFullName);
			if (loveNsEntry) {
				const fakeDocs = { description: loveNsEntry.doc, params: new Map() };
				return makeHover(loveFullName, fakeDocs);
			}

			if (model.enums && model.enums.has(normalizedReceiver)) {
				const enumInfo = model.enums.get(normalizedReceiver);
				if (enumInfo.members.has(word)) {
					const member = enumInfo.members.get(word);
					return makeHover(
						`enum ${enumInfo.name}.${member.name} = ${member.valueExpr}`,
						{
							description: `Enum member of ${enumInfo.name}`,
							params: new Map(),
						},
					);
				}
			}
			const allowPrivate = canAccessPrivateMembers(receiverExpr);

			if (LUA_LIBS[receiverExpr] && LUA_LIBS[receiverExpr][word]) {
				const entry = LUA_LIBS[receiverExpr][word];
				const fakeDocs = {
					description: entry.doc,
					params: new Map((entry.params || []).map((p) => [p.name, p])),
				};
				return makeHover(entry.signature, fakeDocs);
			}

			const receiverType = inferExpressionType(
				receiverExpr,
				model,
				classInfo,
				methodInfo,
				workspaceIndex,
			);
			const resolvedClass = resolveClassByType(
				receiverType,
				model,
				workspaceIndex,
			);
			if (resolvedClass) {
				const targetClass = resolvedClass.classInfo;
				const typeParamMap = buildTypeParamMap(targetClass, receiverType);
				const targetOverloads = getMethodOverloads(targetClass, word);
				if (targetOverloads.length) {
					const visibleOverloads = targetOverloads.filter(
						(overload) => !overload.isPrivate || allowPrivate,
					);
					if (!visibleOverloads.length) {
						return null;
					}
					const signatureLines = visibleOverloads.map((overload) => {
						const specializedMethod = specializeMethod(overload, typeParamMap);
						const specializedDocs = specializeDocs(overload.docs, typeParamMap);
						return buildMethodDisplayLabel(
							`function ${targetClass.name}.${overload.name}`,
							specializedMethod,
							specializedDocs,
						);
					});
					const primaryDocs =
						visibleOverloads.find(
							(overload) =>
								overload.docs &&
								(typeof overload.docs.description === "string"
									? overload.docs.description.trim().length > 0
									: false),
						) || visibleOverloads[0];
					const specializedDocs = specializeDocs(primaryDocs.docs, typeParamMap);
					return makeHover(signatureLines, specializedDocs);
				}

				if (targetClass.fields.has(word)) {
					const field = targetClass.fields.get(word);
					if (field.isPrivate && !allowPrivate) {
						return null;
					}
					return makeHover(
						`field ${targetClass.name}.${field.name}: ${applyTypeParamMap(field.typeName, typeParamMap)}`,
						field.docs,
					);
				}
			}
		}

		if (LUA_GLOBALS[word]) {
			const entry = LUA_GLOBALS[word];
			const fakeDocs = {
				description: entry.doc,
				params: new Map((entry.params || []).map((p) => [p.name, p])),
			};
			return makeHover(entry.signature, fakeDocs);
		}

		if (model.classes.has(word) || workspaceIndex.has(word)) {
			const entry = model.classes.has(word)
				? { uri: document.uri, classInfo: model.classes.get(word) }
				: workspaceIndex.get(word);
			const cls = entry.classInfo;
			const beforeWord = lineText.slice(0, token.start);
			const afterWord = lineText.slice(token.end);
			const isConstructorHover =
				/\bnew\s+$/.test(beforeWord) && /^\s*\(/.test(afterWord);
			const hoverData = isConstructorHover
				? buildClassHoverData(cls)
				: buildClassTypeHoverData(cls);
			return makeHover(hoverData.signature, hoverData.docs);
		}

		const importedModulePath = getImportedModuleForSymbol(model, word);
		if (importedModulePath) {
			const importTarget = resolveImportClassTarget(
				{ modulePath: importedModulePath, terminalName: word },
				document.uri,
			);
			if (importTarget && importTarget.classInfo) {
				const hoverData = buildClassTypeHoverData(importTarget.classInfo);
				return makeHover(hoverData.signature, hoverData.docs);
			}
		}

		if (model.enums && model.enums.has(word)) {
			const enumInfo = model.enums.get(word);
			const preview = Array.from(enumInfo.members.values())
				.slice(0, 5)
				.map((m) => `${m.name} = ${m.valueExpr}`)
				.join("\n");
			return makeHover(`enum ${enumInfo.name}`, {
				description: preview ? `Members:\n${preview}` : "Enum declaration",
				params: new Map(),
			});
		}

		if (classInfo && classInfo.fields.has(word)) {
			const field = classInfo.fields.get(word);
			return makeHover(`field self.${field.name}: ${field.typeName}`, field.docs);
		}

		if (classInfo) {
			const classOverloads = getMethodOverloads(classInfo, word);
			if (classOverloads.length) {
				const signatureLines = classOverloads.map((overload) =>
					buildMethodDisplayLabel(
						`function ${classInfo.name}.${overload.name}`,
						overload,
						overload.docs,
					),
				);
				const primaryDocs =
					classOverloads.find(
						(overload) =>
							overload.docs &&
							(typeof overload.docs.description === "string"
								? overload.docs.description.trim().length > 0
								: false),
					) || classOverloads[0];
				return makeHover(signatureLines, primaryDocs.docs);
			}
		}

		if (methodInfo) {
			const param = findParam(methodInfo, word);
			if (param) {
				const doc = methodInfo.docs.params.get(word);
				const docs = {
					description: doc ? doc.description : "",
					params: new Map(),
				};
				return makeHover(`parameter ${param.name}: ${param.typeName}`, docs);
			}

			if (methodInfo.locals.has(word)) {
				const localInfo = methodInfo.locals.get(word);
				return makeHover(`local ${localInfo.name}: ${localInfo.typeName}`, null);
			}
		}

		if (model.topLevelLocals && model.topLevelLocals.has(word)) {
			const localInfo = model.topLevelLocals.get(word);
			return makeHover(`local ${localInfo.name}: ${localInfo.typeName}`, null);
		}

		const elapsedMs = Date.now() - hoverStartMs;
		if (elapsedMs > 75) {
			debugLog(`hover slow token=${word} timeMs=${elapsedMs}`);
		}

		return null;
	});
}

module.exports = {
	registerHoverHandler,
};
