local M = {}

local function trim(s)
	return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local erase_generic_type

local function rewrite_new_expressions(line)
	return (
		line:gsub("new%s+([%a_][%w_%.<>%,%[%]%s]*)%s*%(", function(type_name)
			if erase_generic_type then
				local erased = erase_generic_type(type_name)
				if erased then
					local class_name = erased:gsub("%[%]", "")
					return class_name .. ".new("
				end
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
	local rewritten = ("%slocal %s = require(%q)"):format(indent, alias, module_path)
	if comment and comment ~= "" then
		rewritten = rewritten .. " " .. comment
	end

	return rewritten
end

local function split_lines(source)
	local lines = {}
	source = source:gsub("\r\n", "\n")
	for line in (source .. "\n"):gmatch("(.-)\n") do
		lines[#lines + 1] = line
	end
	return lines
end

local TYPE_NAME_PATTERN = "([%a_][%w_%.%[%]<>%,]*)"

local function split_top_level_commas(text)
	local parts = {}
	local depth = 0
	local start_idx = 1

	for i = 1, #text do
		local ch = text:sub(i, i)
		if ch == "<" then
			depth = depth + 1
		elseif ch == ">" then
			depth = depth - 1
			if depth < 0 then
				return nil
			end
		elseif ch == "," and depth == 0 then
			parts[#parts + 1] = trim(text:sub(start_idx, i - 1))
			start_idx = i + 1
		end
	end

	if depth ~= 0 then
		return nil
	end

	parts[#parts + 1] = trim(text:sub(start_idx))
	return parts
end

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

local validate_type_name

local function validate_type_core(core)
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

erase_generic_type = function(type_name)
	local ok, erased = validate_type_name(type_name)
	if not ok then
		return nil
	end
	return erased
end

local function parse_generic_param_map(generic_capture, line_no)
	local map = {}
	if not generic_capture or generic_capture == "" then
		return map
	end

	local inner = generic_capture:sub(2, -2)
	local names = split_top_level_commas(inner)
	if not names then
		error(("Invalid generic parameter list at line %d"):format(line_no))
	end

	for _, name in ipairs(names) do
		if not name:match("^[%a_][%w_]*$") then
			error(("Invalid generic type parameter '%s' at line %d"):format(name, line_no))
		end
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

local function compile_method(class_name, lines, start_idx, class_generic_params)
	local signature = lines[start_idx]
	local is_private = false
	-- Accept optional `<T, U>` after the method name and optional `: ReturnType` after the closing paren.
	local method_name, params_raw = signature:match("^%s*local%s+function%s+([%a_][%w_]*)%s*%((.-)%).*$")
	local generic_capture = nil
	if method_name then
		is_private = true
	else
		method_name, params_raw = signature:match("^%s*function%s+([%a_][%w_]*)%s*%((.-)%).*$")
	end

	if not method_name then
		method_name, generic_capture, params_raw =
			signature:match("^%s*local%s+function%s+([%a_][%w_]*)(%b<>)%s*%((.-)%).*$")
		if method_name then
			is_private = true
		else
			method_name, generic_capture, params_raw =
				signature:match("^%s*function%s+([%a_][%w_]*)(%b<>)%s*%((.-)%).*$")
		end
	end

	if not method_name then
		error(("Invalid class method declaration at line %d"):format(start_idx))
	end

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
	},
		end_idx
end

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

local emit_body_with_field_checks

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
	instance_methods
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

		emit_body_with_field_checks(out, method.body, fields_by_name, private_fields, class_name, method.name)

		for _, instance_method in ipairs(instance_methods) do
			out[#out + 1] = ("  self.%s = function(...)"):format(instance_method)
			out[#out + 1] = ("    return %s.%s(self, ...)"):format(class_name, instance_method)
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
	emit_body_with_field_checks(out, method.body, fields_by_name, private_fields, class_name, method.name)
	out[#out + 1] = "end"
	out[#out + 1] = ""
end

local function strip_typed_local_annotation(line)
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

emit_body_with_field_checks = function(out, body, fields_by_name, private_fields, class_name, method_name)
	for _, line in ipairs(body) do
		local rewritten = rewrite_new_expressions(rewrite_private_field_access(line, private_fields))
		rewritten = strip_typed_local_annotation(rewritten)
		out[#out + 1] = rewritten

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
end

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
				instance_methods
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
					instance_methods
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

	return out, end_idx, class_name, private_methods
end

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
	return rewrite_new_expressions(updated)
end

function M.compile(source, chunk_name)
	local lines = split_lines(source)
	local out = {}
	local saw_class = false
	local saw_enum = false
	local saw_explicit_return = false
	local last_decl_name = nil
	local private_methods_by_class = {}

	local i = 1
	while i <= #lines do
		local line = lines[i]

		if line:match("^%s*class%s+") then
			local class_code, class_end, class_name, private_methods = compile_class(lines, i)
			saw_class = true
			last_decl_name = class_name
			private_methods_by_class[class_name] = private_methods
			for _, class_line in ipairs(class_code) do
				out[#out + 1] = class_line
			end
			i = class_end + 1
		elseif line:match("^%s*enum%s+") then
			local enum_code, enum_end, enum_name = compile_enum(lines, i)
			saw_enum = true
			last_decl_name = enum_name
			for _, enum_line in ipairs(enum_code) do
				out[#out + 1] = enum_line
			end
			i = enum_end + 1
		else
			assert_no_private_method_access(line, i, private_methods_by_class)
			local stripped = strip_typed_locals(line)
			if stripped:match("^%s*return%s") or stripped:match("^%s*return%s*$") then
				saw_explicit_return = true
			end
			out[#out + 1] = stripped
			i = i + 1
		end
	end

	if saw_class then
		table.insert(out, 1, 'local __clua_runtime = require("clua.runtime")')
	end

	if (saw_class or saw_enum) and not saw_explicit_return and last_decl_name then
		out[#out + 1] = ("return %s"):format(last_decl_name)
	end

	return table.concat(out, "\n")
end

return M
