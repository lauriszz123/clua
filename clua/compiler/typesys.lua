-- Type-system helpers: validation, erasure, generic parameter handling.

local util = require("clua.compiler.util")

local trim = util.trim
local split_top_level_commas = util.split_top_level_commas

local M = {}

local function normalize_type_name(type_name)
	if not type_name then
		return nil
	end
	local normalized = trim(type_name):gsub("%s+", "")
	if normalized == "" then
		return nil
	end
	return normalized
end

local function strip_array_suffix(type_name)
	local base = type_name
	local depth = 0
	while base:sub(-2) == "[]" do
		base = base:sub(1, -3)
		depth = depth + 1
	end
	return base, depth
end

local function erase_generic_arguments(type_name)
	local normalized = normalize_type_name(type_name)
	if not normalized then
		return normalized
	end

	local out = {}
	local depth = 0
	for i = 1, #normalized do
		local ch = normalized:sub(i, i)
		if ch == "<" then
			depth = depth + 1
		elseif ch == ">" then
			depth = depth - 1
		else
			if depth == 0 then
				out[#out + 1] = ch
			end
		end
	end

	return table.concat(out)
end

local function get_array_base_type(type_name)
	local base = normalize_type_name(type_name)
	if not base then
		return nil
	end

	while base:sub(-2) == "[]" do
		base = base:sub(1, -3)
	end

	if base:match("^function%b()") then
		return "function"
	end

	return erase_generic_arguments(base)
end

local validate_type_name

local function validate_function_type(core)
	local params_blob, return_type = core:match("^function(%b())%s*:%s*(.+)$")
	if not params_blob then
		params_blob = core:match("^function(%b())$")
	end

	if not params_blob then
		return false, nil
	end

	local params_inner = params_blob:sub(2, -2)
	if params_inner ~= "" then
		local params = split_top_level_commas(params_inner)
		if not params then
			return false, nil
		end

		for _, param_type in ipairs(params) do
			local normalized_param = trim(param_type)
			if normalized_param == "" then
				return false, nil
			end

			-- Support named function-type params, e.g. function(item: T)
			local _, named_param_type = normalized_param:match("^([%a_][%w_]*)%s*:%s*(.-)%s*$")
			if named_param_type and named_param_type ~= "" then
				normalized_param = named_param_type
			end

			local ok = validate_type_name(normalized_param)
			if not ok then
				return false, nil
			end
		end
	end

	if return_type and trim(return_type) ~= "" then
		local ok = validate_type_name(return_type)
		if not ok then
			return false, nil
		end
	end

	return true, "function"
end

local function validate_type_core(core)
	if core:match("^function%b()") then
		return validate_function_type(core)
	end

	if core:match("^[%a_][%w_%.]*$") then
		return true, core
	end

	local base, args_blob = core:match("^([%a_][%w_%.]*)<(.*)>$")
	if not base then
		return false, nil
	end

	if args_blob == "" then
		return false, nil
	end

	local args = split_top_level_commas(args_blob)
	if not args or #args == 0 then
		return false, nil
	end

	for _, arg in ipairs(args) do
		if arg == "" then
			return false, nil
		end
		local ok = validate_type_name(arg)
		if not ok then
			return false, nil
		end
	end

	return true, base
end

validate_type_name = function(type_name)
	local normalized = normalize_type_name(type_name)
	if not normalized then
		return false, nil
	end

	local base, depth = strip_array_suffix(normalized)
	local ok, erased_core = validate_type_core(base)
	if not ok then
		return false, nil
	end

	return true, erased_core .. string.rep("[]", depth)
end

local function erase_generic_type(type_name)
	local ok, erased = validate_type_name(type_name)
	if not ok then
		return nil
	end
	return erased
end

local function parse_generic_param_list(generic_capture, line_no)
	if not generic_capture or generic_capture == "" then
		return {}
	end

	local inner = generic_capture:sub(2, -2)
	if trim(inner) == "" then
		error(("Invalid generic parameter list at line %d"):format(line_no))
	end

	local names = split_top_level_commas(inner)
	if not names then
		error(("Invalid generic parameter list at line %d"):format(line_no))
	end

	for _, name in ipairs(names) do
		if not name:match("^[%a_][%w_]*$") then
			error(("Invalid generic type parameter '%s' at line %d"):format(name, line_no))
		end
	end

	return names
end

local function parse_generic_param_map(generic_capture, line_no)
	local map = {}
	local names = parse_generic_param_list(generic_capture, line_no)

	for _, name in ipairs(names) do
		map[name] = true
	end

	return map
end

local function merge_generic_param_maps(a, b)
	local out = {}
	for name, _ in pairs(a or {}) do
		out[name] = true
	end
	for name, _ in pairs(b or {}) do
		out[name] = true
	end
	return out
end

local function erase_type_for_runtime(type_name, generic_params)
	local erased = erase_generic_type(type_name)
	if not erased then
		return nil
	end

	local base, depth = strip_array_suffix(erased)
	if generic_params and generic_params[base] then
		base = "any"
	end

	return base .. string.rep("[]", depth)
end

M.normalize_type_name = normalize_type_name
M.strip_array_suffix = strip_array_suffix
M.erase_generic_arguments = erase_generic_arguments
M.get_array_base_type = get_array_base_type
M.validate_type_name = validate_type_name
M.erase_generic_type = erase_generic_type
M.parse_generic_param_list = parse_generic_param_list
M.parse_generic_param_map = parse_generic_param_map
M.merge_generic_param_maps = merge_generic_param_maps
M.erase_type_for_runtime = erase_type_for_runtime

return M
