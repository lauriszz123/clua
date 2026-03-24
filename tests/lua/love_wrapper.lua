#!/usr/bin/env lua

package.path = "./?.lua;./?/init.lua;" .. package.path

local testlib = require("tests.lua.testlib")

testlib.setup_package_path()

require("clua")

local function test(name, fn)
	local ok, err = pcall(fn)
	if ok then
		print("PASS " .. name)
		return true
	end
	print("FAIL " .. name .. ": " .. tostring(err))
	return false
end

local passed = 0
local total = 0

total = total + 1
if
	test("binds Love callbacks from Main class", function()
		local Main = assert(require("clua").loadstring([[class Main extends Love
	function new()
		self.loaded = false
		self.dt = 0
	end

	function load()
		self.loaded = true
	end

	function update(dt: number)
		self.dt = dt
	end
end]]))()

		local fake_love = {}
		local bridge = require("clua.love")
		local app = bridge.bind(Main, { love = fake_love })

		assert(app ~= nil, "bind should return Main instance")
		assert(type(fake_love.load) == "function", "love.load callback should be bound")
		assert(type(fake_love.update) == "function", "love.update callback should be bound")

		fake_love.load()
		assert(app.loaded == true, "load callback should call instance method")

		fake_love.update(0.25)
		assert(app.dt == 0.25, "update callback should pass arguments")
	end)
then
	passed = passed + 1
end

total = total + 1
if
	test("bind only exposes implemented callbacks", function()
		local Main = assert(require("clua").loadstring([[class Main extends Love
	function new()
		self.drawn = false
	end

	function draw()
		self.drawn = true
	end
end]]))()

		local fake_love = {}
		local bridge = require("clua.love")
		local app = bridge.bind(Main, { love = fake_love })

		assert(type(fake_love.draw) == "function")
		assert(fake_love.update == nil)
		fake_love.draw()
		assert(app.drawn == true)
	end)
then
	passed = passed + 1
end

print(("%d/%d tests passed"):format(passed, total))
return passed == total
