-- Code generator: transforms CLua source to Lua. Entry point: M.compile().

local util = require("clua.compiler.util")
local typesys = require("clua.compiler.typesys")
local parser = require("clua.compiler.parser")
local semantic = require("clua.compiler.semantic")

local trim = util.trim
local split_lines = util.split_lines
local normalize_import_module_path = util.normalize_import_module_path

local erase_generic_type = typesys.erase_generic_type
local parse_generic_param_map = typesys.parse_generic_param_map
local merge_generic_param_maps = typesys.merge_generic_param_maps

local find_block_end = parser.find_block_end
local block_delta = parser.block_delta
local parse_function_signature = parser.parse_function_signature
local parse_params = parser.parse_params
local parse_field = parser.parse_field

local validate_semantic_method_calls = semantic.validate_semantic_method_calls

local M = {}

-- --------------------------------------------------------------------------
-- Line rewriters
-- --------------------------------------------------------------------------

local function erase_generic_method_type_params(line)
	-- Strip explicit type params from generic method calls: .map<integer>( -> .map(
	-- Only erases <...> that contain identifier-like content (type names).
	return (line:gsub("(%.%s*[%a_][%w_]*)%s*<%s*[%a_][%w_%s,]*%s*>%s*%(", "%1("))
end

local function rewrite_new_expressions(line)
	return (
		line:gsub("new%s+([%a_][%w_%.<>%,%[%]%s]*)%s*%(", function(type_name)
			local erased = erase_generic_type(type_name)
			if erased then
				local class_name = erased:gsub("%[%]", "")
				return class_name .. ".new("
			end
			return type_name .. ".new("
		end)
	)
end

local function rewrite_import_statement(line)
	local indent, module_path, comment = line:match("^(%s*)import%s+([%a_][%w_%.]*)%s*(%-%-.*)$")
	if not module_path then
		indent, module_path = line:match("^(%s*)import%s+([%a_][%w_%.]*)%s*$")
	end

	if not module_path then
		return line
	end

	local alias = module_path:match("([%a_][%w_]*)$") or module_path
	local resolved_module_path = normalize_import_module_path(module_path)
	local rewritten = ("%slocal %s = require(%q)"):format(indent, alias, resolved_module_path)
	if comment and comment ~= "" then
		rewritten = rewritten .. " " .. comment
	end

	return rewritten
end

local function assert_no_bare_generic_call(line, context_name, body_line_no)
	local code = line:gsub("%-%-.*$", "")  -- strip comments
	code = code:gsub('"[^"]*"', '""')     -- strip double-quoted strings
	code = code:gsub("'[^']*'", "''")     -- strip single-quoted strings

	-- Skip function declaration lines (method signatures, standalone functions)
	local stripped_line = code:match("^%s*(.-)%s*$") or code
	if stripped_line:match("^function%s") or stripped_line:match("^local%s+function%s") then
		return
	end

	local pos = 1
	while true do
		-- Only match a plain identifier (no dots) — dotted expressions like
		-- self.list.map<T>() are method calls and do not need 'new'.
		local s, e, id, generics = code:find("([%a_][%w_]*)<([^>]-)>%s*%(", pos)
		if not s then break end
		local before = code:sub(1, s - 1)
		-- If preceded by a dot it's a method call — skip.
		if before:match("%.$") then pos = e + 1; goto continue end
		if not before:match("new%s+$") then
			local loc = context_name and (" in " .. context_name) or ""
			error(
				("Missing 'new' keyword%s (body line %d): "
					.. "write 'new %s<%s>(...)' instead of '%s<%s>(...)'"):format(
					loc, body_line_no, id, generics, id, generics
				),
				0
			)
		end
		pos = e + 1
		::continue::
	end
end

-- --------------------------------------------------------------------------
-- Forward declarations (mutually recursive emitters)
-- --------------------------------------------------------------------------

local strip_typed_local_annotation
local emit_body_with_field_checks
local emit_statement_lines

local internal_symbol_counter = 0

local function next_internal_name(prefix)
	internal_symbol_counter = internal_symbol_counter + 1
	return ("__clua_%s_%d"):format(prefix, internal_symbol_counter)
end

local function parse_catch_header(line)
	local name = line:match("^%s*catch%s+([A-Za-z_][A-Za-z0-9_]*)%s*$")
	if name then
		return name
	end

	if line:match("^%s*catch%s*$") then
		return nil
	end

	return false
end

local function parse_finally_header(line)
	if line:match("^%s*finally%s*$") then
		return true
	end

	return false
end

local function find_try_catch_bounds(lines, start_idx, end_limit)
	local depth = 1
	local catch_idx = nil
	local finally_idx = nil
	local limit = end_limit or #lines

	for i = start_idx + 1, limit do
		local catch_name = parse_catch_header(lines[i])
		local is_finally = parse_finally_header(lines[i])
		if depth == 1 and catch_name ~= false then
			if finally_idx then
				error(("catch cannot appear after finally for try at line %d"):format(start_idx))
			end
			if catch_idx then
				error(("Multiple catch blocks for try at line %d"):format(start_idx))
			end
			catch_idx = i
		elseif depth == 1 and is_finally then
			if finally_idx then
				error(("Multiple finally blocks for try at line %d"):format(start_idx))
			end
			finally_idx = i
		end

		depth = depth + block_delta(lines[i])
		if depth == 0 then
			if not catch_idx and not finally_idx then
				error(("try block at line %d requires a catch or finally block"):format(start_idx))
			end
			return catch_idx, finally_idx, i
		end
	end

	error(("Unclosed try block starting at line %d"):format(start_idx))
end

-- --------------------------------------------------------------------------
-- Enum compiler
-- --------------------------------------------------------------------------

local function compile_enum(lines, start_idx)
	local header = lines[start_idx]
	local enum_name = header:match("^%s*enum%s+([%a_][%w_]*)%s*$")
	if not enum_name then
		error(("Invalid enum declaration at line %d"):format(start_idx))
	end

	local end_idx = nil
	for i = start_idx + 1, #lines do
		if lines[i]:match("^%s*end%s*$") then
			end_idx = i
			break
		end
	end

	if not end_idx then
		error(("Unclosed enum block for %s at line %d"):format(enum_name, start_idx))
	end

	local members = {}
	local next_value = 0

	for i = start_idx + 1, end_idx - 1 do
		local text = lines[i]:gsub("%-%-.*$", "")
		local stripped = trim(text)
		if stripped ~= "" then
			local member_name, value_expr = stripped:match("^([%a_][%w_]*)%s*=%s*(.-)%s*$")
			if not member_name then
				member_name = stripped:match("^([%a_][%w_]*)%s*$")
			end

			if not member_name then
				error(("Invalid enum member at line %d: %s"):format(i, stripped))
			end

			if not value_expr or value_expr == "" then
				value_expr = tostring(next_value)
				next_value = next_value + 1
			else
				local n = tonumber(value_expr)
				if n then
					next_value = n + 1
				end
			end

			members[#members + 1] = { name = member_name, value_expr = value_expr }
		end
	end

	local out = {}
	out[#out + 1] = ("local %s = {"):format(enum_name)
	for _, member in ipairs(members) do
		out[#out + 1] = ("  %s = %s,"):format(member.name, member.value_expr)
	end
	out[#out + 1] = "}"
	out[#out + 1] = ""

	return out, end_idx, enum_name
end

-- --------------------------------------------------------------------------
-- Method compiler
-- --------------------------------------------------------------------------

local function compile_method(class_name, lines, start_idx, class_generic_params)
	local signature = lines[start_idx]
	local parsed_signature = parse_function_signature(signature)
	if not parsed_signature then
		error(("Invalid class method declaration at line %d"):format(start_idx))
	end

	local is_private = parsed_signature.is_local
	local method_name = parsed_signature.name
	local generic_capture = parsed_signature.generic_capture
	local params_raw = parsed_signature.params_raw

	local end_idx = find_block_end(lines, start_idx)
	local body = {}
	for i = start_idx + 1, end_idx - 1 do
		body[#body + 1] = lines[i]
	end

	local method_generic_params = parse_generic_param_map(generic_capture, start_idx)
	local merged_generic_params = merge_generic_param_maps(class_generic_params, method_generic_params)
	local clean_params, typed_params = parse_params(params_raw, merged_generic_params)

	return {
		name = method_name,
		is_private = is_private,
		params = clean_params,
		typed_params = typed_params,
		body = body,
		body_start = start_idx + 1,
	},
		end_idx
end

-- --------------------------------------------------------------------------
-- Standalone function compiler
-- --------------------------------------------------------------------------

local function compile_standalone_function(lines, start_idx)
	local signature = lines[start_idx]
	local parsed_signature = parse_function_signature(signature)
	if not parsed_signature then
		return nil
	end

	local is_local = parsed_signature.is_local
	local function_name = parsed_signature.name
	local generic_capture = parsed_signature.generic_capture
	local method_generic_params = parse_generic_param_map(generic_capture, start_idx)
	local clean_params, typed_params = parse_params(parsed_signature.params_raw or "", method_generic_params)
	local end_idx = find_block_end(lines, start_idx)
	local body = {}
	for i = start_idx + 1, end_idx - 1 do
		body[#body + 1] = lines[i]
	end

	local has_typed_params = #typed_params > 0
	local has_generics = next(method_generic_params) ~= nil
	if not has_typed_params and not has_generics and not parsed_signature.has_return_annotation then
		return nil
	end

	local out = {}
	local prefix = is_local and "local function" or "function"
	out[#out + 1] = ("%s %s(%s)"):format(prefix, function_name, table.concat(clean_params, ", "))
	for _, info in ipairs(typed_params) do
		out[#out + 1] = ("  __clua_runtime.assert_type(%s, %q, %q)"):format(
			info.name,
			info.type_name,
			("%s(%s)"):format(function_name, info.name)
		)
	end

	emit_statement_lines(out, body, 1, #body, nil, nil, function_name, nil)
	out[#out + 1] = "end"
	out[#out + 1] = ""

	return out, end_idx
end

-- --------------------------------------------------------------------------
-- Emission helpers
-- --------------------------------------------------------------------------

local function emit_param_asserts(out, class_name, method_name, typed_params)
	for _, info in ipairs(typed_params) do
		out[#out + 1] = ("  __clua_runtime.assert_type(%s, %q, %q)"):format(
			info.name,
			info.type_name,
			("%s.%s(%s)"):format(class_name, method_name, info.name)
		)
	end
end

local function map_fields_by_name(fields)
	local map = {}
	for _, field in ipairs(fields) do
		map[field.name] = field
	end
	return map
end

local function map_private_methods(methods)
	local map = {}
	for _, method in ipairs(methods) do
		if method.is_private then
			map[method.name] = true
		end
	end
	return map
end

local function map_private_fields(fields)
	local map = {}
	for _, field in ipairs(fields) do
		if field.is_private then
			map[field.name] = true
		end
	end
	return map
end

local function rewrite_private_field_access(line, private_fields)
	local rewritten = line
	for name, _ in pairs(private_fields) do
		rewritten = rewritten:gsub("self%." .. name .. "(%f[^%w_])", "__priv." .. name .. "%1")
		rewritten = rewritten:gsub("self%." .. name .. "$", "__priv." .. name)
	end
	return rewritten
end

local function group_methods_by_name(methods)
	local groups = {}
	local order = {}

	for _, method in ipairs(methods) do
		if not groups[method.name] then
			groups[method.name] = {}
			order[#order + 1] = method.name
		end
		groups[method.name][#groups[method.name] + 1] = method
	end

	return groups, order
end

local function typed_params_by_name(method)
	local map = {}
	for _, info in ipairs(method.typed_params or {}) do
		map[info.name] = info.type_name
	end
	return map
end

local function build_overload_condition(method, args_var, argc_var)
	local checks = { ("%s == %d"):format(argc_var, #method.params) }
	local typed = typed_params_by_name(method)

	for idx, param_name in ipairs(method.params) do
		local type_name = typed[param_name]
		if type_name and type_name ~= "" and type_name ~= "any" then
			checks[#checks + 1] = ("__clua_runtime.matches_type(%s[%d], %q)"):format(args_var, idx, type_name)
		end
	end

	return table.concat(checks, " and ")
end

local function build_overload_call_args(args_var, count)
	local args = {}
	for i = 1, count do
		args[#args + 1] = ("%s[%d]"):format(args_var, i)
	end
	return table.concat(args, ", ")
end

local function emit_method_implementation(
	out,
	class_name,
	method,
	emitted_name,
	fields,
	fields_by_name,
	private_fields,
	private_store_name,
	instance_methods,
	class_line_map
)
	local params = table.concat(method.params, ", ")

	if method.name == "new" then
		out[#out + 1] = ("function %s.%s(%s)"):format(class_name, emitted_name, params)
		out[#out + 1] = ("  local self = setmetatable({}, %s)"):format(class_name)
		out[#out + 1] = "  local __priv = {}"
		out[#out + 1] = ("  %s[self] = __priv"):format(private_store_name)
		emit_param_asserts(out, class_name, method.name, method.typed_params)

		for _, field in ipairs(fields) do
			if field.default_expr then
				local target_prefix = field.is_private and "__priv" or "self"
				out[#out + 1] = ("  %s.%s = %s"):format(
					target_prefix,
					field.name,
					rewrite_new_expressions(field.default_expr)
				)
				out[#out + 1] = ("  __clua_runtime.assert_type(%s.%s, %q, %q)"):format(
					target_prefix,
					field.name,
					field.type_name,
					("%s.new(%s)"):format(class_name, field.name)
				)
			end
		end

		local body_source_base = method.body_start and (method.body_start - 1) or nil
		emit_body_with_field_checks(out, method.body, fields_by_name, private_fields, class_name, method.name, body_source_base, class_line_map)

		for _, instance_method in ipairs(instance_methods) do
			out[#out + 1] = ("  self.%s = function(__first, ...)"):format(instance_method)
			out[#out + 1] = "    if __first == self then"
			out[#out + 1] = ("      return %s.%s(self, ...)"):format(class_name, instance_method)
			out[#out + 1] = "    end"
			out[#out + 1] = ("    return %s.%s(self, __first, ...)"):format(class_name, instance_method)
			out[#out + 1] = "  end"
		end

		out[#out + 1] = "  return self"
		out[#out + 1] = "end"
		out[#out + 1] = ""
		return
	end

	out[#out + 1] = ("function %s.%s(self%s%s)"):format(class_name, emitted_name, params ~= "" and ", " or "", params)
	out[#out + 1] = ("  local __priv = %s[self] or {}"):format(private_store_name)
	emit_param_asserts(out, class_name, method.name, method.typed_params)
	local body_source_base = method.body_start and (method.body_start - 1) or nil
	emit_body_with_field_checks(out, method.body, fields_by_name, private_fields, class_name, method.name, body_source_base, class_line_map)
	out[#out + 1] = "end"
	out[#out + 1] = ""
end

-- Assigned below (forward declared above due to mutual use with emit_method_implementation).
strip_typed_local_annotation = function(line)
	local indent, name, type_name, expr = line:match("^(%s*)local%s+([A-Za-z_][A-Za-z0-9_]*)%s*:%s*(.-)%s*=%s*(.-)%s*$")
	if name and erase_generic_type(type_name) then
		return ("%slocal %s = %s"):format(indent, name, expr)
	end

	indent, name, type_name = line:match("^(%s*)local%s+([A-Za-z_][A-Za-z0-9_]*)%s*:%s*(.-)%s*$")
	if name and erase_generic_type(type_name) then
		return ("%slocal %s"):format(indent, name)
	end

	return line
end

local function emit_field_assert_if_needed(out, rewritten, fields_by_name, class_name, method_name)
	if not fields_by_name then
		return
	end

	local indent, field_name = rewritten:match("^(%s*)self%.([%a_][%w_]*)%s*=%s*.+$")
	local target_prefix = "self"
	if not field_name then
		indent, field_name = rewritten:match("^(%s*)__priv%.([%a_][%w_]*)%s*=%s*.+$")
		target_prefix = "__priv"
	end
	if field_name then
		local field = fields_by_name[field_name]
		if field and field.type_name and field.type_name ~= "" then
			out[#out + 1] = ("%s__clua_runtime.assert_type(%s.%s, %q, %q)"):format(
				indent,
				target_prefix,
				field_name,
				field.type_name,
				("%s.%s(%s)"):format(class_name, method_name, field_name)
			)
		end
	end
end

local function emit_try_catch_block(
	out,
	lines,
	start_idx,
	catch_idx,
	finally_idx,
	end_idx,
	fields_by_name,
	private_fields,
	class_name,
	method_name,
	source_base,
	class_line_map
)
	local indent = lines[start_idx]:match("^(%s*)") or ""
	local catch_name = catch_idx and parse_catch_header(lines[catch_idx]) or nil
	local result_name = next_internal_name("result")
	local ok_name = next_internal_name("ok")
	local err_name = next_internal_name("err")
	local bound_error_name = (catch_idx and (catch_name or next_internal_name("caught"))) or nil
	local try_end_idx = ((catch_idx or finally_idx) or end_idx) - 1
	local catch_end_idx = finally_idx and (finally_idx - 1) or (end_idx - 1)

	out[#out + 1] = indent .. "do"
	out[#out + 1] = indent .. ("  local %s = table.pack(pcall(function()"):format(result_name)
	emit_statement_lines(
		out,
		lines,
		start_idx + 1,
		try_end_idx,
		fields_by_name,
		private_fields,
		class_name,
		method_name,
		source_base,
		class_line_map
	)
	out[#out + 1] = indent .. "  end))"
	out[#out + 1] = indent .. ("  local %s = %s[1]"):format(ok_name, result_name)
	out[#out + 1] = indent .. ("  local %s = %s[2]"):format(err_name, result_name)
	if catch_idx then
		out[#out + 1] = indent .. ("  if not %s then"):format(ok_name)
		out[#out + 1] = indent .. ("    local %s = __clua_runtime.remap_error_line(%s, __clua_line_map)"):format(bound_error_name, err_name)
		emit_statement_lines(
			out,
			lines,
			catch_idx + 1,
			catch_end_idx,
			fields_by_name,
			private_fields,
			class_name,
			method_name,
			source_base,
			class_line_map
		)
		out[#out + 1] = indent .. "  end"
	end
	if finally_idx then
		emit_statement_lines(
			out,
			lines,
			finally_idx + 1,
			end_idx - 1,
			fields_by_name,
			private_fields,
			class_name,
			method_name,
			source_base,
			class_line_map
		)
	end
	if not catch_idx then
		out[#out + 1] = indent .. ("  if not %s then"):format(ok_name)
		out[#out + 1] = indent .. ("    error(__clua_runtime.remap_error_line(%s, __clua_line_map), 0)"):format(err_name)
		out[#out + 1] = indent .. "  end"
	end
	out[#out + 1] = indent .. ("  if %s and %s.n > 1 then"):format(ok_name, result_name)
	out[#out + 1] = indent
		.. ("    return ((table and table.unpack) or unpack)(%s, 2, %s.n)"):format(result_name, result_name)
	out[#out + 1] = indent .. "  end"
	out[#out + 1] = indent .. "end"
end

emit_statement_lines = function(out, lines, start_idx, end_idx, fields_by_name, private_fields, class_name, method_name, source_base, class_line_map)
	if not lines or start_idx > end_idx then
		return
	end

	local i = start_idx
	while i <= end_idx do
		local line = lines[i]
		if line:match("^%s*try%s*$") then
			local catch_idx, finally_idx, block_end = find_try_catch_bounds(lines, i, end_idx)
			emit_try_catch_block(
				out,
				lines,
				i,
				catch_idx,
				finally_idx,
				block_end,
				fields_by_name,
				private_fields,
				class_name,
				method_name,
				source_base,
				class_line_map
			)
			i = block_end + 1
		else
			local context = (class_name and method_name)
				and (class_name .. "." .. method_name)
				or (class_name or method_name)
			assert_no_bare_generic_call(line, context, i)
			local rewritten = rewrite_new_expressions(rewrite_private_field_access(line, private_fields or {}))
			rewritten = erase_generic_method_type_params(rewritten)
			rewritten = strip_typed_local_annotation(rewritten)
			out[#out + 1] = rewritten
			if class_line_map then
				local src = source_base and (source_base + i) or i
				class_line_map[#out] = src
			end
			local prev_len = #out
			emit_field_assert_if_needed(out, rewritten, fields_by_name, class_name, method_name)
			if class_line_map and #out > prev_len then
				local src = source_base and (source_base + i) or i
				class_line_map[#out] = src
			end
			i = i + 1
		end
	end
end

emit_body_with_field_checks = function(out, body, fields_by_name, private_fields, class_name, method_name, source_base, class_line_map)
	emit_statement_lines(out, body, 1, #body, fields_by_name, private_fields, class_name, method_name, source_base, class_line_map)
end

-- --------------------------------------------------------------------------
-- Class compiler
-- --------------------------------------------------------------------------

local function parse_class_header(header, line_no)
	local class_name, generic_params, extends_raw =
		header:match("^%s*class%s+([%a_][%w_]*)(%b<>)%s+extends%s+([^%s]+)%s*$")

	if not class_name then
		class_name, extends_raw = header:match("^%s*class%s+([%a_][%w_]*)%s+extends%s+([^%s]+)%s*$")
	end

	if not class_name then
		class_name, generic_params = header:match("^%s*class%s+([%a_][%w_]*)(%b<>)%s*$")
	end

	if not class_name then
		class_name = header:match("^%s*class%s+([%a_][%w_]*)%s*$")
	end

	if not class_name then
		error(("Invalid class declaration at line %d"):format(line_no))
	end

	local class_generic_params = parse_generic_param_map(generic_params, line_no)

	local extends = nil
	if extends_raw and extends_raw ~= "" then
		extends = erase_generic_type(extends_raw)
		if not extends then
			error(("Invalid base class type '%s' at line %d"):format(extends_raw, line_no))
		end
		extends = extends:gsub("%[%]", "")
	end

	return class_name, extends, class_generic_params
end

local function compile_class(lines, start_idx)
	local header = lines[start_idx]
	local class_name, extends, class_generic_params = parse_class_header(header, start_idx)

	local end_idx = find_block_end(lines, start_idx)

	local fields = {}
	local methods = {}

	local i = start_idx + 1
	while i < end_idx do
		local line = lines[i]
		local stripped = trim(line)

		if stripped == "" or stripped:match("^%-%-") then
			i = i + 1
		elseif stripped:match("^function%s+") or stripped:match("^local%s+function%s+") then
			local method_info, method_end = compile_method(class_name, lines, i, class_generic_params)
			methods[#methods + 1] = method_info
			i = method_end + 1
		else
			local name, type_name, default_expr, is_private = parse_field(line, class_generic_params)
			if not name then
				error(("Unsupported class statement at line %d: %s"):format(i, stripped))
			end
			fields[#fields + 1] = {
				name = name,
				type_name = type_name,
				default_expr = default_expr,
				is_private = is_private,
			}
			i = i + 1
		end
	end

	local out = {}
	local class_line_map = {}
	local private_store_name = ("__clua_private_%s"):format(class_name)
	local private_fields_table_name = ("__clua_private_fields_%s"):format(class_name)
	local private_field_entries = {}
	for _, field in ipairs(fields) do
		if field.is_private then
			private_field_entries[#private_field_entries + 1] = ("[%q] = true"):format(field.name)
		end
	end
	local private_fields_literal = "{" .. table.concat(private_field_entries, ", ") .. "}"
	out[#out + 1] = ("local %s = {}"):format(class_name)
	if extends and extends ~= "Love" then
		out[#out + 1] = ("setmetatable(%s, {__index = %s})"):format(class_name, extends)
	end
	out[#out + 1] = ("local %s = %s"):format(private_fields_table_name, private_fields_literal)
	out[#out + 1] = ("%s.__index = function(self, key)"):format(class_name)
	out[#out + 1] = ("  if %s[key] then"):format(private_fields_table_name)
	out[#out + 1] = ('    error(("Private field access denied: %s.%%s"):format(key), 2)'):format(class_name)
	out[#out + 1] = "  end"
	if extends and extends ~= "Love" then
		out[#out + 1] = ("  local __v = rawget(%s, key)"):format(class_name)
		out[#out + 1] = "  if __v ~= nil then return __v end"
		out[#out + 1] = ("  return %s[key]"):format(extends)
	else
		out[#out + 1] = ("  return rawget(%s, key)"):format(class_name)
	end
	out[#out + 1] = "end"
	out[#out + 1] = ("%s.__newindex = function(self, key, value)"):format(class_name)
	out[#out + 1] = ("  if %s[key] then"):format(private_fields_table_name)
	out[#out + 1] = ('    error(("Private field write denied: %s.%%s"):format(key), 2)'):format(class_name)
	out[#out + 1] = "  end"
	out[#out + 1] = "  rawset(self, key, value)"
	out[#out + 1] = "end"
	out[#out + 1] = ("%s.__name = %q"):format(class_name, class_name)
	out[#out + 1] = ('local %s = setmetatable({}, { __mode = "k" })'):format(private_store_name)
	out[#out + 1] = ""

	local instance_methods = {}
	local method_groups, method_order = group_methods_by_name(methods)
	local private_methods = {}

	for _, method_name in ipairs(method_order) do
		local overloads = method_groups[method_name]
		local has_private = false
		local has_public = false

		for _, overload in ipairs(overloads) do
			if overload.is_private then
				has_private = true
			else
				has_public = true
			end
		end

		if has_private and has_public then
			error(("Cannot mix private and public overloads for %s.%s"):format(class_name, method_name))
		end

		if has_private then
			private_methods[method_name] = true
		elseif method_name ~= "new" then
			instance_methods[#instance_methods + 1] = method_name
		end
	end

	local fields_by_name = map_fields_by_name(fields)
	local private_fields = map_private_fields(fields)

	for _, method_name in ipairs(method_order) do
		local overloads = method_groups[method_name]

		if #overloads == 1 then
			emit_method_implementation(
				out,
				class_name,
				overloads[1],
				method_name,
				fields,
				fields_by_name,
				private_fields,
				private_store_name,
				instance_methods,
				class_line_map
			)
		else
			for idx, overload in ipairs(overloads) do
				local impl_name = ("__overload_%s_%d"):format(method_name, idx)
				emit_method_implementation(
					out,
					class_name,
					overload,
					impl_name,
					fields,
					fields_by_name,
					private_fields,
					private_store_name,
					instance_methods,
					class_line_map
				)
			end

			if method_name == "new" then
				out[#out + 1] = ("function %s.new(...)"):format(class_name)
			else
				out[#out + 1] = ("function %s.%s(self, ...)"):format(class_name, method_name)
			end

			out[#out + 1] = '  local __argc = select("#", ...)'
			out[#out + 1] = "  local __args = {...}"

			for idx, overload in ipairs(overloads) do
				local condition = build_overload_condition(overload, "__args", "__argc")
				local call_args = build_overload_call_args("__args", #overload.params)
				local impl_name = ("__overload_%s_%d"):format(method_name, idx)

				out[#out + 1] = ("  if %s then"):format(condition)
				if method_name == "new" then
					if call_args == "" then
						out[#out + 1] = ("    return %s.%s()"):format(class_name, impl_name)
					else
						out[#out + 1] = ("    return %s.%s(%s)"):format(class_name, impl_name, call_args)
					end
				else
					if call_args == "" then
						out[#out + 1] = ("    return %s.%s(self)"):format(class_name, impl_name)
					else
						out[#out + 1] = ("    return %s.%s(self, %s)"):format(class_name, impl_name, call_args)
					end
				end
				out[#out + 1] = "  end"
			end

			out[#out + 1] = ('  error(("No matching overload for %s.%s with %%d argument(s)"):format(__argc), 2)'):format(
				class_name,
				method_name
			)
			out[#out + 1] = "end"
			out[#out + 1] = ""
		end
	end

	if extends == "Love" then
		out[#out + 1] = ('%s.__extends = "Love"'):format(class_name)
		out[#out + 1] = ""
	end

	return out, end_idx, class_name, private_methods, class_line_map
end

-- --------------------------------------------------------------------------
-- Helpers used in the main compile loop
-- --------------------------------------------------------------------------

local function assert_no_private_method_access(line, line_no, private_methods_by_class)
	local text = line:gsub("%-%-.*$", "")
	for class_name, method_name in text:gmatch("([%a_][%w_]*)%.([%a_][%w_]*)%s*%(") do
		local class_private_methods = private_methods_by_class[class_name]
		if class_private_methods and class_private_methods[method_name] then
			error(
				("Private method access denied at line %d: %s.%s(...) is private to class %s. Use self.%s(...) inside class methods."):format(
					line_no,
					class_name,
					method_name,
					class_name,
					method_name
				)
			)
		end
	end
end

local function strip_typed_locals(line)
	local updated = rewrite_import_statement(line)
	updated = strip_typed_local_annotation(updated)
	updated = erase_generic_method_type_params(updated)
	return rewrite_new_expressions(updated)
end

-- --------------------------------------------------------------------------
-- Public entry point
-- --------------------------------------------------------------------------

function M.compile(source, chunk_name)
	local lines = split_lines(source)
	internal_symbol_counter = 0
	validate_semantic_method_calls(lines, chunk_name)
	local out = {}
	local line_map = {}  -- maps output line number -> source line number
	local current_source_line = 0  -- track current source context
	local saw_class = false
	local saw_enum = false
	local saw_typed_function = false
	local saw_try_catch = false
	local saw_explicit_return = false
	local last_decl_name = nil
	local private_methods_by_class = {}

	local function add_line(output_line, source_line)
		source_line = source_line or current_source_line
		out[#out + 1] = output_line
		line_map[#out] = source_line
	end

	local i = 1
	while i <= #lines do
		local line = lines[i]
		current_source_line = i

		if line:match("^%s*class%s+") then
			local class_code, class_end, class_name, private_methods, class_line_map = compile_class(lines, i)
			saw_class = true
			last_decl_name = class_name
			private_methods_by_class[class_name] = private_methods
			local base_out = #out
			for _, class_line in ipairs(class_code) do
				add_line(class_line, i)
			end
			for class_idx, src_line in pairs(class_line_map) do
				line_map[base_out + class_idx] = src_line
			end
			i = class_end + 1
		elseif line:match("^%s*enum%s+") then
			local enum_code, enum_end, enum_name = compile_enum(lines, i)
			saw_enum = true
			last_decl_name = enum_name
			for _, enum_line in ipairs(enum_code) do
				add_line(enum_line, i)
			end
			i = enum_end + 1
		elseif line:match("^%s*local%s+function%s+") or line:match("^%s*function%s+") then
			local function_code, function_end = compile_standalone_function(lines, i)
			if function_code then
				saw_typed_function = true
				for _, function_line in ipairs(function_code) do
					add_line(function_line, i)
				end
				i = function_end + 1
			else
				assert_no_private_method_access(line, i, private_methods_by_class)
				local stripped = strip_typed_locals(line)
				if stripped:match("^%s*return%s") or stripped:match("^%s*return%s*$") then
					saw_explicit_return = true
				end
				add_line(stripped, i)
				i = i + 1
			end
		elseif line:match("^%s*try%s*$") then
			local catch_idx, finally_idx, block_end = find_try_catch_bounds(lines, i)
			saw_try_catch = true
			local top_line_map = {}
			emit_try_catch_block(out, lines, i, catch_idx, finally_idx, block_end, nil, nil, nil, nil, nil, top_line_map)
			for abs_idx, src_line in pairs(top_line_map) do
				line_map[abs_idx] = src_line
			end
			i = block_end + 1
		else
			assert_no_private_method_access(line, i, private_methods_by_class)
			assert_no_bare_generic_call(line, nil, i)
			local stripped = strip_typed_locals(line)
			if stripped:match("^%s*return%s") or stripped:match("^%s*return%s*$") then
				saw_explicit_return = true
			end
			add_line(stripped, i)
			i = i + 1
		end
	end

	if saw_class or saw_typed_function or saw_try_catch then
		table.insert(out, 1, 'local __clua_runtime = require("clua.runtime")')
		table.insert(line_map, 1, 0)  -- runtime require has no source line
	end

	-- Emit line map as a global variable for error remapping
	if #line_map > 0 then
		local line_map_src = "local __clua_line_map = {"
		for j = 1, #line_map do
			if j > 1 then line_map_src = line_map_src .. ", " end
			line_map_src = line_map_src .. (line_map[j] or 0)
		end
		line_map_src = line_map_src .. "}"
		table.insert(out, 1, line_map_src)
		table.insert(line_map, 1, 0)
	end

	if (saw_class or saw_enum) and not saw_explicit_return and last_decl_name then
		out[#out + 1] = ("return %s"):format(last_decl_name)
	end

	return table.concat(out, "\n")
end

return M
