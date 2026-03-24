"use strict";

const KEYWORD_ITEMS = [
	"import",
	"class",
	"enum",
	"var",
	"extends",
	"function",
	"end",
	"if",
	"then",
	"else",
	"elseif",
	"for",
	"while",
	"repeat",
	"until",
	"do",
	"return",
	"local",
	"new",
	"try",
	"catch",
	"finally",
];

function getCurrentWordPrefix(beforeCursor) {
	const m = beforeCursor.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
	return m ? m[1] : "";
}

function detectTryContext(lines, lineIndex) {
	const activeTries = [];
	let depth = 0;

	for (let i = 0; i < lineIndex; i += 1) {
		const raw = lines[i] || "";
		const stripped = raw.replace(/--.*$/, "").trim();
		if (stripped === "") {
			continue;
		}

		if (/^try\b/.test(stripped)) {
			activeTries.push({ depth: depth + 1, hasCatch: false, hasFinally: false });
		}

		if (/^catch\b/.test(stripped)) {
			for (let j = activeTries.length - 1; j >= 0; j -= 1) {
				if (activeTries[j].depth === depth) {
					activeTries[j].hasCatch = true;
					break;
				}
			}
		}

		if (/^finally\b/.test(stripped)) {
			for (let j = activeTries.length - 1; j >= 0; j -= 1) {
				if (activeTries[j].depth === depth) {
					activeTries[j].hasFinally = true;
					break;
				}
			}
		}

		const tokenized = stripped
			.replace(/"([^"\\]|\\.)*"/g, '""')
			.replace(/'([^'\\]|\\.)*'/g, "''")
			.replace(/:\s*function\s*\(/g, ": __fn_type__(");

		if (/^\s*elseif\b.*\bthen\b/.test(tokenized) || /^\s*(catch|finally)\b/.test(tokenized)) {
			continue;
		}

		const tokens = tokenized.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
		for (const token of tokens) {
			if (["function", "then", "do", "repeat", "class", "enum", "try"].includes(token)) {
				depth += 1;
			} else if (["end", "until"].includes(token)) {
				depth = Math.max(0, depth - 1);
				for (let j = activeTries.length - 1; j >= 0; j -= 1) {
					if (activeTries[j].depth > depth) {
						activeTries.splice(j, 1);
					}
				}
			}
		}
	}

	for (let i = activeTries.length - 1; i >= 0; i -= 1) {
		if (activeTries[i].depth === depth) {
			return activeTries[i];
		}
	}

	return null;
}

function makeSnippet(label, insertText, detail, CompletionItemKind, InsertTextFormat) {
	return {
		label,
		kind: CompletionItemKind.Snippet,
		insertText,
		insertTextFormat: InsertTextFormat.Snippet,
		detail,
	};
}

function getContextAwareSnippetItems({
	lines,
	lineIndex,
	beforeCursor,
	CompletionItemKind,
	InsertTextFormat,
}) {
	if (!Array.isArray(lines) || typeof lineIndex !== "number") {
		return [];
	}

	const strippedBefore = (beforeCursor || "").trimStart();
	if (strippedBefore.includes(".")) {
		return [];
	}

	const prefix = getCurrentWordPrefix(beforeCursor || "").toLowerCase();
	const addIfPrefix = (label, item, out) => {
		if (!prefix || label.toLowerCase().startsWith(prefix)) {
			out.push(item);
		}
	};

	const out = [];
	addIfPrefix(
		"try",
		makeSnippet(
			"try/catch",
			["try", "\t$1", "catch ${2:err}", "\t$0", "end"].join("\n"),
			"try/catch block",
			CompletionItemKind,
			InsertTextFormat,
		),
		out,
	);

	addIfPrefix(
		"tryf",
		makeSnippet(
			"try/finally",
			["try", "\t$1", "finally", "\t$0", "end"].join("\n"),
			"try/finally block",
			CompletionItemKind,
			InsertTextFormat,
		),
		out,
	);

	const ctx = detectTryContext(lines, lineIndex);
	if (ctx) {
		if (!ctx.hasCatch && !ctx.hasFinally) {
			addIfPrefix(
				"catch",
				makeSnippet(
					"catch",
					["catch ${1:err}", "\t$0"].join("\n"),
					"catch branch for current try",
					CompletionItemKind,
					InsertTextFormat,
				),
				out,
			);
			addIfPrefix(
				"finally",
				makeSnippet(
					"finally",
					["finally", "\t$0"].join("\n"),
					"finally branch for current try",
					CompletionItemKind,
					InsertTextFormat,
				),
				out,
			);
		} else if (ctx.hasCatch && !ctx.hasFinally) {
			addIfPrefix(
				"finally",
				makeSnippet(
					"finally",
					["finally", "\t$0"].join("\n"),
					"finally branch for current try",
					CompletionItemKind,
					InsertTextFormat,
				),
				out,
			);
		}
	}

	return out;
}

module.exports = {
	KEYWORD_ITEMS,
	getContextAwareSnippetItems,
};
