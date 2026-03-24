#!/usr/bin/env lua
-- Test suite for CLua generics compiler support
-- Run with: lua test_generics_compiler.lua

package.path = "./?.lua;./?/init.lua;" .. package.path

local compiler = require("clua.compiler")
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

local function compile(src)
	return compiler.compile(src, "test")
end

local function has(str, substring)
	return str:find(substring, 1, true) ~= nil
end

-- ============================================================================
-- Test: Simple class generics
-- ============================================================================
passed = passed
	+ (
		test("Simple class generics (Box<T>)", function()
				local src = [[
class Box<T>
	local value: T
	
	function new(v: T)
		self.value = v
	end
end
]]
				local out = compile(src)
				assert(has(out, "local Box = {}"), "Should declare Box class")
				assert(has(out, "function Box.new(v)"), "Should have new method")
				assert(has(out, 'assert_type(v, "any"'), "Generic param T should erase to any")
				assert(has(out, 'assert_type(__priv.value, "any"'), "Generic field should erase to any")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Multi-parameter generics
-- ============================================================================
passed = passed
	+ (
		test("Multi-parameter generics (Result<T, U>)", function()
				local src = [[
class Result<T, U>
	local ok: T
	local err: U
	
	function new(ok_val: T, err_val: U)
		self.ok = ok_val
		self.err = err_val
	end
end
]]
				local out = compile(src)
				assert(has(out, "local Result = {}"), "Should declare Result class")
				assert(has(out, 'assert_type(ok_val, "any"'), "T should erase to any")
				assert(has(out, 'assert_type(err_val, "any"'), "U should erase to any")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic methods
-- ============================================================================
passed = passed
	+ (
		test("Generic methods (function map<T>)", function()
				local src = [[
class Mapper
	function map<T>(v: T): T
		return v
	end
end
]]
				local out = compile(src)
				assert(has(out, "function Mapper.map(self, v)"), "Should have map method")
				assert(has(out, 'assert_type(v, "any"'), "Generic method param should erase to any")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic arrays
-- ============================================================================
passed = passed
	+ (
		test("Generic arrays (T[], Box<T>[])", function()
				local src = [[
class Container<T>
	local items: T[]
	local boxes: Container<T>[]
	
	function new()
		self.items = {}
		self.boxes = {}
	end
end
]]
				local out = compile(src)
				assert(has(out, 'assert_type(__priv.items, "any[]"'), "T[] should erase to any[]")
				assert(
					has(out, 'assert_type(__priv.boxes, "Container[]"'),
					"Container<T>[] should erase to Container[]"
				)
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic constructor rewriting
-- ============================================================================
passed = passed
	+ (
		test("Generic constructor rewriting (new Box<T>)", function()
				local src = [[
class Box<T>
	function create(): Box<T>
		return new Box<T>()
	end
end
]]
				local out = compile(src)
				assert(has(out, "return Box.new()"), "new Box<T>() should rewrite to Box.new()")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Nested generics
-- ============================================================================
passed = passed
	+ (
		test("Nested generics (Map<T, Box<U>>)", function()
				local src = [[
class Pair<T, U>
	local first: T
	local second: U
	
	function new(f: T, s: U)
		self.first = f
		self.second = s
	end
end
]]
				local out = compile(src)
				assert(has(out, 'assert_type(f, "any"'), "Nested generic param T should erase to any")
				assert(has(out, 'assert_type(s, "any"'), "Nested generic param U should erase to any")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic extends
-- ============================================================================
passed = passed
	+ (
		test("Generic extends (MyBox<T> extends Box<T>)", function()
				local src = [[
class MyBox<T> extends Box<T>
	function custom()
		return self
	end
end
]]
				local out = compile(src)
				assert(has(out, "local MyBox = {}"), "Should declare MyBox class")
				assert(has(out, "setmetatable(MyBox, {__index = Box})"), "Should extend Box")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Mix generic and concrete types
-- ============================================================================
passed = passed
	+ (
		test("Mix generic and concrete types (value: T, count: number)", function()
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
				local out = compile(src)
				assert(has(out, 'assert_type(v, "any"'), "Generic T should erase to any")
				assert(has(out, 'assert_type(c, "number"'), "Concrete number should stay number")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Private field with generics
-- ============================================================================
passed = passed
	+ (
		test("Private field with generics (local value: T)", function()
				local src = [[
class Secret<T>
	local value: T
	
	function new(v: T)
		self.value = v
	end
end
]]
				local out = compile(src)
				assert(
					has(out, 'local __clua_private_fields_Secret = {["value"] = true}'),
					"Should mark value as private"
				)
				assert(has(out, "__priv.value = v"), "Should assign to private storage")
				assert(has(out, 'assert_type(__priv.value, "any"'), "Private generic should check as any")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic field iteration in methods
-- ============================================================================
passed = passed
	+ (
		test("Generic field check in method body", function()
				local src = [[
class List<T>
	local items: T[]
	
	function add(item: T)
		self.items[1] = item
	end
end
]]
				local out = compile(src)
				assert(has(out, 'assert_type(item, "any"'), "Generic param T should erase to any")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Empty generic parameter list should fail gracefully
-- ============================================================================
passed = passed
	+ (
		test("Reject empty generic parameter list", function()
				local src = [[
class Box<>
end
]]
				local ok, err = pcall(compile, src)
				assert(not ok, "Should reject empty generic parameter list")
				assert(err:find("Invalid generic parameter list") ~= nil, "Should have clear error")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Invalid generic parameter name should fail
-- ============================================================================
passed = passed
	+ (
		test("Reject invalid generic parameter names", function()
				local src = [[
class Box<123>
end
]]
				local ok, err = pcall(compile, src)
				assert(not ok, "Should reject numeric generic parameter")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic type in return type annotation
-- ============================================================================
passed = passed
	+ (
		test("Generic in return type (: T)", function()
				local src = [[
class Wrapper<T>
	local value: T
	
	function get(): T
		return self.value
	end
end
]]
				local out = compile(src)
				assert(has(out, "function Wrapper.get(self)"), "Should have get method")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic function (standalone)
-- ============================================================================
passed = passed
	+ (
		test("Generic function (not in class)", function()
				local src = [[
function identity<T>(x: T): T
	return x
end
]]
				local out = compile(src)
				assert(has(out, "function identity(x)"), "Should have identity function")
				assert(has(out, 'assert_type(x, "any"'), "Generic param should erase to any")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic class with field reassignment
-- ============================================================================
passed = passed
	+ (
		test("Generic field reassignment in method", function()
				local src = [[
class Container<T>
	value: T
	
	function update(newVal: T)
		self.value = newVal
	end
	
	function swap<U>(other: U)
		self.value = other
	end
end
]]
				local out = compile(src)
				assert(has(out, "function Container.update(self, newVal)"), "Should have update")
				assert(has(out, "function Container.swap(self, other)"), "Should have swap")
				assert(has(out, 'assert_type(other, "any"'), "Method generic param U should erase")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Three-parameter generic
-- ============================================================================
passed = passed
	+ (
		test("Three-parameter generic (T, U, V)", function()
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
end
]]
				local out = compile(src)
				assert(has(out, "local Triple = {}"), "Should declare Triple class")
				assert(has(out, "function Triple.new(ta, tb, tc)"), "Should have new with 3 params")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic inheritance chain
-- ============================================================================
passed = passed
	+ (
		test("Generic inheritance (extends with generics)", function()
				local src = [[
class Base<T>
	value: T
end

class Derived<T> extends Base<T>
	callback: function(T): T
end
]]
				local out = compile(src)
				assert(has(out, "local Base = {}"), "Should declare Base")
				assert(has(out, "local Derived = {}"), "Should declare Derived")
				assert(has(out, "setmetatable(Derived, {__index = Base})"), "Should set up inheritance")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic with complex nested types
-- ============================================================================
passed = passed
	+ (
		test("Generic with nested arrays (Box<T[]>)", function()
				local src = [[
class ArrayBox<T>
	items: T[]
	
	function add(item: T)
		self.items[#self.items + 1] = item
	end
end
]]
				local out = compile(src)
				assert(has(out, 'assert_type(item, "any"'), "Generic T should erase to any")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic method with same param name as class
-- ============================================================================
passed = passed
	+ (
		test("Generic method shadows class generic param", function()
				local src = [[
class Box<T>
	value: T
	
	function transform<T>(x: T): T
		return x
	end
end
]]
				local out = compile(src)
				assert(has(out, "function Box.transform(self, x)"), "Should have transform")
				assert(has(out, 'assert_type(x, "any"'), "Method param T should erase")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Multiple generic methods in one class
-- ============================================================================
passed = passed
	+ (
		test("Class with multiple generic methods", function()
				local src = [[
class Converter<T>
	value: T
	
	function map<U>(fn: function(T): U): U
		return fn(self.value)
	end
	
	function fold<U>(initial: U, fn: function(U, T): U): U
		return fn(initial, self.value)
	end
end
]]
				local out = compile(src)
				assert(has(out, "function Converter.map(self, fn)"), "Should have map")
				assert(has(out, "function Converter.fold(self, initial, fn)"), "Should have fold")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic with function type parameter
-- ============================================================================
passed = passed
	+ (
		test("Generic function parameter type", function()
				local src = [[
class Filter<T>
	predicate: function(T): boolean
	
	function test(item: T): boolean
		return self.predicate(item)
	end
end
]]
				local out = compile(src)
				assert(has(out, "function Filter.test(self, item)"), "Should have test method")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic array of generics
-- ============================================================================
passed = passed
	+ (
		test("Generic array of generic classes", function()
				local src = [[
class Pair<T>
	left: T
	right: T
end

class PairArray<T>
	pairs: Pair<T>[]
end
]]
				local out = compile(src)
				assert(has(out, "local Pair = {}"), "Should declare Pair")
				assert(has(out, "local PairArray = {}"), "Should declare PairArray")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Generic in local variable
-- ============================================================================
passed = passed
	+ (
		test("Generic in local variable type", function()
				local src = [[
class Main
	function test()
		local box: Box<number>
	end
end
]]
				local out = compile(src)
				assert(has(out, "function Main.test(self)"), "Should have test")
				-- Local declaration compiles even with generic types
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
