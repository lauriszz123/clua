"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readJson(relPath) {
	const filePath = path.join(__dirname, "..", relPath);
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("language configuration includes try/catch/finally indentation and folding", () => {
	const cfg = readJson("language-configuration.json");
	const inc = cfg.indentationRules.increaseIndentPattern;
	const dec = cfg.indentationRules.decreaseIndentPattern;
	const foldStart = cfg.folding.markers.start;
	const foldEnd = cfg.folding.markers.end;

	for (const keyword of ["try", "catch", "finally"]) {
		assert.ok(inc.includes(keyword));
		assert.ok(foldStart.includes(keyword));
	}

	for (const keyword of ["catch", "finally"]) {
		assert.ok(dec.includes(keyword));
		assert.ok(foldEnd.includes(keyword));
	}
});

test("syntax grammar keyword regex includes try/catch/finally", () => {
	const grammar = readJson(path.join("syntaxes", "clua.tmLanguage.json"));
	const keywordPattern = grammar.repository.keywords.patterns[0].match;
	assert.ok(keywordPattern.includes("try"));
	assert.ok(keywordPattern.includes("catch"));
	assert.ok(keywordPattern.includes("finally"));
});

test("snippet catalog includes try/catch/finally templates", () => {
	const snippets = readJson(path.join("snippets", "clua.json"));
	assert.ok(snippets["Try Catch"]);
	assert.ok(snippets["Try Finally"]);
	assert.ok(snippets["Try Catch Finally"]);
});
