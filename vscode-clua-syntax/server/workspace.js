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
function buildWorkspaceIndex(
	activeUri,
	activeModel,
	documents,
	workspaceFolders,
	importedNames,
) {
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
				if (
					!index.has(classInfo.name) &&
					(!importedNames || importedNames.has(classInfo.name))
				) {
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
	const hasWorkspaceRoots =
		Array.isArray(workspaceFolders) && workspaceFolders.length > 0;

	for (const folderUri of workspaceFolders) {
		const folderPath = fileUriToPath(folderUri);
		if (folderPath && !seen.has(folderPath)) {
			roots.push(folderPath);
			seen.add(folderPath);
		}
	}

	// Only climb from active file when there is no workspace root.
	// Otherwise this can traverse large parent directories and stall the LSP.
	if (activeUri && !hasWorkspaceRoots) {
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

function addRoot(roots, seen, dirPath) {
	if (!dirPath || seen.has(dirPath)) {
		return;
	}
	try {
		if (fs.statSync(dirPath).isDirectory()) {
			roots.push(dirPath);
			seen.add(dirPath);
		}
	} catch (_err) {
		// Ignore non-existing or inaccessible directories.
	}
}

function parseLuaPathRoots(luaPathRaw) {
	if (!luaPathRaw) {
		return [];
	}

	const roots = [];
	for (const entry of String(luaPathRaw).split(";")) {
		const trimmed = entry.trim();
		if (!trimmed || trimmed === "") {
			continue;
		}

		const questionMarkIndex = trimmed.indexOf("?");
		if (questionMarkIndex < 0) {
			continue;
		}

		const prefix = trimmed.slice(0, questionMarkIndex);
		const normalizedPrefix = prefix.replace(/[\\/]+$/g, "");
		if (!normalizedPrefix || normalizedPrefix === ".") {
			continue;
		}
		const candidate = normalizedPrefix;
		if (candidate) {
			roots.push(candidate);
		}
	}

	return roots;
}

function addVersionedLuaRoots(roots, seen, baseDir) {
	if (!baseDir) {
		return;
	}
	for (const version of ["5.1", "5.2", "5.3", "5.4", "5.5"]) {
		addRoot(roots, seen, path.join(baseDir, version));
	}
}

function addConventionalProjectRoots(roots, seen, projectRoot) {
	if (!projectRoot) {
		return;
	}

	for (const name of ["lib", "libs", "vendor", "packages"]) {
		const base = path.join(projectRoot, name);
		addRoot(roots, seen, base);
		addRoot(roots, seen, path.join(base, "lua"));
		addVersionedLuaRoots(roots, seen, path.join(base, "lua"));
		addRoot(roots, seen, path.join(base, "share", "lua"));
		addVersionedLuaRoots(roots, seen, path.join(base, "share", "lua"));
	}
}

function getModuleSearchRoots(activeUri, workspaceFolders) {
	const roots = [];
	const seen = new Set();

	for (const folderUri of workspaceFolders || []) {
		const folderPath = fileUriToPath(folderUri);
		addRoot(roots, seen, folderPath);
		addConventionalProjectRoots(roots, seen, folderPath);
		if (folderPath) {
			for (const version of ["5.1", "5.2", "5.3", "5.4", "5.5"]) {
				addRoot(
					roots,
					seen,
					path.join(folderPath, ".luarocks", "share", "lua", version),
				);
			}
		}
	}

	const activePath = activeUri ? fileUriToPath(activeUri) : null;
	if (activePath) {
		let cursor = path.dirname(activePath);
		for (let i = 0; i < 6; i += 1) {
			addRoot(roots, seen, cursor);
			addConventionalProjectRoots(roots, seen, cursor);
			const parent = path.dirname(cursor);
			if (parent === cursor) {
				break;
			}
			cursor = parent;
		}
	}

	const home = process.env.HOME || process.env.USERPROFILE || "";
	if (home) {
		for (const version of ["5.1", "5.2", "5.3", "5.4", "5.5"]) {
			addRoot(
				roots,
				seen,
				path.join(home, ".luarocks", "share", "lua", version),
			);
		}
	}

	for (const root of parseLuaPathRoots(process.env.LUA_PATH)) {
		addRoot(roots, seen, root);
	}

	for (const version of ["5.1", "5.2", "5.3", "5.4", "5.5"]) {
		addRoot(roots, seen, path.join("/usr/local/share/lua", version));
		addRoot(roots, seen, path.join("/usr/share/lua", version));
	}

	return roots;
}

function buildModuleVariants(modulePath) {
	const variants = [modulePath];
	if (modulePath.startsWith("std.")) {
		variants.push(`clua.${modulePath}`);
	}
	if (modulePath.startsWith("clua.std.")) {
		variants.push(modulePath.slice(5));
	}
	return Array.from(new Set(variants));
}

function moduleVariantCandidates(moduleVariant) {
	const pathPart = moduleVariant.replace(/\./g, "/");
	return [
		`${pathPart}.clua`,
		`${pathPart}/init.clua`,
		`${pathPart}.lua`,
		`${pathPart}/init.lua`,
	];
}

function resolveModulePathToFile(
	modulePath,
	activeUri,
	workspaceFolders,
	trace,
) {
	if (!modulePath) {
		return null;
	}

	const emit = typeof trace === "function" ? trace : null;

	const roots = getModuleSearchRoots(activeUri, workspaceFolders);
	const variants = buildModuleVariants(modulePath);
	if (emit) {
		emit({
			event: "start",
			modulePath,
			rootCount: roots.length,
			variantCount: variants.length,
			roots,
			variants,
		});
	}

	for (const root of roots) {
		for (const variant of variants) {
			for (const candidate of moduleVariantCandidates(variant)) {
				const full = path.join(root, candidate);
				if (fs.existsSync(full)) {
					if (emit) {
						emit({
							event: "hit",
							modulePath,
							path: full,
							variant,
							candidate,
							root,
						});
					}
					return full;
				}

				const underSrc = path.join(root, "src", candidate);
				if (fs.existsSync(underSrc)) {
					if (emit) {
						emit({
							event: "hit",
							modulePath,
							path: underSrc,
							variant,
							candidate: `src/${candidate}`,
							root,
						});
					}
					return underSrc;
				}
			}
		}
	}

	if (emit) {
		emit({ event: "miss", modulePath, roots, variants });
	}

	return null;
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

		const classMatch =
			normalizedQuery === "" ||
			className.toLowerCase().includes(normalizedQuery);
		if (classMatch) {
			symbols.push({
				name: className,
				kind: SymbolKind.Class,
				location: {
					uri: classUri,
					range: {
						start: {
							line: classInfo.line,
							character: Math.max(classInfo.start, 0),
						},
						end: {
							line: classInfo.line,
							character: Math.max(classInfo.end, 1),
						},
					},
				},
			});
		}

		const methodGroups = classInfo.methodOverloads
			? classInfo.methodOverloads.values()
			: [];
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
								start: {
									line: method.line,
									character: Math.max(method.start, 0),
								},
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
	resolveModulePathToFile,
	buildWorkspaceSymbols,
};
