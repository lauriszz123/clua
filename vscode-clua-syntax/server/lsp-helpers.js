"use strict";

function createLspHelpers({
	documents,
	getWorkspaceFolders,
	getImportSuggestionsCached,
	debugLog,
	buildModel,
	buildWorkspaceIndex,
	resolveModulePathToFile,
	pathToFileUri,
	readDocumentTextByUri,
	inferExpressionType,
	resolveClassByType,
	getMethodOverloads,
}) {
	function isIdentifierChar(ch) {
		return /[A-Za-z0-9_]/.test(ch || "");
	}

	function getWordAt(lineText, character) {
		if (!lineText || character < 0 || character > lineText.length) {
			return null;
		}

		let start = character;
		if (
			start > 0 &&
			!isIdentifierChar(lineText[start]) &&
			isIdentifierChar(lineText[start - 1])
		) {
			start -= 1;
		}

		if (!isIdentifierChar(lineText[start])) {
			return null;
		}

		let left = start;
		while (left > 0 && isIdentifierChar(lineText[left - 1])) {
			left -= 1;
		}

		let right = start;
		while (right < lineText.length && isIdentifierChar(lineText[right])) {
			right += 1;
		}

		return {
			word: lineText.slice(left, right),
			start: left,
			end: right,
		};
	}

	function canAccessPrivateMembers(receiverExpr) {
		if (!receiverExpr) {
			return false;
		}
		const normalized = receiverExpr.replace(/\s+/g, "");
		return normalized === "self";
	}

	function getImportContextAtPosition(lineText, positionCharacter, token) {
		if (!lineText || !token) {
			return null;
		}

		const importMatch = lineText.match(
			/^\s*import\s+([A-Za-z_][A-Za-z0-9_\.]*)\s*(?:--.*)?$/,
		);
		if (!importMatch) {
			return null;
		}

		const modulePath = importMatch[1];
		const moduleStart = lineText.indexOf(modulePath);
		if (moduleStart < 0) {
			return null;
		}

		const moduleEnd = moduleStart + modulePath.length;
		if (positionCharacter < moduleStart || positionCharacter > moduleEnd) {
			return null;
		}

		if (token.start < moduleStart || token.end > moduleEnd) {
			return null;
		}

		return {
			modulePath,
			terminalName: modulePath.split(".").pop(),
		};
	}

	function getImportedModuleForSymbol(model, symbolName) {
		if (!model || !model.lines || !symbolName) {
			return null;
		}

		for (const line of model.lines) {
			const importMatch = line.match(
				/^\s*import\s+([A-Za-z_][A-Za-z0-9_\.]*)\s*(?:--.*)?$/,
			);
			if (!importMatch) {
				continue;
			}

			const modulePath = importMatch[1];
			if (modulePath === symbolName) {
				return modulePath;
			}

			const parts = modulePath.split(".");
			const terminalName = parts[parts.length - 1];
			if (terminalName === symbolName) {
				return modulePath;
			}
		}

		return null;
	}

	function resolveImportTarget(modulePath, activeUri) {
		if (!modulePath) {
			return null;
		}
		debugLog(
			`resolveImportTarget start module=${modulePath} active=${activeUri || "<none>"}`,
		);

		const directResolvedPath = resolveModulePathToFile(
			modulePath,
			activeUri,
			getWorkspaceFolders(),
			(trace) => {
				if (!trace) {
					return;
				}
				if (trace.event === "start") {
					const previewRoots = (trace.roots || []).slice(0, 8).join(" | ");
					debugLog(
						`module roots module=${trace.modulePath} rootCount=${trace.rootCount} variants=${(trace.variants || []).join(",")} roots=${previewRoots}`,
					);
				} else if (trace.event === "hit") {
					debugLog(
						`module hit module=${trace.modulePath} variant=${trace.variant} candidate=${trace.candidate} path=${trace.path}`,
					);
				} else if (trace.event === "miss") {
					debugLog(`module miss module=${trace.modulePath}`);
				}
			},
		);
		if (directResolvedPath) {
			debugLog(
				`resolveImportTarget direct hit module=${modulePath} path=${directResolvedPath}`,
			);
			const directUri = pathToFileUri(directResolvedPath);
			if (!directUri) {
				debugLog(
					`resolveImportTarget failed to convert path to uri module=${modulePath}`,
				);
				return null;
			}

			const directText = readDocumentTextByUri(directUri, documents);
			if (!directText) {
				return { targetUri: directUri, targetModel: null };
			}

			return {
				targetUri: directUri,
				targetModel: buildModel(directText),
			};
		}

		const findTargetPath = (modules) => {
			let hit = modules.get(modulePath);
			if (!hit && !modulePath.startsWith("clua.")) {
				hit = modules.get(`clua.${modulePath}`);
			}
			return hit;
		};

		const targetPath = findTargetPath(getImportSuggestionsCached(null));

		if (!targetPath) {
			debugLog(`resolveImportTarget miss module=${modulePath}`);
			return null;
		}
		debugLog(
			`resolveImportTarget index hit module=${modulePath} path=${targetPath}`,
		);

		const targetUri = pathToFileUri(targetPath);
		if (!targetUri) {
			return null;
		}

		const targetText = readDocumentTextByUri(targetUri, documents);
		if (!targetText) {
			return { targetUri, targetModel: null };
		}

		return {
			targetUri,
			targetModel: buildModel(targetText),
		};
	}

	function resolveImportClassTarget(importContext, activeUri) {
		if (!importContext) {
			return null;
		}

		const resolved = resolveImportTarget(importContext.modulePath, activeUri);
		if (!resolved) {
			return null;
		}

		const targetModel = resolved.targetModel;
		if (!targetModel || !targetModel.classes || targetModel.classes.size === 0) {
			return {
				targetUri: resolved.targetUri,
				classInfo: null,
				modulePath: importContext.modulePath,
			};
		}

		const terminalName = importContext.terminalName;
		const classInfo =
			(terminalName && targetModel.classes.get(terminalName)) ||
			targetModel.classes.values().next().value ||
			null;

		return {
			targetUri: resolved.targetUri,
			classInfo,
			modulePath: importContext.modulePath,
		};
	}

	function extractImportModulePaths(model) {
		if (!model || !model.lines) {
			return [];
		}

		const modules = [];
		const seen = new Set();
		for (const line of model.lines) {
			const importMatch = line.match(
				/^\s*import\s+([A-Za-z_][A-Za-z0-9_\.]*)\s*(?:--.*)?$/,
			);
			if (!importMatch) {
				continue;
			}
			const modulePath = importMatch[1];
			if (!seen.has(modulePath)) {
				seen.add(modulePath);
				modules.push(modulePath);
			}
		}

		return modules;
	}

	function buildWorkspaceIndexWithImports(documentUri, model) {
		const workspaceIndex = buildWorkspaceIndex(
			documentUri,
			model,
			documents,
			getWorkspaceFolders(),
			model.imports,
		);

		for (const modulePath of extractImportModulePaths(model)) {
			const resolvedImport = resolveImportTarget(modulePath, documentUri);
			if (!resolvedImport || !resolvedImport.targetModel) {
				continue;
			}

			for (const classInfo of resolvedImport.targetModel.classes.values()) {
				workspaceIndex.set(classInfo.name, {
					uri: resolvedImport.targetUri,
					classInfo,
				});
			}
		}

		return workspaceIndex;
	}

	function splitTopLevelCommas(text) {
		const out = [];
		let angleDepth = 0;
		let parenDepth = 0;
		let bracketDepth = 0;
		let start = 0;

		for (let i = 0; i < text.length; i += 1) {
			const ch = text[i];
			if (ch === "<") {
				angleDepth += 1;
			} else if (ch === ">") {
				angleDepth -= 1;
			} else if (ch === "(") {
				parenDepth += 1;
			} else if (ch === ")") {
				parenDepth -= 1;
			} else if (ch === "[") {
				bracketDepth += 1;
			} else if (ch === "]") {
				bracketDepth -= 1;
			} else if (
				ch === "," &&
				angleDepth === 0 &&
				parenDepth === 0 &&
				bracketDepth === 0
			) {
				out.push(text.slice(start, i).trim());
				start = i + 1;
			}
		}
		out.push(text.slice(start).trim());
		return out.filter(Boolean);
	}

	function getFunctionTypeParameterTypes(typeName) {
		if (!typeName) {
			return [];
		}

		const fnStart = String(typeName).indexOf("function");
		if (fnStart < 0) {
			return [];
		}

		const openParen = String(typeName).indexOf("(", fnStart);
		if (openParen < 0) {
			return [];
		}

		let depth = 1;
		let closeParen = -1;
		for (let i = openParen + 1; i < typeName.length; i += 1) {
			const ch = typeName[i];
			if (ch === "(") {
				depth += 1;
			} else if (ch === ")") {
				depth -= 1;
				if (depth === 0) {
					closeParen = i;
					break;
				}
			}
		}

		if (closeParen < 0) {
			return [];
		}

		const paramsText = typeName.slice(openParen + 1, closeParen).trim();
		if (!paramsText) {
			return [];
		}

		const entries = splitTopLevelCommas(paramsText);
		const types = [];
		for (const entry of entries) {
			const colonIndex = entry.indexOf(":");
			if (colonIndex < 0) {
				types.push("any");
				continue;
			}
			types.push(entry.slice(colonIndex + 1).trim() || "any");
		}

		return types;
	}

	function buildTypeParamMap(classInfo, resolvedType) {
		const typeParams =
			classInfo && classInfo.typeParams ? classInfo.typeParams : [];
		if (!typeParams.length || !resolvedType) {
			return null;
		}

		const normalized = String(resolvedType).replace(/\s+/g, "");
		const genericMatch = normalized.match(/^[A-Za-z_][A-Za-z0-9_\.]*<(.+)>$/);
		if (!genericMatch) {
			return null;
		}

		const args = splitTopLevelCommas(genericMatch[1]);
		if (!args.length) {
			return null;
		}

		const map = new Map();
		for (let i = 0; i < typeParams.length; i += 1) {
			map.set(typeParams[i], args[i] || "any");
		}
		return map;
	}

	function applyTypeParamMap(typeName, typeParamMap) {
		if (!typeName || !typeParamMap || typeParamMap.size === 0) {
			return typeName;
		}

		let out = String(typeName);
		for (const [param, concreteType] of typeParamMap.entries()) {
			const re = new RegExp(`\\b${param}\\b`, "g");
			out = out.replace(re, concreteType);
		}
		return out;
	}

	function specializeDocs(docs, typeParamMap) {
		if (!docs || !docs.params) {
			return docs;
		}

		const specializedParams = new Map();
		for (const [name, param] of docs.params.entries()) {
			specializedParams.set(name, {
				...param,
				typeName: applyTypeParamMap(param.typeName, typeParamMap),
			});
		}

		return {
			...docs,
			params: specializedParams,
		};
	}

	function specializeMethod(methodInfo, typeParamMap) {
		if (!methodInfo || !typeParamMap || typeParamMap.size === 0) {
			return methodInfo;
		}

		return {
			...methodInfo,
			params: (methodInfo.params || []).map((param) => ({
				...param,
				typeName: applyTypeParamMap(param.typeName, typeParamMap),
			})),
			returnTypeName: applyTypeParamMap(methodInfo.returnTypeName, typeParamMap),
		};
	}

	function getCompletionTargetClass(
		beforeCursor,
		model,
		classInfo,
		methodInfo,
		workspaceIndex,
	) {
		const match = beforeCursor.match(
			/([A-Za-z_][A-Za-z0-9_\.]*)\s*\.\s*[A-Za-z0-9_]*$/,
		);
		if (!match) {
			return null;
		}

		const targetType = inferExpressionType(
			match[1],
			model,
			classInfo,
			methodInfo,
			workspaceIndex,
		);
		const resolved = resolveClassByType(targetType, model, workspaceIndex);
		if (!resolved) {
			return null;
		}

		const isSameClass = classInfo && resolved.classInfo.name === classInfo.name;
		return {
			classInfo: resolved.classInfo,
			allowPrivate: canAccessPrivateMembers(match[1]) && !!isSameClass,
			typeParamMap: buildTypeParamMap(resolved.classInfo, targetType),
		};
	}

	function resolveCallbackParameterType(
		lines,
		lineIdx,
		parameterName,
		model,
		classInfo,
		methodInfo,
		workspaceIndex,
	) {
		// Build full text with line numbers preserved
		const fullText = lines.join("\n");
		
		// Calculate position in full text at the start of the target line
		let cursorPos = 0;
		for (let i = 0; i < lineIdx; i += 1) {
			cursorPos += lines[i].length + 1; // +1 for newline
		}

		// Search backwards through nested callbacks until we find the function
		// declaration that actually declares `parameterName`.
		let searchPos = cursorPos + lines[lineIdx].length;
		let functionStart = -1;
		let params = [];

		while (searchPos > 0) {
			let blockDepth = 0;
			functionStart = -1;

			for (let i = searchPos - 1; i >= 0; i -= 1) {
				if (
					fullText.slice(i, i + 3) === "end" &&
					(i === 0 || !/[A-Za-z0-9_]/.test(fullText[i - 1])) &&
					!/[A-Za-z0-9_]/.test(fullText[i + 3] || "")
				) {
					blockDepth += 1;
					i -= 2;
					continue;
				}

				if (
					fullText.slice(i, i + 8) === "function" &&
					(i === 0 || !/[A-Za-z0-9_]/.test(fullText[i - 1])) &&
					!/[A-Za-z0-9_]/.test(fullText[i + 8] || "")
				) {
					if (blockDepth === 0) {
						functionStart = i;
						break;
					}
					blockDepth -= 1;
					i -= 7;
					continue;
				}
			}

			if (functionStart < 0) {
				return null;
			}

			const afterFunc = fullText.slice(functionStart + 8);
			const paramListMatch = afterFunc.match(
				/^\s*\(\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)?\s*\)/,
			);
			if (!paramListMatch) {
				searchPos = functionStart;
				continue;
			}

			const paramList = paramListMatch[1] || "";
			params = paramList
				.split(",")
				.map((p) => p.trim())
				.filter(Boolean);

			if (params.includes(parameterName)) {
				break;
			}

			searchPos = functionStart;
		}

		if (functionStart < 0 || !params.includes(parameterName)) {
			return null;
		}
		const callbackParamIndex = params.indexOf(parameterName);

		// Now search backwards from function to find the method call
		let beforeFunc = fullText.slice(0, functionStart);

		// Match pattern: methodName(  ...and function should appear soon
		// Look backwards from function position for pattern with method name
		const methodMatch = beforeFunc.match(
			/([A-Za-z_][A-Za-z0-9_\.]*)\s*\(\s*$/,
		);
		if (!methodMatch) {
			return null;
		}

		const methodName = methodMatch[1].replace(/\s+/g, "");

		// Find parameter index by counting commas between paren and function
		const lastParenPos = beforeFunc.lastIndexOf("(");
		if (lastParenPos < 0) {
			return null;
		}

		const argText = beforeFunc.slice(lastParenPos + 1);
		let paramIdx = 0;
		let parenDepth = 0;
		for (let i = 0; i < argText.length; i += 1) {
			const ch = argText[i];
			if (ch === "(") parenDepth += 1;
			else if (ch === ")") parenDepth -= 1;
			else if (ch === "," && parenDepth === 0) paramIdx += 1;
		}

		// Look up the method
		let targetMethod = null;
		let typeParamMap = null;

		if (methodName.includes(".")) {
			const parts = methodName.split(".");
			const receiverExpr = parts.slice(0, -1).join(".");
			const receiverMethod = parts[parts.length - 1];

			if (receiverExpr === "self" && classInfo) {
				const overloads = getMethodOverloads(classInfo, receiverMethod);
				if (overloads.length > 0) {
					targetMethod = overloads[0];
				}
			} else {
				let receiverType = inferExpressionType(
					receiverExpr,
					model,
					classInfo,
					methodInfo,
					workspaceIndex,
				);
				if (
					!receiverType &&
					receiverExpr !== parameterName &&
					/^[A-Za-z_][A-Za-z0-9_]*$/.test(receiverExpr)
				) {
					receiverType = resolveCallbackParameterType(
						lines,
						lineIdx,
						receiverExpr,
						model,
						classInfo,
						methodInfo,
						workspaceIndex,
					);
				}
				if (receiverType) {
					const resolved = resolveClassByType(receiverType, model, workspaceIndex);
					if (resolved) {
						const overloads = getMethodOverloads(resolved.classInfo, receiverMethod);
						if (overloads.length > 0) {
							targetMethod = overloads[0];
							typeParamMap = buildTypeParamMap(resolved.classInfo, receiverType);
							if (typeParamMap) {
								targetMethod = specializeMethod(targetMethod, typeParamMap);
							}
						}
					}
				}
			}
		} else if (methodInfo && methodInfo.name === methodName) {
			targetMethod = methodInfo;
		} else if (classInfo) {
			const overloads = getMethodOverloads(classInfo, methodName);
			if (overloads.length > 0) {
				targetMethod = overloads[0];
			}
		}

		if (!targetMethod || !targetMethod.params || paramIdx >= targetMethod.params.length) {
			return null;
		}

		const callbackParamType = targetMethod.params[paramIdx].typeName;
		if (!callbackParamType || !callbackParamType.startsWith("function")) {
			return null;
		}

		const callbackParamTypes = getFunctionTypeParameterTypes(callbackParamType);
		if (!callbackParamTypes.length) {
			return null;
		}

		let resolvedType =
			callbackParamTypes[Math.max(0, callbackParamIndex)] || callbackParamTypes[0];
		resolvedType = String(resolvedType || "any").trim();
		
		// Apply type parameter specialization
		if (typeParamMap && typeParamMap.size > 0) {
			resolvedType = applyTypeParamMap(resolvedType, typeParamMap);
		}

		return resolvedType;
	}

	function extractCallContext(beforeCursor) {
		let depth = 0;
		let argIndex = 0;

		for (let i = beforeCursor.length - 1; i >= 0; i -= 1) {
			const ch = beforeCursor[i];
			if (ch === ")") {
				depth += 1;
			} else if (ch === "(") {
				if (depth === 0) {
					const calleeText = beforeCursor.slice(0, i).trimEnd();
					const calleeMatch = calleeText.match(
						/([A-Za-z_][A-Za-z0-9_\.]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*|new\s+[A-Za-z_][A-Za-z0-9_\.]*|[A-Za-z_][A-Za-z0-9_\.]*)$/,
					);
					if (!calleeMatch) {
						return null;
					}

					const argsText = beforeCursor.slice(i + 1);
					let nested = 0;
					argIndex = 0;
					let sawTopLevelToken = false;
					for (let j = 0; j < argsText.length; j += 1) {
						const argCh = argsText[j];
						if (argCh === "(") {
							nested += 1;
						} else if (argCh === ")") {
							nested = Math.max(0, nested - 1);
						} else if (argCh === "," && nested === 0) {
							argIndex += 1;
						} else if (nested === 0 && !/\s/.test(argCh)) {
							sawTopLevelToken = true;
						}
					}

					return {
						callee: calleeMatch[1].replace(/\s+/g, ""),
						activeParameter: argIndex,
						argumentCount: sawTopLevelToken ? argIndex + 1 : 0,
					};
				}
				depth -= 1;
			}
		}

		return null;
	}

	function chooseOverloadIndex(overloads, callContext) {
		if (!overloads || overloads.length === 0) {
			return -1;
		}

		if (!callContext) {
			return 0;
		}

		const targetArity =
			callContext.argumentCount > 0
				? Math.max(callContext.argumentCount, callContext.activeParameter + 1)
				: 0;

		let bestIndex = 0;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (let i = 0; i < overloads.length; i += 1) {
			const arity = (overloads[i].params || []).length;
			const distance = Math.abs(arity - targetArity);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestIndex = i;
				if (distance === 0) {
					break;
				}
			}
		}

		return bestIndex;
	}

	function resolveCallSignature(
		callContext,
		model,
		classInfo,
		methodInfo,
		workspaceIndex,
		cursorLine,
	) {
		if (!callContext) {
			return null;
		}

		if (callContext.callee.startsWith("new")) {
			const ctorType = callContext.callee.replace(/^new/, "").trim();
			const resolved = resolveClassByType(ctorType, model, workspaceIndex);
			if (!resolved) {
				return null;
			}

			const overloads = getMethodOverloads(resolved.classInfo, "new");
			if (!overloads.length) {
				return null;
			}

			return {
				labelPrefix: `new ${resolved.classInfo.name}`,
				overloads,
				activeSignature: chooseOverloadIndex(overloads, callContext),
			};
		}

		const methodMatch = callContext.callee.match(
			/(.+)\.([A-Za-z_][A-Za-z0-9_]*)$/,
		);
		if (methodMatch) {
			const receiverExpr = methodMatch[1];
			const memberName = methodMatch[2];
			const allowPrivate = canAccessPrivateMembers(receiverExpr);
			let receiverType = inferExpressionType(
				receiverExpr,
				model,
				classInfo,
				methodInfo,
				workspaceIndex,
			);
			if (
				!receiverType &&
				typeof cursorLine === "number" &&
				/^[A-Za-z_][A-Za-z0-9_]*$/.test(receiverExpr)
			) {
				receiverType = resolveCallbackParameterType(
					model.lines,
					cursorLine,
					receiverExpr,
					model,
					classInfo,
					methodInfo,
					workspaceIndex,
				);
			}
			const resolved = resolveClassByType(receiverType, model, workspaceIndex);
			if (!resolved) {
				return null;
			}

			const overloads = getMethodOverloads(resolved.classInfo, memberName);
			if (!overloads.length) {
				return null;
			}
			const visibleOverloads = overloads.filter(
				(overload) => !overload.isPrivate || allowPrivate,
			);
			if (!visibleOverloads.length) {
				return null;
			}

			return {
				labelPrefix: `${resolved.classInfo.name}.${memberName}`,
				overloads: visibleOverloads,
				activeSignature: chooseOverloadIndex(visibleOverloads, callContext),
				typeParamMap: buildTypeParamMap(resolved.classInfo, receiverType),
			};
		}

		if (
			model.classes.has(callContext.callee) ||
			workspaceIndex.has(callContext.callee)
		) {
			const resolved = resolveClassByType(
				callContext.callee,
				model,
				workspaceIndex,
			);
			if (!resolved) {
				return null;
			}
			const overloads = getMethodOverloads(resolved.classInfo, "new");
			if (!overloads.length) {
				return null;
			}

			return {
				labelPrefix: `${resolved.classInfo.name}.new`,
				overloads,
				activeSignature: chooseOverloadIndex(overloads, callContext),
			};
		}

		return null;
	}

	return {
		getWordAt,
		canAccessPrivateMembers,
		getImportContextAtPosition,
		getImportedModuleForSymbol,
		resolveImportClassTarget,
		buildWorkspaceIndexWithImports,
		buildTypeParamMap,
		getCompletionTargetClass,
		extractCallContext,
		applyTypeParamMap,
		specializeDocs,
		specializeMethod,
		resolveCallSignature,
		resolveCallbackParameterType,
	};
}

module.exports = {
	createLspHelpers,
};
