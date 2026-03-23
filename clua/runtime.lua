local M = {}

local BUILTIN_TYPES = {
	["nil"] = true,
	["boolean"] = true,
	["number"] = true,
	["string"] = true,
	["table"] = true,
	["function"] = true,
	["thread"] = true,
	["userdata"] = true,
	["any"] = true,
}

local function type_error(expected, got, where)
	error(("Type mismatch at %s: expected %s, got %s"):format(where or "<unknown>", expected, got), 3)
end

local function runtime_type_name(value)
	local lua_type = type(value)
	if lua_type ~= "table" then
		return lua_type
	end

	local mt = getmetatable(value)
	if mt then
		local mt_name = rawget(mt, "__name")
		if type(mt_name) == "string" and mt_name ~= "" then
			return mt_name
		end
	end

	local value_name = rawget(value, "__name")
	if type(value_name) == "string" and value_name ~= "" then
		return value_name
	end

	return "table"
end

local function split_array_type(expected)
	local base = expected
	local depth = 0

	while type(base) == "string" and base:sub(-2) == "[]" do
		base = base:sub(1, -3)
		depth = depth + 1
	end

	return base, depth
end

local function is_array_table(value)
	if type(value) ~= "table" then
		return false
	end

	local mt = getmetatable(value)
	if mt and rawget(mt, "__name") then
		return false
	end

	for key, _ in pairs(value) do
		if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then
			return false
		end
	end

	return true
end

function M.is_instance(value, class_name)
	if type(value) ~= "table" then
		return false
	end

	local mt = getmetatable(value)
	while mt do
		if rawget(mt, "__name") == class_name then
			return true
		end
		mt = rawget(mt, "__base")
	end

	return false
end

function M.assert_type(value, expected, where)
	if not expected or expected == "" or expected == "any" then
		return value
	end

	local base_expected, array_depth = split_array_type(expected)
	if array_depth > 0 then
		if not is_array_table(value) then
			type_error(expected, runtime_type_name(value), where)
		end

		local nested_expected = base_expected .. string.rep("[]", array_depth - 1)
		for idx, item in ipairs(value) do
			M.assert_type(item, nested_expected, ("%s[%d]"):format(where or "<unknown>", idx))
		end

		return value
	end

	if BUILTIN_TYPES[base_expected] then
		local got = runtime_type_name(value)
		if got ~= base_expected then
			type_error(expected, got, where)
		end
		return value
	end

	if not M.is_instance(value, base_expected) then
		type_error(expected, runtime_type_name(value), where)
	end

	return value
end

function M.matches_type(value, expected)
	if not expected or expected == "" or expected == "any" then
		return true
	end

	local base_expected, array_depth = split_array_type(expected)
	if array_depth > 0 then
		if not is_array_table(value) then
			return false
		end

		local nested_expected = base_expected .. string.rep("[]", array_depth - 1)
		for _, item in ipairs(value) do
			if not M.matches_type(item, nested_expected) then
				return false
			end
		end
		return true
	end

	if BUILTIN_TYPES[base_expected] then
		return type(value) == base_expected
	end

	return M.is_instance(value, base_expected)
end

function M.create_class(name, base, field_types, defaults_fn)
	local class = {}
	class.__index = class
	class.__name = name
	class.__base = base
	class.__field_types = field_types or {}

	if base then
		setmetatable(class, { __index = base })
	end

	function class.new(...)
		local self = setmetatable({}, class)

		if defaults_fn then
			defaults_fn(self)
		end

		if self.init then
			self:init(...)
		end

		return self
	end

	return class
end

return M
