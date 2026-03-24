"use strict";
// CLua model: parsing, model building, and query helpers.

const BUILTIN_TYPES = new Set([
	"nil",
	"boolean",
	"number",
	"string",
	"table",
	"function",
	"thread",
	"userdata",
	"any",
	"Love",
]);

const TYPE_NAME_RE = "[A-Za-z_][A-Za-z0-9_\\.\\[\\]<>:,()]*";

function normalizeTypeName(typeName) {
	if (!typeName) {
		return typeName;
	}
	const normalized = String(typeName).replace(/\s+/g, "").trim();
	return normalized || null;
}

function splitTopLevelCommas(text) {
	const parts = [];
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
			if (angleDepth < 0) {
				return null;
			}
		} else if (ch === "(") {
			parenDepth += 1;
		} else if (ch === ")") {
			parenDepth -= 1;
			if (parenDepth < 0) {
				return null;
			}
		} else if (ch === "[") {
			bracketDepth += 1;
		} else if (ch === "]") {
			bracketDepth -= 1;
			if (bracketDepth < 0) {
				return null;
			}
		} else if (
			ch === "," &&
			angleDepth === 0 &&
			parenDepth === 0 &&
			bracketDepth === 0
		) {
			parts.push(text.slice(start, i).trim());
			start = i + 1;
		}
	}

	if (angleDepth !== 0 || parenDepth !== 0 || bracketDepth !== 0) {
		return null;
	}

	parts.push(text.slice(start).trim());
	return parts;
}

function splitAssignmentTopLevel(text) {
	let angleDepth = 0;
	let parenDepth = 0;
	let bracketDepth = 0;

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
			ch === "=" &&
			angleDepth === 0 &&
			parenDepth === 0 &&
			bracketDepth === 0
		) {
			return {
				left: text.slice(0, i).trim(),
				right: text.slice(i + 1).trim(),
			};
		}
	}

	return {
		left: text.trim(),
		right: null,
	};
}

function eraseGenericArguments(typeName) {
	const normalized = normalizeTypeName(typeName);
	if (!normalized) {
		return normalized;
	}

	let out = "";
	let depth = 0;
	for (let i = 0; i < normalized.length; i += 1) {
		const ch = normalized[i];
		if (ch === "<") {
			depth += 1;
			continue;
		}
		if (ch === ">") {
			depth -= 1;
			continue;
		}
		if (depth === 0) {
			out += ch;
		}
	}
	return out;
}

function getArrayBaseType(typeName) {
	if (!typeName) {
		return typeName;
	}

	let base = normalizeTypeName(typeName);
	while (base.endsWith("[]")) {
		base = base.slice(0, -2);
	}
	if (/^function\(/.test(base)) {
		return "function";
	}
	return eraseGenericArguments(base);
}

function blockDelta(line) {
	const text = line
		.replace(/--.*$/, "")
		.replace(/"([^"\\]|\\.)*"/g, '""')
		.replace(/'([^'\\]|\\.)*'/g, "''")
		// Do not treat function type annotations (e.g. function(): T) as block starters.
		.replace(/:\s*function\s*\(/g, ": __fn_type__(");

	// `elseif ... then` closes the previous branch and opens a new one, net depth 0.
	if (/^\s*elseif\b.*\bthen\b/.test(text)) {
		return 0;
	}

	let delta = 0;

	const tokens = text.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
	for (const token of tokens) {
		if (
			token === "function" ||
			token === "then" ||
			token === "do" ||
			token === "repeat" ||
			token === "try" ||
			token === "class" ||
			token === "enum"
		) {
			delta += 1;
		} else if (token === "end" || token === "until") {
			delta -= 1;
		}
	}

	return delta;
}

function findEnumEnd(lines, startIdx) {
	for (let i = startIdx + 1; i < lines.length; i += 1) {
		if (/^\s*end\b/.test(lines[i])) {
			return i;
		}
	}
	return -1;
}

function parseEnumMember(line) {
	const stripped = line.replace(/--.*$/, "").trim();
	if (!stripped) {
		return null;
	}

	const m = stripped.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*(.+))?$/);
	if (!m) {
		return null;
	}

	return {
		name: m[1],
		valueExpr: m[2] ? m[2].trim() : null,
	};
}

function findBlockEnd(lines, startIdx) {
	let depth = 1;
	for (let i = startIdx + 1; i < lines.length; i += 1) {
		depth += blockDelta(lines[i]);
		if (depth === 0) {
			return i;
		}
	}
	return -1;
}

function parseDocBlock(lines, lineIndex) {
	const collected = [];
	let cursor = lineIndex - 1;

	while (cursor >= 0) {
		const line = lines[cursor];
		if (/^\s*---/.test(line)) {
			collected.unshift(line);
			cursor -= 1;
			continue;
		}
		if (/^\s*$/.test(line)) {
			break;
		}
		break;
	}

	const description = [];
	const params = new Map();

	for (const line of collected) {
		const paramMatch = line.match(
			new RegExp(
				`^\\s*---\\s*@param\\s+([A-Za-z_][A-Za-z0-9_]*)\\s+(${TYPE_NAME_RE})\\s*(.*)$`,
			),
		);
		if (paramMatch) {
			params.set(paramMatch[1], {
				name: paramMatch[1],
				typeName: paramMatch[2],
				description: (paramMatch[3] || "").trim(),
			});
		} else {
			const descMatch = line.match(/^\s*---\s?(.*)$/);
			if (descMatch) {
				const text = descMatch[1].trim();
				if (text !== "") {
					description.push(text);
				}
			}
		}
	}

	return {
		description: description.join("\n"),
		params,
		lines: collected,
	};
}

function parseTypedDeclaration(line, declarationKind) {
	const match = line.match(
		/^\s*(?:var|local)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/,
	);
	if (!match) {
		return null;
	}

	const lhsName = match[1];
	const assignment = splitAssignmentTopLevel(match[2]);
	const typeName = normalizeTypeName(assignment.left);
	if (!typeName) {
		return null;
	}

	return {
		name: lhsName,
		typeName,
		defaultExpr: assignment.right,
		declarationKind,
	};
}

function parseField(line) {
	let match = line.match(/^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
	if (match) {
		const parsed = parseTypedDeclaration(`var ${match[1]}: ${match[2]}`, "var");
		if (parsed) return parsed;
	}

	match = line.match(/^\s*local\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
	if (match) {
		const parsed = parseTypedDeclaration(
			`local ${match[1]}: ${match[2]}`,
			"local",
		);
		if (parsed) return parsed;
	}

	match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
	if (match) {
		const parsed = parseTypedDeclaration(`${match[1]}: ${match[2]}`, "bare");
		if (parsed) return parsed;
	}

	return null;
}

function parseTypedLocal(line) {
	const match = line.match(/^\s*local\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
	if (!match) {
		return null;
	}

	const parsed = parseTypedDeclaration(
		`local ${match[1]}: ${match[2]}`,
		"local",
	);
	if (!parsed) {
		return null;
	}

	return {
		name: parsed.name,
		typeName: parsed.typeName,
		defaultExpr: parsed.defaultExpr,
	};
}

function parseLocalVariable(line) {
	const typedLocal = parseTypedLocal(line);
	if (typedLocal) {
		return typedLocal;
	}

	const match = line.match(
		/^\s*local\s+([A-Za-z_][A-Za-z0-9_]*)\s*(=\s*(.*))?$/,
	);
	if (!match) {
		return null;
	}

	const defaultExpr = match[3] || null;
	let inferredType = null;
	if (defaultExpr) {
		const ctorMatch = defaultExpr.match(
			/^new\s+([A-Za-z_][A-Za-z0-9_\.]*(?:<[^()]+>)?)\s*\(/,
		);
		if (ctorMatch) {
			inferredType = normalizeTypeName(ctorMatch[1]);
		} else {
			inferredType = inferLiteralType(defaultExpr);
		}
	}
	return {
		name: match[1],
		typeName: inferredType || "any",
		defaultExpr,
	};
}

function parseTypedParams(line) {
	const trimmed = line.trim();
	const header = trimmed.match(
		/^(local\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*<([^>]*)>)?\s*\(/,
	);
	if (!header) {
		return null;
	}

	const isPrivate = !!header[1];
	const methodName = header[2];
	const genericParamsRaw = (header[3] || "").trim();
	const paramsStart = header[0].length - 1;

	let depth = 0;
	let paramsEnd = -1;
	for (let i = paramsStart; i < trimmed.length; i += 1) {
		const ch = trimmed[i];
		if (ch === "(") {
			depth += 1;
		} else if (ch === ")") {
			depth -= 1;
			if (depth === 0) {
				paramsEnd = i;
				break;
			}
			if (depth < 0) {
				return null;
			}
		}
	}

	if (paramsEnd < 0) {
		return null;
	}

	const rawParams = trimmed.slice(paramsStart + 1, paramsEnd).trim();
	const tail = trimmed.slice(paramsEnd + 1).trim();
	const returnTypeName = tail
		? normalizeTypeName(tail.replace(/^:\s*/, ""))
		: null;

	let typeParams = [];
	if (genericParamsRaw) {
		const parsed = splitTopLevelCommas(genericParamsRaw);
		if (!parsed) {
			return null;
		}
		typeParams = parsed.map((name) => name.trim()).filter(Boolean);
		if (!typeParams.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
			return null;
		}
	}

	if (!rawParams) {
		return {
			methodName,
			typedParams: [],
			isPrivate,
			returnTypeName,
			typeParams,
		};
	}

	const paramTokens = splitTopLevelCommas(rawParams);
	if (!paramTokens) {
		return null;
	}

	const typedParams = [];
	for (const part of paramTokens) {
		const token = part.trim();
		const tm = token.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
		if (tm) {
			const typeName = normalizeTypeName(tm[2]);
			if (typeName) {
				typedParams.push({ name: tm[1], typeName });
			}
		}
	}

	return { methodName, typedParams, isPrivate, returnTypeName, typeParams };
}

function inferLiteralType(expr) {
	const value = expr.trim();
	if (/^"([^"\\]|\\.)*"$/.test(value) || /^'([^'\\]|\\.)*'$/.test(value))
		return "string";
	if (/^(true|false)$/.test(value)) return "boolean";
	if (/^nil$/.test(value)) return "nil";
	if (/^\{.*\}$/.test(value)) return "table";
	if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return "number";
	return null;
}

function inferReceiverTypeSimple(
	receiverExpr,
	classInfo,
	methodParams,
	methodLocals,
) {
	const value = (receiverExpr || "").trim();
	if (!value) {
		return null;
	}

	if (value.startsWith("self.")) {
		const fieldName = value.slice(5);
		if (classInfo && classInfo.fields && classInfo.fields.has(fieldName)) {
			return classInfo.fields.get(fieldName).typeName;
		}
		return null;
	}

	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
		const param = (methodParams || []).find((p) => p.name === value);
		if (param) {
			return param.typeName;
		}
		if (methodLocals && methodLocals.has(value)) {
			return methodLocals.get(value).typeName;
		}
	}

	return null;
}

function inferForInVariableType(
	loopExpr,
	classInfo,
	methodParams,
	methodLocals,
) {
	const expr = (loopExpr || "").trim();
	if (!expr) {
		return "any";
	}

	// Specialized inference for container iterators, e.g. self.balls.iter()
	const iterMatch = expr.match(
		/^([A-Za-z_][A-Za-z0-9_\.]*)\.iter\s*\(\s*\)\s*$/,
	);
	if (iterMatch) {
		const receiverType = inferReceiverTypeSimple(
			iterMatch[1],
			classInfo,
			methodParams,
			methodLocals,
		);
		if (receiverType) {
			const genericMatch = normalizeTypeName(receiverType).match(
				/^[A-Za-z_][A-Za-z0-9_\.]*<(.+)>$/,
			);
			if (genericMatch) {
				const args = splitTopLevelCommas(genericMatch[1]);
				if (args && args.length > 0) {
					return normalizeTypeName(args[0]) || "any";
				}
			}
		}
	}

	return "any";
}

function isKnownType(typeName, classNames, genericTypeParams = null) {
	const baseType = getArrayBaseType(typeName);
	if (genericTypeParams && genericTypeParams.has(baseType)) {
		return true;
	}
	return BUILTIN_TYPES.has(baseType) || classNames.has(baseType);
}

function buildModel(text) {
	const lines = text.split(/\r?\n/);
	const classes = new Map();
	const enums = new Map();
	const duplicates = [];
	const classRanges = [];

	for (let i = 0; i < lines.length; i += 1) {
		const enumMatch = lines[i].match(/^\s*enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
		if (enumMatch) {
			const enumName = enumMatch[1];
			const enumEnd = findEnumEnd(lines, i);

			if (enums.has(enumName) || classes.has(enumName)) {
				duplicates.push({
					kind: "enum",
					name: enumName,
					line: i,
					start: lines[i].indexOf(enumName),
					end: lines[i].indexOf(enumName) + enumName.length,
				});
			}

			const enumInfo = {
				name: enumName,
				line: i,
				start: lines[i].indexOf(enumName),
				end: lines[i].indexOf(enumName) + enumName.length,
				bodyStart: i + 1,
				bodyEnd: enumEnd >= 0 ? enumEnd : i,
				members: new Map(),
			};

			let nextValue = 0;
			if (enumEnd >= 0) {
				for (let j = i + 1; j < enumEnd; j += 1) {
					const parsedMember = parseEnumMember(lines[j]);
					if (!parsedMember) {
						continue;
					}

					let valueExpr = parsedMember.valueExpr;
					if (!valueExpr) {
						valueExpr = String(nextValue);
						nextValue += 1;
					} else {
						const numericValue = Number(valueExpr);
						if (Number.isFinite(numericValue)) {
							nextValue = numericValue + 1;
						}
					}

					enumInfo.members.set(parsedMember.name, {
						name: parsedMember.name,
						valueExpr,
						line: j,
						start: lines[j].indexOf(parsedMember.name),
						end: lines[j].indexOf(parsedMember.name) + parsedMember.name.length,
					});
				}
			}

			enums.set(enumName, enumInfo);
			i = enumEnd >= 0 ? enumEnd : i;
			continue;
		}

		const classMatch = lines[i].match(
			/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*<([^>]*)>)?\s*(?:extends\s+(.+?)\s*)?$/,
		);
		if (!classMatch) {
			continue;
		}

		const className = classMatch[1];
		const classTypeParamsRaw = (classMatch[2] || "").trim();
		const extendsName = normalizeTypeName(classMatch[3] || null);
		const classTypeParams = classTypeParamsRaw
			? classTypeParamsRaw
					.split(",")
					.map((name) => name.trim())
					.filter(Boolean)
			: [];
		const classEnd = findBlockEnd(lines, i);
		const docs = parseDocBlock(lines, i);

		if (classes.has(className)) {
			duplicates.push({
				kind: "class",
				name: className,
				line: i,
				start: lines[i].indexOf(className),
				end: lines[i].indexOf(className) + className.length,
			});
		}

		const classInfo = {
			name: className,
			extendsName,
			typeParams: classTypeParams,
			line: i,
			start: lines[i].indexOf(className),
			end: lines[i].indexOf(className) + className.length,
			bodyStart: i + 1,
			bodyEnd: classEnd >= 0 ? classEnd : i,
			docs,
			fields: new Map(),
			methods: new Map(),
			methodOverloads: new Map(),
			inferredFieldTypes: new Map(),
		};

		let j = i + 1;
		while (classEnd >= 0 && j < classEnd) {
			const line = lines[j];
			const trimmed = line.trim();

			if (!trimmed || /^--/.test(trimmed)) {
				j += 1;
				continue;
			}

			if (/^(local\s+)?function\s+/.test(trimmed)) {
				const parsedMethod = parseTypedParams(line);
				const methodEnd = findBlockEnd(lines, j);
				if (parsedMethod) {
					const methodName = parsedMethod.methodName;
					const methodDocs = parseDocBlock(lines, j);
					const locals = new Map();

					if (methodEnd >= 0) {
						for (let k = j + 1; k < methodEnd; k += 1) {
							const forInMatch = lines[k].match(
								/^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+?)\s+do\s*$/,
							);
							if (forInMatch) {
								const loopVarName = forInMatch[1];
								const loopExpr = forInMatch[2];
								const inferredLoopType = inferForInVariableType(
									loopExpr,
									classInfo,
									parsedMethod.typedParams,
									locals,
								);
								locals.set(loopVarName, {
									name: loopVarName,
									typeName: inferredLoopType || "any",
									defaultExpr: null,
									line: k,
									start: lines[k].indexOf(loopVarName),
									end: lines[k].indexOf(loopVarName) + loopVarName.length,
								});
							}

							const localVariable = parseLocalVariable(lines[k]);
							if (localVariable) {
								locals.set(localVariable.name, {
									...localVariable,
									line: k,
									start: lines[k].indexOf(localVariable.name),
									end:
										lines[k].indexOf(localVariable.name) +
										localVariable.name.length,
								});
							}

							const selfAssign = lines[k].match(
								/^\s*self\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/,
							);
							if (selfAssign) {
								const fieldName = selfAssign[1];
								const expr = selfAssign[2].trim();

								let inferredType = null;
								const ctorMatch = expr.match(
									/^new\s+([A-Za-z_][A-Za-z0-9_\.]*)\s*\(/,
								);
								if (ctorMatch) {
									inferredType = ctorMatch[1];
								} else {
									inferredType = inferLiteralType(expr);
								}

								if (inferredType) {
									classInfo.inferredFieldTypes.set(fieldName, inferredType);
								}
							}
						}
					}

					const methodInfo = {
						name: methodName,
						line: j,
						start: line.indexOf(methodName),
						end: line.indexOf(methodName) + methodName.length,
						params: parsedMethod.typedParams,
						typeParams: parsedMethod.typeParams || [],
						isPrivate: parsedMethod.isPrivate,
						returnTypeName: parsedMethod.returnTypeName || null,
						docs: methodDocs,
						locals,
						bodyStart: j + 1,
						bodyEnd: methodEnd >= 0 ? methodEnd : j,
					};

					if (!classInfo.methodOverloads.has(methodName)) {
						classInfo.methodOverloads.set(methodName, []);
					}
					classInfo.methodOverloads.get(methodName).push(methodInfo);

					if (!classInfo.methods.has(methodName)) {
						classInfo.methods.set(methodName, methodInfo);
					}
				}

				j = methodEnd >= 0 ? methodEnd + 1 : j + 1;
				continue;
			}

			const fieldInfo = parseField(line);
			if (fieldInfo) {
				classInfo.fields.set(fieldInfo.name, {
					...fieldInfo,
					isPrivate: fieldInfo.declarationKind === "local",
					docs: parseDocBlock(lines, j),
					line: j,
					start: line.indexOf(fieldInfo.name),
					end: line.indexOf(fieldInfo.name) + fieldInfo.name.length,
				});
			}

			j += 1;
		}

		classes.set(className, classInfo);
		classRanges.push({ start: i, finish: classEnd >= 0 ? classEnd : i });
		i = classEnd >= 0 ? classEnd + 1 : i + 1;
	}

	const topLevelLocals = new Map();
	for (let i = 0; i < lines.length; i += 1) {
		const inClassRange = classRanges.some(
			(range) => i >= range.start && i <= range.finish,
		);
		if (inClassRange) {
			continue;
		}
		const localVariable = parseLocalVariable(lines[i]);
		if (localVariable) {
			topLevelLocals.set(localVariable.name, {
				...localVariable,
				line: i,
				start: lines[i].indexOf(localVariable.name),
				end: lines[i].indexOf(localVariable.name) + localVariable.name.length,
			});
		}
	}

	const imports = new Set();
	for (const line of lines) {
		const importMatch = line.match(
			/^\s*import\s+([A-Za-z_][A-Za-z0-9_\.]*)\s*(?:--.*)?$/,
		);
		if (importMatch) {
			const modulePath = importMatch[1];
			imports.add(modulePath);

			// Also add the terminal segment so `import types.ArrayList` resolves class `ArrayList`.
			const parts = modulePath.split(".");
			const terminal = parts[parts.length - 1];
			if (terminal) {
				imports.add(terminal);
			}
		}
	}

	return { lines, classes, enums, duplicates, topLevelLocals, imports };
}

function getClassAtLine(model, line) {
	for (const classInfo of model.classes.values()) {
		if (line >= classInfo.line && line <= classInfo.bodyEnd) {
			return classInfo;
		}
	}
	return null;
}

function getMethodAtLine(classInfo, line) {
	if (!classInfo) {
		return null;
	}
	const overloadGroups = classInfo.methodOverloads
		? classInfo.methodOverloads.values()
		: [];
	for (const overloads of overloadGroups) {
		for (const methodInfo of overloads) {
			if (line >= methodInfo.line && line <= methodInfo.bodyEnd) {
				return methodInfo;
			}
		}
	}

	for (const methodInfo of classInfo.methods.values()) {
		if (line >= methodInfo.line && line <= methodInfo.bodyEnd) {
			return methodInfo;
		}
	}

	return null;
}

function getMethodOverloads(classInfo, methodName) {
	if (!classInfo || !methodName) {
		return [];
	}

	if (classInfo.methodOverloads && classInfo.methodOverloads.has(methodName)) {
		return classInfo.methodOverloads.get(methodName);
	}

	if (classInfo.methods && classInfo.methods.has(methodName)) {
		return [classInfo.methods.get(methodName)];
	}

	return [];
}

function findParam(methodInfo, name) {
	if (!methodInfo) {
		return null;
	}
	for (const param of methodInfo.params) {
		if (param.name === name) {
			return param;
		}
	}
	return null;
}

function resolveClassByType(typeName, model, workspaceIndex) {
	const baseType = getArrayBaseType(typeName);
	if (!baseType) {
		return null;
	}
	if (model.classes.has(baseType)) {
		return { uri: null, classInfo: model.classes.get(baseType) };
	}
	if (workspaceIndex && workspaceIndex.has(baseType)) {
		return workspaceIndex.get(baseType);
	}
	return null;
}

function resolveEnumByName(name, model) {
	if (!name || !model.enums) {
		return null;
	}
	if (model.enums.has(name)) {
		return model.enums.get(name);
	}
	return null;
}

function inferExpressionType(
	expr,
	model,
	classInfo,
	methodInfo,
	workspaceIndex,
) {
	const value = expr.trim();
	if (!value) {
		return null;
	}

	const ctorMatch = value.match(
		/^new\s+([A-Za-z_][A-Za-z0-9_\.]*(?:<[^()]+>)?)\s*\(/,
	);
	if (ctorMatch) {
		return normalizeTypeName(ctorMatch[1]);
	}

	const literalType = inferLiteralType(value);
	if (literalType) {
		return literalType;
	}

	if (value === "self") {
		return classInfo ? classInfo.name : null;
	}

	if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
		const param = findParam(methodInfo, value);
		if (param) {
			return param.typeName;
		}
		if (methodInfo && methodInfo.locals.has(value)) {
			return methodInfo.locals.get(value).typeName;
		}
		if (classInfo && classInfo.fields.has(value)) {
			const fieldInfo = classInfo.fields.get(value);
			const inferredType =
				classInfo.inferredFieldTypes && classInfo.inferredFieldTypes.get(value);
			if (
				inferredType &&
				(fieldInfo.typeName === "any" ||
					fieldInfo.typeName === "table" ||
					fieldInfo.typeName === "nil")
			) {
				return inferredType;
			}
			return fieldInfo.typeName;
		}
		if (model.topLevelLocals && model.topLevelLocals.has(value)) {
			return model.topLevelLocals.get(value).typeName;
		}
		if (model.enums && model.enums.has(value)) {
			return value;
		}
		return null;
	}

	const chainParts = value.split(".");
	if (chainParts.length > 1) {
		let currentType = inferExpressionType(
			chainParts[0],
			model,
			classInfo,
			methodInfo,
			workspaceIndex,
		);
		for (let i = 1; i < chainParts.length; i += 1) {
			const resolved = resolveClassByType(currentType, model, workspaceIndex);
			if (!currentType || !resolved) {
				return null;
			}
			const currentClass = resolved.classInfo;
			const segment = chainParts[i];
			if (currentClass.fields.has(segment)) {
				const fieldInfo = currentClass.fields.get(segment);
				const inferredType =
					currentClass.inferredFieldTypes &&
					currentClass.inferredFieldTypes.get(segment);
				if (
					inferredType &&
					(fieldInfo.typeName === "any" ||
						fieldInfo.typeName === "table" ||
						fieldInfo.typeName === "nil")
				) {
					currentType = inferredType;
				} else {
					currentType = fieldInfo.typeName;
				}
			} else {
				return null;
			}
		}
		return currentType;
	}

	return null;
}

module.exports = {
	BUILTIN_TYPES,
	TYPE_NAME_RE,
	normalizeTypeName,
	getArrayBaseType,
	blockDelta,
	findBlockEnd,
	parseDocBlock,
	parseField,
	parseTypedLocal,
	parseLocalVariable,
	parseTypedParams,
	inferLiteralType,
	isKnownType,
	buildModel,
	getClassAtLine,
	getMethodAtLine,
	getMethodOverloads,
	findParam,
	resolveClassByType,
	resolveEnumByName,
	inferExpressionType,
};
