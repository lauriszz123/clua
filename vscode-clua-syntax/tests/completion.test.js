"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getContextAwareSnippetItems } = require("../server/completion");

const CompletionItemKind = { Snippet: 15 };
const InsertTextFormat = { Snippet: 2 };

test("completion suggests catch and finally inside a try block", () => {
	const lines = ["try", "\tlocal a = 1", ""]; 
	const items = getContextAwareSnippetItems({
		lines,
		lineIndex: 2,
		beforeCursor: "",
		CompletionItemKind,
		InsertTextFormat,
	});

	const labels = items.map((item) => item.label);
	assert.ok(labels.includes("catch"));
	assert.ok(labels.includes("finally"));
});

test("completion suggests only finally after catch", () => {
	const lines = ["try", "\twork()", "catch err", ""]; 
	const items = getContextAwareSnippetItems({
		lines,
		lineIndex: 3,
		beforeCursor: "",
		CompletionItemKind,
		InsertTextFormat,
	});

	const labels = items.map((item) => item.label);
	assert.ok(!labels.includes("catch"));
	assert.ok(labels.includes("finally"));
});

test("completion suppresses snippets for member access contexts", () => {
	const lines = ["obj."]; 
	const items = getContextAwareSnippetItems({
		lines,
		lineIndex: 0,
		beforeCursor: "obj.",
		CompletionItemKind,
		InsertTextFormat,
	});

	assert.equal(items.length, 0);
});
