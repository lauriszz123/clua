"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { LUA_GLOBALS, LUA_LIBS } = require("../server/lua-stdlib");
const { LOVE_FUNCTIONS } = require("../server/love-api");

test("lua stdlib globals include normalized typed params", () => {
  const print = LUA_GLOBALS.print;
  assert.ok(print);
  assert.equal(print.params[0].name, "...");
  assert.equal(print.params[0].typeName, "...any");
  assert.equal(print.params[0].doc.length > 0, true);
  assert.ok(print.params[0].type);
});

test("lua stdlib library methods include normalized typed params", () => {
  const find = LUA_LIBS.string.find;
  assert.ok(find);
  assert.equal(find.params[0].typeName, "string");
  assert.equal(find.params[3].typeName, "boolean?");
});

test("love api entries include normalized typed params", () => {
  const draw = LOVE_FUNCTIONS["love.graphics.draw"];
  assert.ok(draw);
  assert.equal(draw.params[0].typeName, "Drawable");
  assert.equal(draw.params[1].typeName, "number?");
  assert.equal(draw.params[9].typeName, "number?");
});