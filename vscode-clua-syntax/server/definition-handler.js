"use strict";

function registerDefinitionHandler({
	connection,
	documents,
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
	getImportedModuleForSymbol,
}) {
	connection.onDefinition((params) => {
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

		const importContext = getImportContextAtPosition(
			lineText,
			params.position.character,
			token,
		);
		if (importContext) {
			const importTarget = resolveImportClassTarget(importContext, document.uri);
			if (!importTarget) {
				return null;
			}

			if (importTarget.classInfo) {
				return {
					uri: importTarget.targetUri,
					range: {
						start: {
							line: importTarget.classInfo.line,
							character: Math.max(importTarget.classInfo.start, 0),
						},
						end: {
							line: importTarget.classInfo.line,
							character: Math.max(importTarget.classInfo.end, 1),
						},
					},
				};
			}

			return {
				uri: importTarget.targetUri,
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 1 },
				},
			};
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

			if (model.enums && model.enums.has(normalizedReceiver)) {
				const enumInfo = model.enums.get(normalizedReceiver);
				if (enumInfo.members.has(word)) {
					const member = enumInfo.members.get(word);
					return {
						uri: document.uri,
						range: {
							start: { line: member.line, character: Math.max(member.start, 0) },
							end: { line: member.line, character: Math.max(member.end, 1) },
						},
					};
				}
			}

			const allowPrivate = canAccessPrivateMembers(receiverExpr);
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
				const targetUri = resolvedClass.uri || document.uri;
				const targetClass = resolvedClass.classInfo;

				const targetOverloads = getMethodOverloads(targetClass, word);
				if (targetOverloads.length) {
					const method = targetOverloads[0];
					if (method.isPrivate && !allowPrivate) {
						return null;
					}
					return {
						uri: targetUri,
						range: {
							start: { line: method.line, character: Math.max(method.start, 0) },
							end: { line: method.line, character: Math.max(method.end, 1) },
						},
					};
				}

				if (targetClass.fields.has(word)) {
					const field = targetClass.fields.get(word);
					if (field.isPrivate && !allowPrivate) {
						return null;
					}
					return {
						uri: targetUri,
						range: {
							start: { line: field.line, character: Math.max(field.start, 0) },
							end: { line: field.line, character: Math.max(field.end, 1) },
						},
					};
				}
			}
		}

		if (model.classes.has(word) || workspaceIndex.has(word)) {
			const entry = model.classes.has(word)
				? { uri: document.uri, classInfo: model.classes.get(word) }
				: workspaceIndex.get(word);
			const cls = entry.classInfo;
			return {
				uri: entry.uri || document.uri,
				range: {
					start: { line: cls.line, character: Math.max(cls.start, 0) },
					end: { line: cls.line, character: Math.max(cls.end, 1) },
				},
			};
		}

		const importedModulePath = getImportedModuleForSymbol(model, word);
		if (importedModulePath) {
			const importTarget = resolveImportClassTarget(
				{ modulePath: importedModulePath, terminalName: word },
				document.uri,
			);
			if (!importTarget) {
				return null;
			}

			if (importTarget.classInfo) {
				return {
					uri: importTarget.targetUri,
					range: {
						start: {
							line: importTarget.classInfo.line,
							character: Math.max(importTarget.classInfo.start, 0),
						},
						end: {
							line: importTarget.classInfo.line,
							character: Math.max(importTarget.classInfo.end, 1),
						},
					},
				};
			}

			return {
				uri: importTarget.targetUri,
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 1 },
				},
			};
		}

		if (model.enums && model.enums.has(word)) {
			const enumInfo = model.enums.get(word);
			return {
				uri: document.uri,
				range: {
					start: { line: enumInfo.line, character: Math.max(enumInfo.start, 0) },
					end: { line: enumInfo.line, character: Math.max(enumInfo.end, 1) },
				},
			};
		}

		if (classInfo && classInfo.fields.has(word)) {
			const field = classInfo.fields.get(word);
			return {
				uri: document.uri,
				range: {
					start: { line: field.line, character: Math.max(field.start, 0) },
					end: { line: field.line, character: Math.max(field.end, 1) },
				},
			};
		}

		if (classInfo) {
			const classOverloads = getMethodOverloads(classInfo, word);
			if (classOverloads.length) {
				const method = classOverloads[0];
				return {
					uri: document.uri,
					range: {
						start: { line: method.line, character: Math.max(method.start, 0) },
						end: { line: method.line, character: Math.max(method.end, 1) },
					},
				};
			}
		}

		if (methodInfo && methodInfo.locals.has(word)) {
			const localInfo = methodInfo.locals.get(word);
			return {
				uri: document.uri,
				range: {
					start: {
						line: localInfo.line,
						character: Math.max(localInfo.start, 0),
					},
					end: { line: localInfo.line, character: Math.max(localInfo.end, 1) },
				},
			};
		}

		return null;
	});
}

module.exports = {
	registerDefinitionHandler,
};
