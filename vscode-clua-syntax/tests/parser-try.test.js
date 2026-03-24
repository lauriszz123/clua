"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildModel, getClassAtLine, getMethodAtLine } = require("../server/parser");

test("parser builds class/method model with try-catch-finally body", () => {
	const text = [
		"class Main",
		"\tfunction run()",
		"\t\ttry",
		"\t\t\tlocal x: number = 1",
		"\t\tcatch err",
		"\t\t\tprint(err)",
		"\t\tfinally",
		"\t\t\tprint(x)",
		"\t\tend",
		"\tend",
		"end",
	].join("\n");

	const model = buildModel(text);
	assert.ok(model.classes.has("Main"));

	const cls = getClassAtLine(model, 2);
	assert.ok(cls);
	assert.equal(cls.name, "Main");

	const method = getMethodAtLine(cls, 3);
	assert.ok(method);
	assert.equal(method.name, "run");
});
