const {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  CompletionItemKind,
  InsertTextFormat,
} = require("vscode-languageserver/node");
const { TextDocument } = require("vscode-languageserver-textdocument");

const {
  BUILTIN_TYPES,
  buildModel,
  getClassAtLine,
  getMethodAtLine,
  getMethodOverloads,
  findParam,
  inferExpressionType,
  resolveClassByType,
} = require("./parser");
const {
  fileUriToPath,
  buildWorkspaceIndex,
  buildImportSuggestions,
  buildWorkspaceSymbols,
} = require("./workspace");
const {
  renderDocsText,
  makeHover,
  getDisplayParams,
  buildMethodDisplayLabel,
  buildClassHoverData,
  buildClassTypeHoverData,
  buildSignatureInformation,
} = require("./render");
const { validateTextDocument } = require("./diagnostics");
const { LUA_GLOBALS, LUA_LIBS } = require("./lua-stdlib");
const {
  LOVE_NAMESPACES,
  getLoveChildren,
  getLoveFunction,
  getLoveNamespace,
} = require("./love-api");

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let workspaceFolders = [];
const IDENTIFIER_TRIGGER_CHARACTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_".split("");

connection.onInitialize((params) => {
  workspaceFolders = [];
  if (Array.isArray(params.workspaceFolders) && params.workspaceFolders.length > 0) {
    workspaceFolders = params.workspaceFolders.map((folder) => folder.uri);
  } else if (params.rootUri) {
    workspaceFolders = [params.rootUri];
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: [".", " ", ...IDENTIFIER_TRIGGER_CHARACTERS],
      },
      hoverProvider: true,
      definitionProvider: true,
      workspaceSymbolProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ["(", ","],
      },
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
    },
  };
});

// ---------- text helpers (used only by handlers below) ----------

function isIdentifierChar(ch) {
  return /[A-Za-z0-9_]/.test(ch || "");
}

function getWordAt(lineText, character) {
  if (!lineText || character < 0 || character > lineText.length) {
    return null;
  }

  let start = character;
  if (start > 0 && !isIdentifierChar(lineText[start]) && isIdentifierChar(lineText[start - 1])) {
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

function getCompletionTargetClass(beforeCursor, model, classInfo, methodInfo, workspaceIndex) {
  const match = beforeCursor.match(/([A-Za-z_][A-Za-z0-9_\.]*)\s*\.\s*[A-Za-z0-9_]*$/);
  if (!match) {
    return null;
  }

  const targetType = inferExpressionType(match[1], model, classInfo, methodInfo, workspaceIndex);
  const resolved = resolveClassByType(targetType, model, workspaceIndex);
  if (!resolved) {
    return null;
  }

  // Private members are only accessible from within the same class (receiver must be `self`).
  const isSameClass = classInfo && resolved.classInfo.name === classInfo.name;
  return {
    classInfo: resolved.classInfo,
    allowPrivate: canAccessPrivateMembers(match[1]) && !!isSameClass,
    typeParamMap: buildTypeParamMap(resolved.classInfo, targetType),
  };
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
        const calleeMatch = calleeText.match(/([A-Za-z_][A-Za-z0-9_\.]*\s*\.\s*[A-Za-z_][A-Za-z0-9_]*|new\s+[A-Za-z_][A-Za-z0-9_\.]*|[A-Za-z_][A-Za-z0-9_\.]*)$/);
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

function splitTopLevelCommas(text) {
  const out = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "<") {
      depth += 1;
    } else if (ch === ">") {
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

function buildTypeParamMap(classInfo, resolvedType) {
  const typeParams = classInfo && classInfo.typeParams ? classInfo.typeParams : [];
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

function resolveCallSignature(callContext, model, classInfo, methodInfo, workspaceIndex) {
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

  const methodMatch = callContext.callee.match(/(.+)\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (methodMatch) {
    const receiverExpr = methodMatch[1];
    const memberName = methodMatch[2];
    const allowPrivate = canAccessPrivateMembers(receiverExpr);
    const receiverType = inferExpressionType(receiverExpr, model, classInfo, methodInfo, workspaceIndex);
    const resolved = resolveClassByType(receiverType, model, workspaceIndex);
    if (!resolved) {
      return null;
    }

    const overloads = getMethodOverloads(resolved.classInfo, memberName);
    if (!overloads.length) {
      return null;
    }
    const visibleOverloads = overloads.filter((overload) => !overload.isPrivate || allowPrivate);
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

  if (model.classes.has(callContext.callee) || workspaceIndex.has(callContext.callee)) {
    const resolved = resolveClassByType(callContext.callee, model, workspaceIndex);
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

// ---------- LSP handlers ----------

connection.onCompletion((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const model = buildModel(document.getText());
  const workspaceIndex = buildWorkspaceIndex(document.uri, model, documents, workspaceFolders, model.imports);
  const lineText = model.lines[params.position.line] || "";
  const beforeCursor = lineText.slice(0, params.position.character);
  const classInfo = getClassAtLine(model, params.position.line);
  const methodInfo = getMethodAtLine(classInfo, params.position.line);
  const completionTarget = getCompletionTargetClass(beforeCursor, model, classInfo, methodInfo, workspaceIndex);
  const completionClass = completionTarget ? completionTarget.classInfo : null;
  const completionAllowsPrivate = completionTarget ? completionTarget.allowPrivate : false;
  const completionTypeParamMap = completionTarget ? completionTarget.typeParamMap : null;

  const items = [];
  const keywordItems = [
    "import", "class", "enum", "var", "extends", "function", "end",
    "if", "then", "else", "elseif", "for", "while",
    "repeat", "until", "do", "return", "local", "new",
  ];

  const importMatch = beforeCursor.match(/^\s*import\s+([A-Za-z0-9_\.]*)$/);
  if (importMatch) {
    const typedPrefix = importMatch[1] || "";
    const modules = buildImportSuggestions(document.uri, workspaceFolders);
    const moduleItems = [];

    for (const [moduleName, filePath] of modules.entries()) {
      if (typedPrefix !== "" && !moduleName.toLowerCase().startsWith(typedPrefix.toLowerCase())) {
        continue;
      }

      moduleItems.push({
        label: moduleName,
        kind: CompletionItemKind.Module,
        detail: filePath,
      });
    }

    moduleItems.sort((a, b) => a.label.localeCompare(b.label));
    return moduleItems;
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

  // Dot-access on a known class type: complete fields/methods
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
      const specializedMethod = specializeMethod(method, completionTypeParamMap);
      const specializedDocs = specializeDocs(method.docs, completionTypeParamMap);
      const paramsText = getDisplayParams(specializedMethod, specializedDocs).map((p) => `${p.name}: ${p.typeName}`).join(", ");
      items.push({
        label: method.name,
        kind: CompletionItemKind.Method,
        detail: `method ${method.name}(${paramsText})`,
        documentation: renderDocsText(specializedDocs),
      });
    }

    return items;
  }

  // Dot-access on a stdlib lib name: complete lib members
  const libAccessMatch = beforeCursor.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*[A-Za-z0-9_]*$/);
  if (libAccessMatch && LUA_LIBS[libAccessMatch[1]]) {
    const lib = LUA_LIBS[libAccessMatch[1]];
    for (const [name, entry] of Object.entries(lib)) {
      if (typeof entry !== "object" || !entry.signature) { continue; }
      items.push({
        label: name,
        kind: CompletionItemKind.Function,
        detail: entry.signature,
        documentation: entry.doc,
      });
    }
    return items;
  }

  // Dot-access on LOVE namespaces: love., love.graphics., etc.
  const loveAccessMatch = beforeCursor.match(/\b(love(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\.\s*([A-Za-z0-9_]*)$/);
  if (loveAccessMatch) {
    const prefix = loveAccessMatch[1];
    const typedMember = loveAccessMatch[2] || "";
    const children = getLoveChildren(prefix);

    for (const child of children) {
      if (typedMember !== "" && !child.label.toLowerCase().startsWith(typedMember.toLowerCase())) {
        continue;
      }

      items.push({
        label: child.label,
        kind: child.kind === "namespace" ? CompletionItemKind.Module : CompletionItemKind.Function,
        detail: child.detail,
        documentation: child.doc,
      });
    }

    return items;
  }

  // Dot-access on enums: Color.Red
  const enumAccessMatch = beforeCursor.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z0-9_]*)$/);
  if (enumAccessMatch && model.enums && model.enums.has(enumAccessMatch[1])) {
    const enumInfo = model.enums.get(enumAccessMatch[1]);
    const typedMember = enumAccessMatch[2] || "";
    for (const member of enumInfo.members.values()) {
      if (typedMember !== "" && !member.name.toLowerCase().startsWith(typedMember.toLowerCase())) {
        continue;
      }
      items.push({
        label: member.name,
        kind: CompletionItemKind.EnumMember,
        detail: `${enumInfo.name}.${member.name} = ${member.valueExpr}`,
      });
    }
    return items;
  }

  for (const keyword of keywordItems) {
    items.push({ label: keyword, kind: CompletionItemKind.Keyword });
  }

  for (const typeName of BUILTIN_TYPES.values()) {
    items.push({ label: typeName, kind: CompletionItemKind.TypeParameter });
  }

  // Stdlib globals
  for (const [name, entry] of Object.entries(LUA_GLOBALS)) {
    items.push({
      label: name,
      kind: CompletionItemKind.Function,
      detail: entry.signature,
      documentation: entry.doc,
    });
  }

  // Stdlib lib names
  for (const libName of Object.keys(LUA_LIBS)) {
    items.push({ label: libName, kind: CompletionItemKind.Module, detail: `Lua standard library: ${libName}` });
  }

  // LOVE root namespace
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
    const ctorDetail = ctor ? buildMethodDisplayLabel(`new ${cls.name}`, ctor, ctor.docs) : `class ${cls.name}`;
    items.push({
      label: cls.name,
      kind: CompletionItemKind.Class,
      detail: ctorDetail,
      documentation: renderDocsText(ctor && ctor.docs && ctor.docs.description ? ctor.docs : cls.docs),
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
    const ctorDetail = ctor ? buildMethodDisplayLabel(`new ${name}`, ctor, ctor.docs) : `class ${name}`;
    items.push({
      label: name,
      kind: CompletionItemKind.Class,
      detail: ctorDetail,
      documentation: renderDocsText(ctor && ctor.docs && ctor.docs.description ? ctor.docs : entry.classInfo.docs),
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
        documentation: doc ? `${doc.typeName}${doc.description ? ` - ${doc.description}` : ""}` : undefined,
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

  return items;
});

connection.onHover((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const model = buildModel(document.getText());
  const workspaceIndex = buildWorkspaceIndex(document.uri, model, documents, workspaceFolders, model.imports);
  const lineText = model.lines[params.position.line] || "";
  const token = getWordAt(lineText, params.position.character);
  if (!token) {
    return null;
  }

  const word = token.word;
  const classInfo = getClassAtLine(model, params.position.line);
  const methodInfo = getMethodAtLine(classInfo, params.position.line);
  const beforeMember = lineText.slice(0, token.start);
  const memberReceiverMatch = beforeMember.match(/([A-Za-z_][A-Za-z0-9_\.]*)\s*\.\s*$/);

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
        return makeHover(`enum ${enumInfo.name}.${member.name} = ${member.valueExpr}`, {
          description: `Enum member of ${enumInfo.name}`,
          params: new Map(),
        });
      }
    }
    const allowPrivate = canAccessPrivateMembers(receiverExpr);

    // Stdlib lib member hover
    if (LUA_LIBS[receiverExpr] && LUA_LIBS[receiverExpr][word]) {
      const entry = LUA_LIBS[receiverExpr][word];
      const fakeDocs = {
        description: entry.doc,
        params: new Map((entry.params || []).map((p) => [p.name, p])),
      };
      return makeHover(entry.signature, fakeDocs);
    }

    const receiverType = inferExpressionType(receiverExpr, model, classInfo, methodInfo, workspaceIndex);
    const resolvedClass = resolveClassByType(receiverType, model, workspaceIndex);
    if (resolvedClass) {
      const targetClass = resolvedClass.classInfo;
      const typeParamMap = buildTypeParamMap(targetClass, receiverType);
      const targetOverloads = getMethodOverloads(targetClass, word);
      if (targetOverloads.length) {
        const method = targetOverloads[0];
        if (method.isPrivate && !allowPrivate) {
          return null;
        }
        const specializedMethod = specializeMethod(method, typeParamMap);
        const specializedDocs = specializeDocs(method.docs, typeParamMap);
        return makeHover(
          buildMethodDisplayLabel(`function ${targetClass.name}.${method.name}`, specializedMethod, specializedDocs),
          specializedDocs
        );
      }

      if (targetClass.fields.has(word)) {
        const field = targetClass.fields.get(word);
        if (field.isPrivate && !allowPrivate) {
          return null;
        }
        return makeHover(`field ${targetClass.name}.${field.name}: ${applyTypeParamMap(field.typeName, typeParamMap)}`, field.docs);
      }
    }
  }

  // Stdlib global hover
  if (LUA_GLOBALS[word]) {
    const entry = LUA_GLOBALS[word];
    const fakeDocs = {
      description: entry.doc,
      params: new Map((entry.params || []).map((p) => [p.name, p])),
    };
    return makeHover(entry.signature, fakeDocs);
  }

  if (model.classes.has(word) || workspaceIndex.has(word)) {
    const entry = model.classes.has(word) ? { uri: document.uri, classInfo: model.classes.get(word) } : workspaceIndex.get(word);
    const cls = entry.classInfo;
    const beforeWord = lineText.slice(0, token.start);
    const afterWord = lineText.slice(token.end);
    const isConstructorHover = /\bnew\s+$/.test(beforeWord) && /^\s*\(/.test(afterWord);
    const hoverData = isConstructorHover ? buildClassHoverData(cls) : buildClassTypeHoverData(cls);
    return makeHover(hoverData.signature, hoverData.docs);
  }

  if (model.enums && model.enums.has(word)) {
    const enumInfo = model.enums.get(word);
    const preview = Array.from(enumInfo.members.values()).slice(0, 5).map((m) => `${m.name} = ${m.valueExpr}`).join("\n");
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
      const method = classOverloads[0];
      return makeHover(buildMethodDisplayLabel(`function ${classInfo.name}.${method.name}`, method, method.docs), method.docs);
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

  return null;
});

connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const model = buildModel(document.getText());
  const workspaceIndex = buildWorkspaceIndex(document.uri, model, documents, workspaceFolders, model.imports);
  const lineText = model.lines[params.position.line] || "";
  const token = getWordAt(lineText, params.position.character);
  if (!token) {
    return null;
  }

  const word = token.word;
  const classInfo = getClassAtLine(model, params.position.line);
  const methodInfo = getMethodAtLine(classInfo, params.position.line);

  const beforeMember = lineText.slice(0, token.start);
  const memberReceiverMatch = beforeMember.match(/([A-Za-z_][A-Za-z0-9_\.]*)\s*\.\s*$/);
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
    const receiverType = inferExpressionType(receiverExpr, model, classInfo, methodInfo, workspaceIndex);
    const resolvedClass = resolveClassByType(receiverType, model, workspaceIndex);
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
    const entry = model.classes.has(word) ? { uri: document.uri, classInfo: model.classes.get(word) } : workspaceIndex.get(word);
    const cls = entry.classInfo;
    return {
      uri: entry.uri || document.uri,
      range: {
        start: { line: cls.line, character: Math.max(cls.start, 0) },
        end: { line: cls.line, character: Math.max(cls.end, 1) },
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
        start: { line: localInfo.line, character: Math.max(localInfo.start, 0) },
        end: { line: localInfo.line, character: Math.max(localInfo.end, 1) },
      },
    };
  }

  return null;
});

connection.onSignatureHelp((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const model = buildModel(document.getText());
  const workspaceIndex = buildWorkspaceIndex(document.uri, model, documents, workspaceFolders, model.imports);
  const lineText = model.lines[params.position.line] || "";
  const beforeCursor = lineText.slice(0, params.position.character);
  const classInfo = getClassAtLine(model, params.position.line);
  const methodInfo = getMethodAtLine(classInfo, params.position.line);
  const callContext = extractCallContext(beforeCursor);

  if (callContext) {
    const loveEntry = getLoveFunction(callContext.callee);
    if (loveEntry) {
      const fakeDocs = {
        description: loveEntry.doc,
        params: new Map((loveEntry.params || []).map((p) => [p.name, p])),
      };
      const fakeMethod = { params: loveEntry.params || [] };
      return {
        signatures: [buildSignatureInformation(loveEntry.signature.replace(/\(.*/, ""), fakeMethod, fakeDocs)],
        activeSignature: 0,
        activeParameter: Math.min(callContext.activeParameter, Math.max((loveEntry.params || []).length - 1, 0)),
      };
    }

    // Stdlib global signature help
    if (LUA_GLOBALS[callContext.callee]) {
      const entry = LUA_GLOBALS[callContext.callee];
      const fakeDocs = {
        description: entry.doc,
        params: new Map((entry.params || []).map((p) => [p.name, p])),
      };
      const fakeMethod = { params: entry.params || [] };
      return {
        signatures: [buildSignatureInformation(entry.signature.replace(/\(.*/, ""), fakeMethod, fakeDocs)],
        activeSignature: 0,
        activeParameter: Math.min(callContext.activeParameter, Math.max((entry.params || []).length - 1, 0)),
      };
    }

    // Stdlib lib.method signature help
    const libMethodMatch = callContext.callee.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/);
    if (libMethodMatch && LUA_LIBS[libMethodMatch[1]] && LUA_LIBS[libMethodMatch[1]][libMethodMatch[2]]) {
      const entry = LUA_LIBS[libMethodMatch[1]][libMethodMatch[2]];
      const fakeDocs = {
        description: entry.doc,
        params: new Map((entry.params || []).map((p) => [p.name, p])),
      };
      const fakeMethod = { params: entry.params || [] };
      return {
        signatures: [buildSignatureInformation(entry.signature.replace(/\(.*/, ""), fakeMethod, fakeDocs)],
        activeSignature: 0,
        activeParameter: Math.min(callContext.activeParameter, Math.max((entry.params || []).length - 1, 0)),
      };
    }
  }

  const resolved = resolveCallSignature(callContext, model, classInfo, methodInfo, workspaceIndex);
  if (!resolved) {
    return null;
  }

  const signatures = resolved.overloads.map((overload) => {
    const specializedOverload = specializeMethod(overload, resolved.typeParamMap);
    const specializedDocs = specializeDocs(overload.docs, resolved.typeParamMap);
    return buildSignatureInformation(resolved.labelPrefix, specializedOverload, specializedDocs);
  });

  const activeSignature =
    resolved.activeSignature >= 0 && resolved.activeSignature < signatures.length ? resolved.activeSignature : 0;

  const activeOverload = resolved.overloads[activeSignature] || resolved.overloads[0];
  const maxParamIndex = Math.max(((activeOverload && activeOverload.params) || []).length - 1, 0);

  return {
    signatures,
    activeSignature,
    activeParameter: Math.min(callContext.activeParameter, maxParamIndex),
  };
});

connection.onWorkspaceSymbol((params) => {
  const workspaceIndex = buildWorkspaceIndex(null, null, documents, workspaceFolders);
  return buildWorkspaceSymbols(workspaceIndex, params.query);
});

function sendDiagnostics(document) {
  const model = buildModel(document.getText());
  const workspaceIndex = buildWorkspaceIndex(document.uri, model, documents, workspaceFolders, model.imports);
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics: validateTextDocument(document, workspaceIndex),
  });
}

documents.onDidOpen((event) => {
  sendDiagnostics(event.document);
});

documents.onDidChangeContent((change) => {
  sendDiagnostics(change.document);
});

documents.onDidSave((event) => {
  sendDiagnostics(event.document);
});

// ---------- formatting ----------

function formatterBlockDelta(line) {
  const text = line
    .replace(/--.*$/, "")
    .replace(/"([^"\\]|\\.)*"/g, '""')
    .replace(/'([^'\\]|\\.)*'/g, "''")
    // Do not count function type annotations (e.g. function(): T) as block starters.
    .replace(/:\s*function\s*\(/g, ": __fn_type__(");

  if (/^\s*elseif\b.*\bthen\b/.test(text)) return 0;

  let delta = 0;
  const tokens = text.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  for (const token of tokens) {
    if (["function", "then", "do", "repeat", "class", "enum"].includes(token)) delta += 1;
    else if (["end", "until"].includes(token)) delta -= 1;
  }
  return delta;
}

function formatDocument(text, tabSize, insertSpaces) {
  const indentStr = insertSpaces ? " ".repeat(tabSize) : "\t";
  const rawLines = text.split(/\r?\n/);
  let depth = 0;
  const out = [];

  for (const line of rawLines) {
    const stripped = line.trimStart();
    if (stripped === "") {
      out.push("");
      continue;
    }
    const isDecrease = /^(end|until|else|elseif)\b/.test(stripped);
    const lineDepth = Math.max(0, isDecrease ? depth - 1 : depth);
    out.push(indentStr.repeat(lineDepth) + stripped.trimEnd());
    depth = Math.max(0, depth + formatterBlockDelta(stripped));
  }

  // Collapse consecutive blank lines to at most one
  const collapsed = [];
  let lastBlank = false;
  for (const l of out) {
    const isBlank = l === "";
    if (isBlank && lastBlank) continue;
    collapsed.push(l);
    lastBlank = isBlank;
  }

  // Ensure single trailing newline
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === "") collapsed.pop();
  return collapsed.join("\n") + "\n";
}

connection.onDocumentFormatting((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const newText = formatDocument(
    document.getText(),
    params.options.tabSize || 4,
    params.options.insertSpaces !== false
  );
  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: document.lineCount, character: 0 },
      },
      newText,
    },
  ];
});

connection.onDocumentRangeFormatting((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  // Format the whole document for simplicity (range formatting is tricky with block depth).
  const newText = formatDocument(
    document.getText(),
    params.options.tabSize || 4,
    params.options.insertSpaces !== false
  );
  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: document.lineCount, character: 0 },
      },
      newText,
    },
  ];
});

documents.listen(connection);
connection.listen();
