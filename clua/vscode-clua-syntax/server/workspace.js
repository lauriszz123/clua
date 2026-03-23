"use strict";
// Workspace utilities: file system helpers, workspace indexing, import suggestions, symbol search.

const fs = require("fs");
const path = require("path");
const { fileURLToPath, pathToFileURL } = require("url");
const { SymbolKind } = require("vscode-languageserver/node");
const { buildModel } = require("./parser");

function fileUriToPath(uri) {
  try {
    return fileURLToPath(uri);
  } catch (_err) {
    return null;
  }
}

function pathToFileUri(filePath) {
  return pathToFileURL(filePath).href;
}

function shouldSkipDir(name) {
  return name === ".git" || name === "node_modules" || name === ".vscode";
}

function collectCluaFiles(rootPath, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch (_err) {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        collectCluaFiles(fullPath, out);
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".clua")) {
      out.push(fullPath);
    }
  }
}

// documents is the TextDocuments instance from the LSP server.
function readDocumentTextByUri(uri, documents) {
  const openDoc = documents.get(uri);
  if (openDoc) {
    return openDoc.getText();
  }

  const filePath = fileUriToPath(uri);
  if (!filePath) {
    return null;
  }

  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_err) {
    return null;
  }
}

// workspaceFolders is the array of workspace folder URIs kept in server.js state.
// importedNames (optional Set<string>): when provided, only workspace classes whose name is
// in the set are added to the index.  Classes defined in the active file are always included.
function buildWorkspaceIndex(activeUri, activeModel, documents, workspaceFolders, importedNames) {
  const index = new Map();

  if (activeModel) {
    for (const classInfo of activeModel.classes.values()) {
      index.set(classInfo.name, { uri: activeUri, classInfo });
    }
  }

  for (const folderUri of workspaceFolders) {
    const folderPath = fileUriToPath(folderUri);
    if (!folderPath) {
      continue;
    }

    const files = [];
    collectCluaFiles(folderPath, files);

    for (const filePath of files) {
      const uri = pathToFileUri(filePath);
      if (uri === activeUri) {
        continue;
      }

      const text = readDocumentTextByUri(uri, documents);
      if (!text) {
        continue;
      }

      const model = buildModel(text);
      for (const classInfo of model.classes.values()) {
        // Only index classes that are explicitly imported (or when no filter is provided).
        if (!index.has(classInfo.name) && (!importedNames || importedNames.has(classInfo.name))) {
          index.set(classInfo.name, { uri, classInfo });
        }
      }
    }
  }

  return index;
}

function getSearchRoots(activeUri, workspaceFolders) {
  const roots = [];
  const seen = new Set();

  for (const folderUri of workspaceFolders) {
    const folderPath = fileUriToPath(folderUri);
    if (folderPath && !seen.has(folderPath)) {
      roots.push(folderPath);
      seen.add(folderPath);
    }
  }

  if (activeUri) {
    const activePath = fileUriToPath(activeUri);
    if (activePath) {
      let cursor = path.dirname(activePath);
      for (let i = 0; i < 5; i += 1) {
        if (!seen.has(cursor)) {
          roots.push(cursor);
          seen.add(cursor);
        }
        const parent = path.dirname(cursor);
        if (parent === cursor) {
          break;
        }
        cursor = parent;
      }
    }
  }

  return roots;
}

function toModulePathFromRelative(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized.toLowerCase().endsWith(".clua")) {
    return null;
  }
  const withoutExt = normalized.slice(0, -5);
  const withoutInit = withoutExt.replace(/\/init$/i, "");
  const modulePath = withoutInit.replace(/\//g, ".");
  return modulePath || null;
}

function buildImportSuggestions(activeUri, workspaceFolders) {
  const suggestions = new Map();

  for (const folderPath of getSearchRoots(activeUri, workspaceFolders)) {
    const files = [];
    collectCluaFiles(folderPath, files);

    for (const filePath of files) {
      const fileUri = pathToFileUri(filePath);
      if (fileUri === activeUri) {
        continue;
      }

      const relative = path.relative(folderPath, filePath);
      const normalized = relative.replace(/\\/g, "/");

      const asWorkspaceModule = toModulePathFromRelative(normalized);
      if (asWorkspaceModule) {
        suggestions.set(asWorkspaceModule, filePath);
      }

      if (/^src\//i.test(normalized)) {
        const srcRelative = normalized.slice(4);
        const asSrcModule = toModulePathFromRelative(srcRelative);
        if (asSrcModule) {
          suggestions.set(asSrcModule, filePath);
        }
      }
    }
  }

  return suggestions;
}

function buildWorkspaceSymbols(workspaceIndex, query) {
  const normalizedQuery = (query || "").trim().toLowerCase();
  const symbols = [];

  for (const [className, entry] of workspaceIndex.entries()) {
    const classInfo = entry.classInfo;
    const classUri = entry.uri;
    if (!classUri) {
      continue;
    }

    const classMatch = normalizedQuery === "" || className.toLowerCase().includes(normalizedQuery);
    if (classMatch) {
      symbols.push({
        name: className,
        kind: SymbolKind.Class,
        location: {
          uri: classUri,
          range: {
            start: { line: classInfo.line, character: Math.max(classInfo.start, 0) },
            end: { line: classInfo.line, character: Math.max(classInfo.end, 1) },
          },
        },
      });
    }

    const methodGroups = classInfo.methodOverloads ? classInfo.methodOverloads.values() : [];
    for (const overloads of methodGroups) {
      for (const method of overloads) {
        const name = `${className}.${method.name}`;
        const methodMatch =
          normalizedQuery === "" ||
          name.toLowerCase().includes(normalizedQuery) ||
          method.name.toLowerCase().includes(normalizedQuery);
        if (methodMatch) {
          symbols.push({
            name,
            kind: SymbolKind.Method,
            containerName: className,
            location: {
              uri: classUri,
              range: {
                start: { line: method.line, character: Math.max(method.start, 0) },
                end: { line: method.line, character: Math.max(method.end, 1) },
              },
            },
          });
        }
      }
    }

    for (const field of classInfo.fields.values()) {
      const name = `${className}.${field.name}`;
      const fieldMatch =
        normalizedQuery === "" ||
        name.toLowerCase().includes(normalizedQuery) ||
        field.name.toLowerCase().includes(normalizedQuery);
      if (fieldMatch) {
        symbols.push({
          name,
          kind: SymbolKind.Field,
          containerName: className,
          location: {
            uri: classUri,
            range: {
              start: { line: field.line, character: Math.max(field.start, 0) },
              end: { line: field.line, character: Math.max(field.end, 1) },
            },
          },
        });
      }
    }
  }

  return symbols;
}

module.exports = {
  fileUriToPath,
  pathToFileUri,
  collectCluaFiles,
  readDocumentTextByUri,
  buildWorkspaceIndex,
  getSearchRoots,
  buildImportSuggestions,
  buildWorkspaceSymbols,
};
