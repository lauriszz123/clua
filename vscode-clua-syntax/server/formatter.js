"use strict";

function formatterBlockDelta(line) {
	const text = line
		.replace(/--.*$/, "")
		.replace(/"([^"\\]|\\.)*"/g, '""')
		.replace(/'([^'\\]|\\.)*'/g, "''")
		// Do not count function type annotations (e.g. function(): T) as block starters.
		.replace(/:\s*function\s*\(/g, ": __fn_type__(");

	if (/^\s*elseif\b.*\bthen\b/.test(text)) return 0;
	if (/^\s*(catch|finally)\b/.test(text)) return 0;

	let delta = 0;
	const tokens = text.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
	for (const token of tokens) {
		if (["function", "then", "do", "repeat", "class", "enum", "try"].includes(token)) {
			delta += 1;
		} else if (["end", "until"].includes(token)) {
			delta -= 1;
		}
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
		const isDecrease = /^(end|until|else|elseif|catch|finally)\b/.test(stripped);
		const lineDepth = Math.max(0, isDecrease ? depth - 1 : depth);
		out.push(indentStr.repeat(lineDepth) + stripped.trimEnd());
		depth = Math.max(0, depth + formatterBlockDelta(stripped));
	}

	const collapsed = [];
	let lastBlank = false;
	for (const line of out) {
		const isBlank = line === "";
		if (isBlank && lastBlank) continue;
		collapsed.push(line);
		lastBlank = isBlank;
	}

	while (collapsed.length > 0 && collapsed[collapsed.length - 1] === "") {
		collapsed.pop();
	}
	return collapsed.join("\n") + "\n";
}

module.exports = {
	formatterBlockDelta,
	formatDocument,
};
