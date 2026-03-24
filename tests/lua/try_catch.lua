#!/usr/bin/env lua

package.path = "./?.lua;./?/init.lua;" .. package.path

local testlib = require("tests.lua.testlib")

testlib.setup_package_path()

local compiler = require("clua.compiler")
local clua = require("clua")

local passed = 0
local failed = 0

local function test(name, fn)
	local ok, err = pcall(fn)
	if ok then
		print("PASS " .. name)
		passed = passed + 1
	else
		print("FAIL " .. name .. ": " .. tostring(err))
		failed = failed + 1
	end
end

test("try catch returns fallback value", function()
	local chunk, err = clua.loadstring(
		[[class App
	function new()
	end

	function run(): string
		try
			error("boom")
		catch err
			return "handled: " .. tostring(err)
		end
	end
end]],
		"@try_test.clua"
	)
	assert(chunk, err)
	local App = chunk()
	local app = App.new()
	local result = app.run()
	assert(type(result) == "string")
	assert(result:find("handled:", 1, true) ~= nil)
	assert(result:find("boom", 1, true) ~= nil)
end)

test("compiler lowers try catch to pcall", function()
	local lua = compiler.compile(
		[[function demo()
	try
		return 1
	catch err
		return 2
	end
end]],
		"@lowering_test.clua"
	)
	assert(lua:find("pcall%(function%(") ~= nil, "expected pcall lowering")
	assert(lua:find("local err = ") ~= nil, "expected catch binding")
end)

test("finally runs after catch handling", function()
	local chunk, err = clua.loadstring(
		[[class App
	function new()
		self.trace = ""
	end

	function run(): string
		try
			error("boom")
		catch err
			self.trace = self.trace .. "catch|"
		finally
			self.trace = self.trace .. "finally"
		end

		return self.trace
	end
end]],
		"@finally_catch_test.clua"
	)
	assert(chunk, err)
	local App = chunk()
	local app = App.new()
	assert(app.run() == "catch|finally")
end)

test("finally runs without catch and rethrows", function()
	local chunk, err = clua.loadstring(
		[[class App
	function new()
		self.cleaned = false
	end

	function run()
		try
			error("boom")
		finally
			self.cleaned = true
		end
	end
end]],
		"@finally_rethrow_test.clua"
	)
	assert(chunk, err)
	local App = chunk()
	local app = App.new()
	local ok, run_err = pcall(function()
		app.run()
	end)
	assert(not ok)
	assert(tostring(run_err):find("boom", 1, true) ~= nil)
	assert(app.cleaned == true)
end)

test("finally runs after successful return", function()
	local chunk, err = clua.loadstring(
		[[class App
	function new()
		self.trace = ""
	end

	function run(): string
		try
			self.trace = self.trace .. "body|"
			return "ok"
		finally
			self.trace = self.trace .. "finally"
		end
	end
end]],
		"@finally_success_test.clua"
	)
	assert(chunk, err)
	local App = chunk()
	local app = App.new()
	assert(app.run() == "ok")
	assert(app.trace == "body|finally")
end)

print(("%d passed, %d failed"):format(passed, failed))
return failed == 0
