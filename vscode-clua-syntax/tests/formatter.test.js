"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { formatterBlockDelta, formatDocument } = require("../server/formatter");

test("formatter block deltas include try/catch/finally semantics", () => {
	assert.equal(formatterBlockDelta("try"), 1);
	assert.equal(formatterBlockDelta("catch err"), 0);
	assert.equal(formatterBlockDelta("finally"), 0);
	assert.equal(formatterBlockDelta("end"), -1);
});

test("formatter indents try/catch/finally blocks correctly", () => {
	const source = ["try", "local x = 1", "catch err", "print(err)", "finally", "cleanup()", "end", ""].join("\n");
	const formatted = formatDocument(source, 2, true);

	const expected = [
		"try",
		"  local x = 1",
		"catch err",
		"  print(err)",
		"finally",
		"  cleanup()",
		"end",
		"",
	].join("\n");

	assert.equal(formatted, expected);
});
