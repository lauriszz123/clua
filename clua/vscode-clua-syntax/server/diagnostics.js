"use strict";
// Diagnostics: validates a CLua document and returns an array of LSP Diagnostic objects.

const { DiagnosticSeverity } = require("vscode-languageserver/node");
const {
  buildModel,
  isKnownType,
  inferLiteralType,
  findParam,
  inferExpressionType,
  resolveClassByType,
} = require("./parser");

function collectGenericTypeParams(classInfo, methodInfo = null) {
  const out = new Set();

  for (const typeParam of (classInfo && classInfo.typeParams) ? classInfo.typeParams : []) {
    out.add(typeParam);
  }

  for (const typeParam of (methodInfo && methodInfo.typeParams) ? methodInfo.typeParams : []) {
    out.add(typeParam);
  }

  return out;
}

function pushDiag(diagnostics, lineIndex, startChar, endChar, message, severity = DiagnosticSeverity.Error) {
  diagnostics.push({
    severity,
    range: {
      start: { line: lineIndex, character: startChar },
      end: { line: lineIndex, character: Math.max(endChar, startChar + 1) },
    },
    message,
    source: "clua-lsp",
  });
}

function literalMatchesDeclaredType(literalType, declaredType) {
  if (!literalType) {
    return true;
  }
  if (declaredType === "any" || literalType === declaredType) {
    return true;
  }

  // Array literals are still Lua tables at runtime.
  if (literalType === "table" && /\[\]$/.test(declaredType)) {
    return true;
  }

  // Map/object style table types (e.g. table<string, T>) are also Lua tables.
  if (literalType === "table" && /^table(?:<.*>)?$/.test(declaredType)) {
    return true;
  }

  return false;
}

function splitArrayType(typeName) {
  let base = typeName;
  let depth = 0;

  while (typeof base === "string" && base.endsWith("[]")) {
    base = base.slice(0, -2);
    depth += 1;
  }

  return { base, depth };
}

function expressionMatchesDeclaredType(exprType, declaredType) {
  if (!exprType || declaredType === "any") {
    return true;
  }
  if (exprType === declaredType) {
    return true;
  }

  // Literal/unknown arrays are represented as table by inference.
  if (exprType === "table") {
    return literalMatchesDeclaredType(exprType, declaredType);
  }

  const decl = splitArrayType(declaredType);
  const expr = splitArrayType(exprType);
  if (decl.depth === 0 || expr.depth === 0) {
    return false;
  }

  return decl.depth === expr.depth && (decl.base === "any" || expr.base === decl.base);
}

function isArrayType(typeName) {
  return typeof typeName === "string" && typeName.endsWith("[]");
}

// Returns an array of Diagnostic objects; does NOT call connection.sendDiagnostics itself.
function validateTextDocument(document, workspaceIndex) {
  const text = document.getText();
  const model = buildModel(text);
  const lines = model.lines;
  const diagnostics = [];
  const knownTypes = new Set([
    ...model.classes.keys(),
    ...(model.enums ? model.enums.keys() : []),
    ...(workspaceIndex ? workspaceIndex.keys() : []),
  ]);

  for (const duplicate of model.duplicates) {
    const kind = duplicate.kind || "symbol";
    pushDiag(diagnostics, duplicate.line, duplicate.start, duplicate.end, `Duplicate ${kind} ${duplicate.name}`);
  }

  for (const classInfo of model.classes.values()) {
    if (classInfo.bodyEnd === classInfo.line) {
      pushDiag(diagnostics, classInfo.line, 0, lines[classInfo.line].length, `Unclosed class block for ${classInfo.name}`);
      continue;
    }

    const classGenericTypeParams = collectGenericTypeParams(classInfo);

    if (classInfo.extendsName && !isKnownType(classInfo.extendsName, knownTypes, classGenericTypeParams)) {
      const start = lines[classInfo.line].indexOf(classInfo.extendsName);
      pushDiag(diagnostics, classInfo.line, start, start + classInfo.extendsName.length, `Unknown base class ${classInfo.extendsName}`);
    }

    for (const fieldInfo of classInfo.fields.values()) {
      if (!isKnownType(fieldInfo.typeName, knownTypes, classGenericTypeParams)) {
        const start = lines[fieldInfo.line].indexOf(fieldInfo.typeName);
        pushDiag(diagnostics, fieldInfo.line, Math.max(start, 0), Math.max(start, 0) + fieldInfo.typeName.length, `Unknown field type ${fieldInfo.typeName}`);
      }

      if (fieldInfo.defaultExpr) {
        const inferredType = inferExpressionType(fieldInfo.defaultExpr, model, classInfo, null, workspaceIndex)
          || inferLiteralType(fieldInfo.defaultExpr);
        if (!expressionMatchesDeclaredType(inferredType, fieldInfo.typeName)) {
          const start = lines[fieldInfo.line].indexOf(fieldInfo.defaultExpr);
          pushDiag(
            diagnostics,
            fieldInfo.line,
            Math.max(start, 0),
            Math.max(start, 0) + fieldInfo.defaultExpr.length,
            `Type mismatch for default ${fieldInfo.name}: expected ${fieldInfo.typeName}, got ${inferredType || "unknown"}`
          );
        }
      }
    }

    const methodGroups = classInfo.methodOverloads ? classInfo.methodOverloads.values() : [];
    for (const overloads of methodGroups) {
      for (const methodInfo of overloads) {
      if (methodInfo.bodyEnd === methodInfo.line) {
        pushDiag(diagnostics, methodInfo.line, 0, lines[methodInfo.line].length, `Unclosed method ${methodInfo.name}`);
        continue;
      }

      const methodGenericTypeParams = collectGenericTypeParams(classInfo, methodInfo);

      for (const info of methodInfo.params) {
        if (!isKnownType(info.typeName, knownTypes, methodGenericTypeParams)) {
          const typeStart = lines[methodInfo.line].indexOf(info.typeName);
          pushDiag(
            diagnostics,
            methodInfo.line,
            Math.max(typeStart, 0),
            Math.max(typeStart, 0) + info.typeName.length,
            `Unknown type ${info.typeName} in ${classInfo.name}.${methodInfo.name}`
          );
        }
      }

      for (const docParam of methodInfo.docs.params.values()) {
        const typedParam = findParam(methodInfo, docParam.name);
        if (!typedParam) {
          pushDiag(
            diagnostics,
            methodInfo.line,
            0,
            lines[methodInfo.line].length,
            `Documented param ${docParam.name} does not exist in ${classInfo.name}.${methodInfo.name}`,
            DiagnosticSeverity.Warning
          );
          continue;
        }

        if (typedParam.typeName !== docParam.typeName) {
          pushDiag(
            diagnostics,
            methodInfo.line,
            0,
            lines[methodInfo.line].length,
            `Doc param ${docParam.name} has type ${docParam.typeName}, but signature uses ${typedParam.typeName}`,
            DiagnosticSeverity.Warning
          );
        }
      }

      for (let k = methodInfo.bodyStart; k < methodInfo.bodyEnd; k += 1) {
        const bodyLine = lines[k];

        // Strip comments and string literals so we don't match inside them.
        const analysisLine = bodyLine
          .replace(/--.*$/, "")
          .replace(/"([^"\\]|\\.)*"/g, '""')
          .replace(/'([^'\\]|\\.)*'/g, "''");

        // Flag self.xxx where xxx is not a declared field or method.
        const selfAccessRe = /\bself\.([A-Za-z_][A-Za-z0-9_]*)/g;
        let selfMatch;
        while ((selfMatch = selfAccessRe.exec(analysisLine)) !== null) {
          const fname = selfMatch[1];
          if (!classInfo.fields.has(fname) && !classInfo.methods.has(fname)) {
            const rawIdx = bodyLine.indexOf(`self.${fname}`);
            const pos = rawIdx >= 0 ? rawIdx + 5 : selfMatch.index + 5;
            pushDiag(
              diagnostics,
              k,
              pos,
              pos + fname.length,
              `Field '${fname}' is not declared in class ${classInfo.name}`
            );
          }
        }

        // Flag dot member access on array-typed fields, e.g. self.items.update(...)
        const arrayMemberAccessRe = /\bself\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;
        let arrayAccessMatch;
        while ((arrayAccessMatch = arrayMemberAccessRe.exec(analysisLine)) !== null) {
          const fieldName = arrayAccessMatch[1];
          const memberName = arrayAccessMatch[2];
          const fieldInfo = classInfo.fields.get(fieldName);
          if (!fieldInfo || !isArrayType(fieldInfo.typeName)) {
            continue;
          }

          const rawIdx = bodyLine.indexOf(`self.${fieldName}.${memberName}`);
          const startPos = rawIdx >= 0 ? rawIdx : arrayAccessMatch.index;
          pushDiag(
            diagnostics,
            k,
            startPos,
            startPos + (`self.${fieldName}.${memberName}`).length,
            `Field '${fieldName}' is ${fieldInfo.typeName}; use indexing (e.g. self.${fieldName}[i]) before member access`
          );
        }

        // Flag unknown member access on class-typed fields, e.g. self.list.update(...)
        // when the referenced class does not define that member.
        const classMemberAccessRe = /\bself\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;
        let classAccessMatch;
        while ((classAccessMatch = classMemberAccessRe.exec(analysisLine)) !== null) {
          const fieldName = classAccessMatch[1];
          const memberName = classAccessMatch[2];
          const fieldInfo = classInfo.fields.get(fieldName);
          if (!fieldInfo || isArrayType(fieldInfo.typeName)) {
            continue;
          }

          const resolved = resolveClassByType(fieldInfo.typeName, model, workspaceIndex);
          if (!resolved || !resolved.classInfo) {
            continue;
          }

          const targetClass = resolved.classInfo;
          if (targetClass.fields.has(memberName) || targetClass.methods.has(memberName)) {
            continue;
          }

          const rawIdx = bodyLine.indexOf(`self.${fieldName}.${memberName}`);
          const startPos = rawIdx >= 0 ? rawIdx : classAccessMatch.index;
          pushDiag(
            diagnostics,
            k,
            startPos,
            startPos + (`self.${fieldName}.${memberName}`).length,
            `Type ${fieldInfo.typeName} has no member '${memberName}'`
          );
        }

        // Type mismatch check for assignments to declared fields.
        const assignMatch = bodyLine.match(/^\s*self\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
        if (!assignMatch) {
          continue;
        }

        const fieldName = assignMatch[1];
        const expr = assignMatch[2].trim();
        const fieldInfo = classInfo.fields.get(fieldName);
        if (!fieldInfo) {
          continue;
        }

        const inferredType = inferExpressionType(expr, model, classInfo, methodInfo, workspaceIndex) || inferLiteralType(expr);
        if (!expressionMatchesDeclaredType(inferredType, fieldInfo.typeName)) {
          const start = bodyLine.indexOf(expr);
          pushDiag(
            diagnostics,
            k,
            Math.max(start, 0),
            Math.max(start, 0) + expr.length,
            `Type mismatch for self.${fieldName}: expected ${fieldInfo.typeName}, got ${inferredType || "unknown"}`
          );
        }
      }
    }
    }
  }

  return diagnostics;
}

module.exports = { validateTextDocument };
