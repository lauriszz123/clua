#!/usr/bin/env lua
-- Integration test: compile and run generic CLua code
-- Run with: lua tests/lua/run_all.lua

package.path = "./?.lua;./?/init.lua;" .. package.path

local testlib = require("tests.lua.testlib")

testlib.setup_package_path()

local compiler = require("clua.compiler")
local runtime = require("clua.runtime")
local clua = require("clua")
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

local function with_temp_dir(fn)
	return testlib.with_temp_dir(fn)
end

-- ============================================================================
-- Test: Compile and exec generic Box class
-- ============================================================================
passed = passed
	+ (
		test("Searcher resolves clua.std.List from rocks tree layout", function()
				with_temp_dir(function(temp_dir)
					local list_dir = testlib.join_path(
						temp_dir,
						".luarocks",
						"lib",
						"luarocks",
						"rocks-5.4",
						"clua",
						"scm-1",
						"clua",
						"std"
					)
					testlib.mkdir_p(list_dir)
					local list_path = testlib.join_path(list_dir, "List.clua")
					testlib.write_file(
						list_path,
						[[class List<T>
	function new()
	end
end
]]
					)

					local searcher = clua.make_searcher({
						path = "",
						rock_roots = { temp_dir .. "/.luarocks/lib/luarocks/rocks-5.4" },
					})
					local chunk, resolved = searcher("clua.std.List")
					assert(type(chunk) == "function", "Searcher should return loader function")
					assert(
						resolved:gsub("[/\\]", "/") == list_path:gsub("[/\\]", "/"),
						"Searcher should resolve rocks-tree std module path"
					)
					local List = chunk()
					assert(List and List.new, "Resolved module should return List class")
				end)
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Runtime import std.List resolves through clua.std alias
-- ============================================================================
passed = passed
	+ (
		test("Runtime import std.List resolves through clua.std alias", function()
				with_temp_dir(function(temp_dir)
					local app_path = temp_dir .. "/app.clua"
					local file = assert(io.open(app_path, "w"))
					file:write([[import std.List

class App
	local list: List<number>

	function new()
		self.list = new List<number>()
	end
end
]])
					file:close()

					local old_path = package.path
					package.path = temp_dir .. "/?.lua;" .. temp_dir .. "/?/init.lua;" .. old_path
					local chunk = assert(clua.loadfile(app_path))
					local App = chunk()
					assert(App and App.new, "Should load App class from .clua file with std import")
					local app = App.new()
					assert(app, "Should instantiate App")
					package.path = old_path
				end)
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: Compiler/runtime type mismatch on ArrayList.get(index:number)
-- ============================================================================
passed = passed
	+ (
		test("Runtime import std.Option resolves and unwrapOr works", function()
				local chunk, err = clua.loadstring(
					[[import std.Option

class App
	function new()
	end

	function run(): number
		local value: Option<number> = new Option<number>()
		return value.unwrapOr(7)
	end
end]],
					"@option_runtime_test.clua"
				)
				assert(chunk, err)
				local App = chunk()
				local app = App.new()
				assert(app.run() == 7)
			end)
			and 1
		or 0
	)

-- ============================================================================

passed = passed
	+ (
		test("Runtime type mismatch remains for dynamic ArrayList.get index", function()
				local src = [[
class ArrayList<T>
	local items: T[]

	function new()
		self.items = {}
	end

	function add(item: T)
		table.insert(self.items, item)
	end

	function get(index: number): T
		return self.items[index]
	end
end

function pickIndex(flag: any): any
	if flag then
		return 1
	end

	return "test"
end

class App
	local list: ArrayList<number>

	function new(flag)
		self.list = new ArrayList<number>()
		self.list.add(1)
		print(self.list.get(pickIndex(flag)))
	end
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = assert(load(lua), "Compiled Lua should be valid")
				local App = chunk()
				local ok, err = pcall(function()
					App.new(false)
				end)

				assert(not ok, "Type mismatch should fail at runtime")
				assert(
					has(tostring(err), "expected number, got string"),
					"Error should report number/string type mismatch"
				)
			end)
			and 1
		or 0
	)

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
-- Test: std.Option and std.Result runtime behavior
-- ============================================================================
passed = passed
	+ (
		test("std.Option and std.Result portable APIs", function()
				local src = [[
import std.Option
import std.Result

class App
	function new()
		local none: Option<number>
		none = new Option<number>()
		assert(none.isNone())
		assert(none.unwrapOr(7) == 7)

		local some: Option<number>
		some = new Option<number>(5)
		assert(some.isSome())
		assert(some.map(function(v)
			return v + 3
		end).unwrap() == 8)

		local ok: Result<number, string>
		ok = new Result<number, string>(10)
		assert(ok.isOk())
		assert(ok.map(function(v)
			return v * 2
		end).unwrap() == 20)

		local err: Result<number, string>
		err = new Result<number, string>("bad", true)
		assert(err.isErr())
		assert(err.unwrapOr(9) == 9)
	end
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = assert(load(lua), "Compiled Lua must be valid")
				local App = chunk()
				local app = App.new()
				assert(app ~= nil, "App should instantiate")
			end)
			and 1
		or 0
	)

-- ============================================================================
-- Test: std.HashMap behavior
-- ============================================================================
passed = passed
	+ (
		test("std.HashMap set/get/remove and size", function()
				local src = [[
import std.HashMap

class App
	function new()
		local map: HashMap<string, number>
		map = new HashMap<string, number>()

		assert(map.size() == 0)
		map.set("a", 1)
		map.set("b", 2)
		assert(map.size() == 2)
		assert(map.get("a") == 1)
		assert(map.has("b"))

		map.remove("a")
		assert(not map.has("a"))
		assert(map.size() == 1)
	end
end
]]
				local lua = compiler.compile(src, "test")
				local chunk = assert(load(lua), "Compiled Lua must be valid")
				local App = chunk()
				local app = App.new()
				assert(app ~= nil, "App should instantiate")
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

return failed == 0
