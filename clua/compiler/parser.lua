-- Parsing primitives: function signatures, block boundaries, params, fields.

local util = require("clua.compiler.util")
local typesys = require("clua.compiler.typesys")

local trim = util.trim
local split_top_level_commas = util.split_top_level_commas
local erase_type_for_runtime = typesys.erase_type_for_runtime

local M = {}

local function block_delta(line)
	local text = line:gsub("%-%-.*$", "")
	-- Do not treat function type annotations (e.g. function(): T) as block starters.
	text = text:gsub(":%s*function%s*%(", ": __fn_type__(")

	-- `elseif ... then` closes the previous branch and opens a new one, net depth 0.
	if text:match("^%s*elseif%b()%s*then") or text:match("^%s*elseif%s+.-%s+then%s*$") then
		return 0
	end

	local delta = 0

	for token in text:gmatch("%f[%a]([%a_]+)%f[%A]") do
		if token == "function" or token == "then" or token == "do" or token == "repeat" then
			delta = delta + 1
		elseif token == "end" or token == "until" then
			delta = delta - 1
		end
	end

	return delta
end

local function find_block_end(lines, start_idx)
	local depth = 1
	for i = start_idx + 1, #lines do
		depth = depth + block_delta(lines[i])
		if depth == 0 then
			return i
		end
	end

	error(("Unclosed block starting at line %d"):format(start_idx))
end

local function parse_function_signature(signature)
	local is_local = false
	local function_name, generic_capture, params_start =
		signature:match("^%s*local%s+function%s+([%a_][%w_]*)(%b<>)%s*()%(.*$")

	if function_name then
		is_local = true
	else
		function_name, generic_capture, params_start =
			signature:match("^%s*function%s+([%a_][%w_]*)(%b<>)%s*()%(.*$")
	end

	if not function_name then
		function_name, params_start = signature:match("^%s*local%s+function%s+([%a_][%w_]*)%s*()%(.*$")
		if function_name then
			is_local = true
		else
			function_name, params_start = signature:match("^%s*function%s+([%a_][%w_]*)%s*()%(.*$")
		end
	end

	if not function_name or not params_start then
		return nil
	end

	local depth = 0
	local params_end = nil
	for i = params_start, #signature do
		local ch = signature:sub(i, i)
		if ch == "(" then
			depth = depth + 1
		elseif ch == ")" then
			depth = depth - 1
			if depth == 0 then
				params_end = i
				break
			elseif depth < 0 then
				return nil
			end
		end
	end

	if not params_end then
		return nil
	end

	local params_raw = signature:sub(params_start + 1, params_end - 1)
	local tail = trim(signature:sub(params_end + 1))
	local has_return_annotation = false
	if tail ~= "" then
		if not tail:match("^:%s*.+$") then
			return nil
		end
		has_return_annotation = true
	end

	return {
		is_local = is_local,
		name = function_name,
		generic_capture = generic_capture,
		params_raw = params_raw,
		has_return_annotation = has_return_annotation,
	}
end

local function parse_params(params_raw, generic_params)
	local clean = {}
	local typed = {}

	local raw = trim(params_raw)
	if raw == "" then
		return clean, typed
	end

	local tokens = split_top_level_commas(raw)
	if not tokens then
		error(("Invalid parameter list: %s"):format(raw))
	end

	for _, part in ipairs(tokens) do
		local token = trim(part)
		if token ~= "" then
			local name, type_name = token:match("^([%a_][%w_]*)%s*:%s*(.-)%s*$")
			if name then
				local erased = erase_type_for_runtime(type_name, generic_params)
				if not erased then
					error(("Invalid parameter type annotation: %s"):format(token))
				end
				clean[#clean + 1] = name
				typed[#typed + 1] = { name = name, type_name = erased }
			else
				clean[#clean + 1] = token
			end
		end
	end

	return clean, typed
end

local function finalize_typed_field(name, type_name, default_expr, is_private, generic_params)
	local erased = erase_type_for_runtime(type_name, generic_params)
	if not erased then
		return nil
	end
	return name, erased, default_expr, is_private
end

local function parse_field(line, generic_params)
	local name, type_name, default_expr = line:match("^%s*var%s+([%a_][%w_]*)%s*:%s*(.-)%s*=%s*(.-)%s*$")
	if name then
		return finalize_typed_field(name, type_name, default_expr, false, generic_params)
	end

	name, type_name, default_expr = line:match("^%s*local%s+([%a_][%w_]*)%s*:%s*(.-)%s*=%s*(.-)%s*$")
	if name then
		return finalize_typed_field(name, type_name, default_expr, true, generic_params)
	end

	name, type_name, default_expr = line:match("^%s*([%a_][%w_]*)%s*:%s*(.-)%s*=%s*(.-)%s*$")
	if name then
		return finalize_typed_field(name, type_name, default_expr, false, generic_params)
	end

	name, type_name = line:match("^%s*var%s+([%a_][%w_]*)%s*:%s*(.-)%s*$")
	if name then
		return finalize_typed_field(name, type_name, nil, false, generic_params)
	end

	name, type_name = line:match("^%s*local%s+([%a_][%w_]*)%s*:%s*(.-)%s*$")
	if name then
		return finalize_typed_field(name, type_name, nil, true, generic_params)
	end

	name, type_name = line:match("^%s*([%a_][%w_]*)%s*:%s*(.-)%s*$")
	if name then
		return finalize_typed_field(name, type_name, nil, false, generic_params)
	end

	return nil
end

M.block_delta = block_delta
M.find_block_end = find_block_end
M.parse_function_signature = parse_function_signature
M.parse_params = parse_params
M.parse_field = parse_field

return M
