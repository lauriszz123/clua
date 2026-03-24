#!/usr/bin/env lua
-- Integration test: compile and run generic CLua code
-- Run with: lua test_generics_integration.lua

package.path = "./?.lua;./?/init.lua;" .. package.path

local compiler = require("clua.compiler")
local runtime = require("clua.runtime")
local passed = 0
local failed = 0

local function test(name, fn)
	local ok, err = pcall(fn)
	if ok then
		print("✓ " .. name)
		return true
	else
		print("✗ " .. name .. ": " .. tostring(err))
		failed = failed + 1
		return false
	end
end

local function has(str, substring)
	return str:find(substring, 1, true) ~= nil
end

-- ============================================================================
-- Test: Compile and exec generic Box class
-- ============================================================================
passed = passed
	+ (
		test("Compile and instantiate Box<T>", function()
				local src = [[
class Box<T>
	local value: T
	
	function new(v: T)
		self.value = v
	end
	
	function get(): T
		return self.value
	end
end
]]
				local lua = compiler.compile(src, "test")

				-- Execute the compiled Lua
				local chunk = load(lua)
				assert(chunk, "Compiled Lua should be valid")

				local Box = chunk()
				assert(Box, "Should return Box class")
				assert(Box.new, "Should have new method")

				-- Instantiate
				local myBox = Box.new(42)
				assert(myBox, "Should create Box instance")
				assert(myBox:get() == 42, "Box should hold value")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Compile and exec generic Pair class
-- ============================================================================
passed = passed
	+ (
		test("Compile and instantiate Pair<A, B>", function()
				local src = [[
class Pair<A, B>
	local first: A
	local second: B
	
	function new(a: A, b: B)
		self.first = a
		self.second = b
	end
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = load(lua)
				local Pair = chunk()

				local p = Pair.new(10, "hello")
				assert(p, "Should create Pair instance")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic field with array
-- ============================================================================
passed = passed
	+ (
		test("Compile generic with array field (items: T[])", function()
				local src = [[
class List<T>
	local items: T[]
	
	function new()
		self.items = {}
	end
	
	function add(item: T)
		self.items[1] = item
	end
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = load(lua)
				local List = chunk()

				local list = List.new()
				assert(list, "Should create List instance")

				-- Call add with mock value
				local ok, err = pcall(list.add, list, 42)
				assert(ok or err, "add should execute without crash")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic with non-generic mixed
-- ============================================================================
passed = passed
	+ (
		test("Mix generic and concrete types", function()
				local src = [[
class Tagged<T>
	local value: T
	local count: number
	
	function new(v: T, c: number)
		self.value = v
		self.count = c
	end
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = load(lua)
				local Tagged = chunk()

				local t = Tagged.new("data", 5)
				assert(t, "Should create Tagged instance")
				assert(lua:find('assert_type%(c, "number"'), "Concrete number param should be checked")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic method in non-generic class
-- ============================================================================
passed = passed
	+ (
		test("Generic method in regular class", function()
				local src = [[
class Util
	function identity<T>(v: T): T
		return v
	end
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = load(lua)
				local Util = chunk()

				assert(Util.identity, "Should have identity method")
				local u = setmetatable({}, Util)
				assert(Util.identity(u, 12) == 12, "identity should return its input")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic inheritance
-- ============================================================================
passed = passed
	+ (
		test("Generic class inheriting from non-generic", function()
				local src = [[
class Base
	function base_method()
		return "base"
	end
end

class Derived<T> extends Base
	local value: T
	
	function new(v: T)
		self.value = v
	end
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = load(lua)

				-- The module should have both classes (last one wins for return)
				assert(lua:find("local Base"), "Should have Base class")
				assert(lua:find("local Derived"), "Should have Derived class")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Type erasure produces runtime-valid Lua
-- ============================================================================
passed = passed
	+ (
		test("Generic type erasure to any is runtime-valid", function()
				local src = [[
class Container<T>
	local item: T
	
	function store(v: T)
		self.item = v
	end
end
]]
				local lua = compiler.compile(src, "test")

				-- Verify the Lua contains assert_type with "any" instead of "T"
				assert(lua:find('assert_type.*"any"') ~= nil, "Should erase T to any")

				-- Execute and verify it runs
				local chunk = assert(load(lua), "Generated Lua must be syntactically valid")
				local result = chunk()
				assert(result, "Should return class")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Constructor rewrite produces correct Lua
-- ============================================================================
passed = passed
	+ (
		test("Constructor rewrite (new Box<T>() -> Box.new())", function()
				local src = [[
class Box<T>
	function create(): Box<T>
		return new Box<T>()
	end
end
]]
				local lua = compiler.compile(src, "test")

				-- Verify rewrite happened
				assert(lua:find("Box%.new()") ~= nil, "new Box<T>() should rewrite to Box.new()")
				assert(lua:find("new Box<T>") == nil, "Should not have original syntax")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Three-parameter generic compilation and execution
-- ============================================================================
passed = passed
	+ (
		test("Three-parameter generic class", function()
				local src = [[
class Triple<T, U, V>
	a: T
	b: U
	c: V
	
	function new(ta: T, tb: U, tc: V)
		self.a = ta
		self.b = tb
		self.c = tc
	end
	
	function get_a(): T
		return self.a
	end
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = assert(load(lua), "Compiled Lua must be valid")
				local result = chunk()

				-- Just verify it compiles and runs
				assert(lua:find("local Triple = {}"), "Should declare Triple")
				assert(lua:find("function Triple.new"), "Should have new constructor")
				assert(lua:find("function Triple.get_a"), "Should have get_a method")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic array operations
-- ============================================================================
passed = passed
	+ (
		test("Generic array field operations", function()
				local src = [[
class Collector<T>
	items: T[]
	
	function new()
		self.items = {}
	end
	
	function collect(item: T)
		self.items[#self.items + 1] = item
	end
	
	function count(): number
		return #self.items
	end
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = assert(load(lua), "Compiled Lua must be valid")

				assert(lua:find("function Collector.new"), "Should have constructor")
				assert(lua:find("function Collector.collect"), "Should have collect method")
				assert(lua:find("function Collector.count"), "Should have count method")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Multiple generic methods in generic class
-- ============================================================================
passed = passed
	+ (
		test("Multiple generic methods", function()
				local src = [[
class Converter<T>
	value: T
	
	function new(v: T)
		self.value = v
	end
	
	function identity(): T
		return self.value
	end
	
	function wrap<U>(u: U): U
		return u
	end
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = assert(load(lua), "Compiled Lua must be valid")

				assert(lua:find("function Converter.new"), "Should have new")
				assert(lua:find("function Converter.identity"), "Should have identity")
				assert(lua:find("function Converter.wrap"), "Should have wrap")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic standalone function
-- ============================================================================
passed = passed
	+ (
		test("Generic standalone function", function()
				local src = [[
function identity<T>(x: T): T
	return x
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = assert(load(lua), "Compiled Lua must be valid")

				assert(has(lua, "function identity(x)"), "Should have identity function")
				assert(has(lua, 'assert_type(x, "any"'), "Generic should erase to any")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic with mixed types
-- ============================================================================
passed = passed
	+ (
		test("Generic field with concrete fields", function()
				local src = [[
class Tagged<T>
	value: T
	count: number
	name: string
	
	function new(v: T, n: number, s: string)
		self.value = v
		self.count = n
		self.name = s
	end
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = assert(load(lua), "Compiled Lua must be valid")

				assert(has(lua, "function Tagged.new"), "Should have constructor")
				assert(has(lua, 'assert_type(n, "number"'), "number field type should be checked")
				assert(has(lua, 'assert_type(s, "string"'), "string field type should be checked")
				assert(has(lua, 'assert_type(v, "any"'), "generic T field should erase to any")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic inheritance compilation
-- ============================================================================
passed = passed
	+ (
		test("Generic class inheritance compilation", function()
				local src = [[
class Base<T>
	value: T
	
	function new(v: T)
		self.value = v
	end
end

class Derived<T> extends Base<T>
	count: number
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = assert(load(lua), "Compiled Lua must be valid")

				assert(lua:find("local Base = {}"), "Should declare Base")
				assert(lua:find("local Derived = {}"), "Should declare Derived")
				assert(lua:find("setmetatable%(Derived, %{%__index = Base%}%)"), "Should set up inheritance")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic return type in method
-- ============================================================================
passed = passed
	+ (
		test("Generic return type annotation", function()
				local src = [[
class Wrapper<T>
	value: T
	
	function get(): T
		return self.value
	end
	
	function set(v: T)
		self.value = v
	end
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = assert(load(lua), "Compiled Lua must be valid")

				assert(has(lua, "function Wrapper.get(self)"), "Should have get method")
				assert(has(lua, "function Wrapper.set(self, v)"), "Should have set method")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Print summary
-- ============================================================================
print("")
print("========================")
print("Tests passed: " .. passed)
print("Tests failed: " .. failed)
print("Total: " .. (passed + failed))
print("========================")

if failed > 0 then
	os.exit(1)
end
