-- Semantic analysis: type-checks method calls against field/import type information.

local util = require("clua.compiler.util")
local typesys = require("clua.compiler.typesys")
local parser = require("clua.compiler.parser")

local trim = util.trim
local escape_lua_pattern = util.escape_lua_pattern
local split_lines = util.split_lines
local split_top_level_commas = util.split_top_level_commas
local normalize_import_module_path = util.normalize_import_module_path

local normalize_type_name = typesys.normalize_type_name
local validate_type_name = typesys.validate_type_name
local erase_generic_type = typesys.erase_generic_type
local parse_generic_param_list = typesys.parse_generic_param_list
local get_array_base_type = typesys.get_array_base_type

local find_block_end = parser.find_block_end
local parse_function_signature = parser.parse_function_signature

-- Resolve the directory that contains this source file, for rocks-tree lookup.
local function get_source_dir(source)
	if type(source) ~= "string" or source == "" then
		return nil
	end
	local path = source
	if path:sub(1, 1) == "@" then
		path = path:sub(2)
	end
	return path:match("^(.*)[/\\][^/\\]+$")
end

local function get_parent_dir(path)
	return type(path) == "string" and path:match("^(.*)[/\\][^/\\]+$") or nil
end

local SEMANTIC_SOURCE_DIR = get_source_dir(debug.getinfo(1, "S").source)
local COMPILER_ROOT_DIR = get_parent_dir(SEMANTIC_SOURCE_DIR)

-- --------------------------------------------------------------------------
-- Semantic field / param / class parsers (no type erasure — preserve generics)
-- --------------------------------------------------------------------------

local function parse_semantic_params(params_raw)
	local params = {}
	local raw = trim(params_raw)
	if raw == "" then
		return params
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
				local ok = validate_type_name(type_name)
				if not ok then
					error(("Invalid parameter type annotation: %s"):format(token))
				end
				params[#params + 1] = {
					name = name,
					type_name = normalize_type_name(type_name),
				}
			else
				params[#params + 1] = {
					name = token,
					type_name = "any",
				}
			end
		end
	end

	return params
end

local function finalize_semantic_field(name, type_name, default_expr, is_private)
	local ok = validate_type_name(type_name)
	if not ok then
		return nil
	end

	return {
		name = name,
		type_name = normalize_type_name(type_name),
		default_expr = default_expr,
		is_private = is_private,
	}
end

local function parse_semantic_field(line)
	local name, type_name, default_expr = line:match("^%s*var%s+([%a_][%w_]*)%s*:%s*(.-)%s*=%s*(.-)%s*$")
	if name then
		return finalize_semantic_field(name, type_name, default_expr, false)
	end

	name, type_name, default_expr = line:match("^%s*local%s+([%a_][%w_]*)%s*:%s*(.-)%s*=%s*(.-)%s*$")
	if name then
		return finalize_semantic_field(name, type_name, default_expr, true)
	end

	name, type_name, default_expr = line:match("^%s*([%a_][%w_]*)%s*:%s*(.-)%s*=%s*(.-)%s*$")
	if name then
		return finalize_semantic_field(name, type_name, default_expr, false)
	end

	name, type_name = line:match("^%s*var%s+([%a_][%w_]*)%s*:%s*(.-)%s*$")
	if name then
		return finalize_semantic_field(name, type_name, nil, false)
	end

	name, type_name = line:match("^%s*local%s+([%a_][%w_]*)%s*:%s*(.-)%s*$")
	if name then
		return finalize_semantic_field(name, type_name, nil, true)
	end

	name, type_name = line:match("^%s*([%a_][%w_]*)%s*:%s*(.-)%s*$")
	if name then
		return finalize_semantic_field(name, type_name, nil, false)
	end

	return nil
end

local function parse_class_signature(header, line_no)
	local class_name, generic_capture, extends_raw =
		header:match("^%s*class%s+([%a_][%w_]*)(%b<>)%s+extends%s+([^%s]+)%s*$")

	if not class_name then
		class_name, extends_raw = header:match("^%s*class%s+([%a_][%w_]*)%s+extends%s+([^%s]+)%s*$")
	end

	if not class_name then
		class_name, generic_capture = header:match("^%s*class%s+([%a_][%w_]*)(%b<>)%s*$")
	end

	if not class_name then
		class_name = header:match("^%s*class%s+([%a_][%w_]*)%s*$")
	end

	if not class_name then
		error(("Invalid class declaration at line %d"):format(line_no))
	end

	local type_params = parse_generic_param_list(generic_capture, line_no)
	local extends_name = extends_raw and erase_generic_type(extends_raw) or nil
	if extends_name then
		extends_name = extends_name:gsub("%[%]", "")
	end

	return {
		name = class_name,
		type_params = type_params,
		extends_name = extends_name,
	}
end

local function parse_semantic_local(line)
	local name, type_name, expr = line:match("^%s*local%s+([%a_][%w_]*)%s*:%s*(.-)%s*=%s*(.-)%s*$")
	if name then
		local ok = validate_type_name(type_name)
		if ok then
			return {
				name = name,
				type_name = normalize_type_name(type_name),
				default_expr = expr,
			}
		end
	end

	name, type_name = line:match("^%s*local%s+([%a_][%w_]*)%s*:%s*(.-)%s*$")
	if name then
		local ok = validate_type_name(type_name)
		if ok then
			return {
				name = name,
				type_name = normalize_type_name(type_name),
				default_expr = nil,
			}
		end
	end

	name, expr = line:match("^%s*local%s+([%a_][%w_]*)%s*=%s*(.-)%s*$")
	if name then
		return {
			name = name,
			type_name = nil,
			default_expr = expr,
		}
	end

	return nil
end

-- --------------------------------------------------------------------------
-- Type compatibility helpers
-- --------------------------------------------------------------------------

local function infer_literal_type(expr)
	local value = trim(expr or "")
	if value == "" then
		return nil
	end

	if value == "true" or value == "false" then
		return "boolean"
	end

	if value == "nil" then
		return "nil"
	end

	if tonumber(value) ~= nil then
		return "number"
	end

	if value:match('^".*"$') or value:match("^'.*'$") then
		return "string"
	end

	if value:match("^%b{}$") then
		return "table"
	end

	return nil
end

local function split_array_type(type_name)
	local base = normalize_type_name(type_name)
	local depth = 0

	while type(base) == "string" and base:sub(-2) == "[]" do
		base = base:sub(1, -3)
		depth = depth + 1
	end

	return base, depth
end

local function literal_matches_declared_type(literal_type, declared_type)
	if not literal_type then
		return true
	end

	if declared_type == "any" or literal_type == declared_type then
		return true
	end

	if literal_type == "table" and declared_type:match("%[%]$") then
		return true
	end

	if literal_type == "table" and declared_type:match("^table<.*>$") then
		return true
	end

	return false
end

local function expression_matches_declared_type(expr_type, declared_type)
	if not expr_type or declared_type == "any" then
		return true
	end

	if expr_type == declared_type then
		return true
	end

	if expr_type == "table" then
		return literal_matches_declared_type(expr_type, declared_type)
	end

	local declared_base, declared_depth = split_array_type(declared_type)
	local expr_base, expr_depth = split_array_type(expr_type)
	if declared_depth == 0 or expr_depth == 0 then
		return false
	end

	return declared_depth == expr_depth and (declared_base == "any" or expr_base == declared_base)
end

local function build_type_param_map_from_type_ref(type_ref, target_class)
	if not type_ref or not target_class or not target_class.type_params or #target_class.type_params == 0 then
		return nil
	end

	local normalized = normalize_type_name(type_ref)
	local generic_args = normalized and normalized:match("^[%a_][%w_%.]*<(.*)>$") or nil
	if not generic_args then
		return nil
	end

	local args = split_top_level_commas(generic_args)
	if not args or #args == 0 then
		return nil
	end

	local map = {}
	for i, name in ipairs(target_class.type_params) do
		map[name] = normalize_type_name(args[i] or "any") or "any"
	end

	return map
end

local function apply_type_param_map(type_name, type_param_map)
	if not type_name or not type_param_map then
		return type_name
	end

	local out = type_name
	for param, concrete in pairs(type_param_map) do
		out = out:gsub("%f[%a_]" .. escape_lua_pattern(param) .. "%f[^%w_]", concrete)
	end

	return out
end

-- --------------------------------------------------------------------------
-- Call-site extraction helpers
-- --------------------------------------------------------------------------

local function mask_line_for_analysis(line_text)
	if not line_text or line_text == "" then
		return ""
	end

	local out = {}
	local quote = nil
	local escape_next = false
	local i = 1

	while i <= #line_text do
		local ch = line_text:sub(i, i)
		local next_ch = line_text:sub(i + 1, i + 1)

		if quote then
			if escape_next then
				escape_next = false
				out[#out + 1] = " "
			elseif ch == "\\" then
				escape_next = true
				out[#out + 1] = " "
			elseif ch == quote then
				quote = nil
				out[#out + 1] = " "
			else
				out[#out + 1] = " "
			end
		elseif ch == '"' or ch == "'" then
			quote = ch
			out[#out + 1] = " "
		elseif ch == "-" and next_ch == "-" then
			for _ = i, #line_text do
				out[#out + 1] = " "
			end
			break
		else
			out[#out + 1] = ch
		end

		i = i + 1
	end

	return table.concat(out)
end

local function extract_self_field_method_calls(raw_line_text, analysis_line_text)
	if not raw_line_text or not analysis_line_text then
		return {}
	end

	local calls = {}
	local search_from = 1

	while true do
		local start_pos, open_paren_index, _call_pos, field_name, method_name =
			analysis_line_text:find("()self%.([%a_][%w_]*)%.([%a_][%w_]*)%s*%(", search_from)
		if not start_pos then
			break
		end

		local depth = 1
		local close_paren_index = nil
		for i = open_paren_index + 1, #analysis_line_text do
			local ch = analysis_line_text:sub(i, i)
			if ch == "(" then
				depth = depth + 1
			elseif ch == ")" then
				depth = depth - 1
				if depth == 0 then
					close_paren_index = i
					break
				end
			end
		end

		if not close_paren_index then
			break
		end

		calls[#calls + 1] = {
			field_name = field_name,
			method_name = method_name,
			args_text = trim(raw_line_text:sub(open_paren_index + 1, close_paren_index - 1)),
			line_start = start_pos,
		}

		search_from = close_paren_index + 1
	end

	return calls
end

-- --------------------------------------------------------------------------
-- Module resolution (for imported class types)
-- --------------------------------------------------------------------------

local function build_module_search_path(chunk_name)
	local entries = {}
	local seen = {}

	local function add_entry(entry)
		if entry and entry ~= "" and not seen[entry] then
			seen[entry] = true
			entries[#entries + 1] = entry
		end
	end

	local function add_root(root)
		if not root or root == "" then
			return
		end
		add_entry(root .. "/?.clua")
		add_entry(root .. "/?/init.clua")
		add_entry(root .. "/?.lua")
		add_entry(root .. "/?/init.lua")
	end

	for entry in tostring(package.path or ""):gmatch("[^;]+") do
		add_entry((entry:gsub("%.lua$", ".clua")))
		add_entry(entry)
	end

	local chunk_dir = type(chunk_name) == "string"
		and chunk_name:match("[/\\]")
		and get_source_dir(chunk_name)
		or nil
	add_root(chunk_dir)
	add_root(COMPILER_ROOT_DIR)
	add_root(".")

	return table.concat(entries, ";")
end

local function search_rocks_tree_semantic(module_name)
	local version = tostring(_VERSION or ""):match("(%d+%.%d+)") or "5.1"
	local module_rel = module_name:gsub("%.", "/")
	local rock_name = module_name:match("^([%a_][%w_]*)") or module_name

	local home = os.getenv("HOME") or os.getenv("USERPROFILE") or ""
	local rock_roots = {
		"./.luarocks/lib/luarocks/rocks-" .. version,
		home ~= "" and (home .. "/.luarocks/lib/luarocks/rocks-" .. version) or nil,
		"/usr/local/lib/luarocks/rocks-" .. version,
		"/usr/lib/luarocks/rocks-" .. version,
	}

	for _, root in ipairs(rock_roots) do
		if root and root ~= "" then
			local package_root = root .. "/" .. rock_name
			local pipe = io.popen('ls -1 "' .. package_root .. '" 2>/dev/null')
			if pipe then
				for version_dir in pipe:lines() do
					if version_dir ~= "" then
						local candidates = {
							package_root .. "/" .. version_dir .. "/" .. module_rel .. ".clua",
							package_root .. "/" .. version_dir .. "/" .. module_rel .. "/init.clua",
						}
						for _, candidate in ipairs(candidates) do
							local file = io.open(candidate, "r")
							if file then
								file:close()
								pipe:close()
								return candidate
							end
						end
					end
				end
				pipe:close()
			end
		end
	end

	return nil
end

local function search_module_path(module_name, search_path)
	local found
	if package.searchpath then
		found = package.searchpath(module_name, search_path)
	else
		local module_fragment = module_name:gsub("%.", "/")
		for entry in search_path:gmatch("[^;]+") do
			local candidate = entry:gsub("%?", module_fragment)
			local file = io.open(candidate, "r")
			if file then
				file:close()
				found = candidate
				break
			end
		end
	end

	if found then
		return found
	end

	return search_rocks_tree_semantic(module_name)
end

local function read_file_text(path)
	local file = io.open(path, "r")
	if not file then
		return nil
	end

	local text = file:read("*a")
	file:close()
	return text
end

-- --------------------------------------------------------------------------
-- Semantic model builder
-- --------------------------------------------------------------------------

local function get_method_overloads_semantic(class_info, method_name)
	if not class_info or not method_name then
		return {}
	end

	return class_info.methods[method_name] or {}
end

local function resolve_class_by_type_semantic(type_name, semantic_model)
	local base_type = get_array_base_type(type_name)
	if not base_type then
		return nil
	end

	return semantic_model.classes[base_type] or semantic_model.imported_classes[base_type] or nil
end

local function infer_expression_type_semantic(expr, semantic_model, class_info, method_context)
	local value = trim(expr or "")
	if value == "" then
		return nil
	end

	local ctor_type = value:match("^new%s+([%a_][%w_%.]*%b<>)%s*%(")
	if not ctor_type then
		ctor_type = value:match("^new%s+([%a_][%w_%.]*)%s*%(")
	end
	if ctor_type then
		return normalize_type_name(ctor_type)
	end

	local literal_type = infer_literal_type(value)
	if literal_type then
		return literal_type
	end

	if value == "self" then
		return class_info and class_info.name or nil
	end

	local field_name = value:match("^self%.([%a_][%w_]*)$")
	if field_name and class_info and class_info.fields[field_name] then
		return class_info.fields[field_name].type_name
	end

	if value:match("^[%a_][%w_]*$") then
		if method_context.params[value] then
			return method_context.params[value]
		end
		if method_context.locals[value] then
			return method_context.locals[value]
		end
		if class_info and class_info.fields[value] then
			return class_info.fields[value].type_name
		end
	end

	return nil
end

local build_semantic_model_from_lines  -- forward declaration (recursive)

build_semantic_model_from_lines = function(lines, chunk_name, module_cache, loading)
	local model = {
		classes = {},
		imports = {},
		imported_classes = {},
	}

	for i = 1, #lines do
		local module_path = lines[i]:match("^%s*import%s+([%a_][%w_%.]*)%s*$")
		if module_path then
			model.imports[#model.imports + 1] = module_path
		end
	end

	local i = 1
	while i <= #lines do
		if lines[i]:match("^%s*class%s+") then
			local class_signature = parse_class_signature(lines[i], i)
			local class_end = find_block_end(lines, i)
			local class_info = {
				name = class_signature.name,
				type_params = class_signature.type_params,
				extends_name = class_signature.extends_name,
				line = i,
				body_end = class_end,
				fields = {},
				methods = {},
			}

			local cursor = i + 1
			while cursor < class_end do
				local line = lines[cursor]
				local stripped = trim(line)
				if stripped == "" or stripped:match("^%-%-") then
					cursor = cursor + 1
				elseif stripped:match("^function%s+") or stripped:match("^local%s+function%s+") then
					local signature = parse_function_signature(line)
					if not signature then
						error(("Invalid class method declaration at line %d"):format(cursor))
					end

					local method_end = find_block_end(lines, cursor)
					local overload = {
						name = signature.name,
						line = cursor,
						body_start = cursor + 1,
						body_end = method_end - 1,
						type_params = parse_generic_param_list(signature.generic_capture, cursor),
						params = parse_semantic_params(signature.params_raw or ""),
					}

					if not class_info.methods[signature.name] then
						class_info.methods[signature.name] = {}
					end
					class_info.methods[signature.name][#class_info.methods[signature.name] + 1] = overload
					cursor = method_end + 1
				else
					local field = parse_semantic_field(line)
					if field then
						class_info.fields[field.name] = field
					end
					cursor = cursor + 1
				end
			end

			model.classes[class_info.name] = class_info
			i = class_end + 1
		else
			i = i + 1
		end
	end

	for _, module_path in ipairs(model.imports) do
		local normalized_module = normalize_import_module_path(module_path)
		if not module_cache[normalized_module] then
			if not loading[normalized_module] then
				loading[normalized_module] = true
				local resolved_path = search_module_path(normalized_module, build_module_search_path(chunk_name))
				if resolved_path then
					local source = read_file_text(resolved_path)
					if source then
						module_cache[normalized_module] = build_semantic_model_from_lines(
							split_lines(source),
							resolved_path,
							module_cache,
							loading
						)
					end
				end
				loading[normalized_module] = nil
			end
		end

		local import_model = module_cache[normalized_module]
		if import_model and import_model.classes then
			for class_name, class_info in pairs(import_model.classes) do
				model.imported_classes[class_name] = class_info
			end
		end
	end

	return model
end

-- --------------------------------------------------------------------------
-- Public entry point: validate method calls in a parsed source file
-- --------------------------------------------------------------------------

local function validate_semantic_method_calls(lines, chunk_name)
	local semantic_model = build_semantic_model_from_lines(lines, chunk_name, {}, {})

	for _, class_info in pairs(semantic_model.classes) do
		for _, overloads in pairs(class_info.methods) do
			for _, method_info in ipairs(overloads) do
				local method_context = {
					params = {},
					locals = {},
				}

				for _, param in ipairs(method_info.params) do
					method_context.params[param.name] = param.type_name
				end

				for line_no = method_info.body_start, method_info.body_end do
					local body_line = lines[line_no]
					local analysis_line = mask_line_for_analysis(body_line)

					for _, method_call in ipairs(extract_self_field_method_calls(body_line, analysis_line)) do
						local field_info = class_info.fields[method_call.field_name]
						if field_info then
							local target_class = resolve_class_by_type_semantic(field_info.type_name, semantic_model)
							local overload_candidates = get_method_overloads_semantic(target_class, method_call.method_name)
							if #overload_candidates > 0 then
								local args = method_call.args_text ~= "" and split_top_level_commas(method_call.args_text) or {}
								if not args then
									args = {}
								end

								local mismatch = nil
								local matched_overload = false
								for _, overload in ipairs(overload_candidates) do
									if #overload.params == #args then
										local type_param_map = build_type_param_map_from_type_ref(field_info.type_name, target_class)
										local overload_matches = true

										for arg_index, arg_expr in ipairs(args) do
											local param_info = overload.params[arg_index]
											local expected_type = apply_type_param_map(param_info.type_name, type_param_map)
											local inferred_type = infer_expression_type_semantic(arg_expr, semantic_model, class_info, method_context)
												or infer_literal_type(arg_expr)

											if not expression_matches_declared_type(inferred_type, expected_type) then
												overload_matches = false
												if not mismatch then
													mismatch = {
														arg_index = arg_index,
														expected_type = expected_type,
														inferred_type = inferred_type,
													}
												end
												break
											end
										end

										if overload_matches then
											matched_overload = true
											break
										end
									end
								end

								if not matched_overload and mismatch then
									local file_label = type(chunk_name) == "string"
										and chunk_name:gsub("^@", "") .. ":"
										or ""
									error((
										"%s%d: Argument %d to %s.%s expects %s, got %s"
									):format(
										file_label,
										line_no,
										mismatch.arg_index,
										field_info.type_name,
										method_call.method_name,
										mismatch.expected_type,
										mismatch.inferred_type or "unknown"
									), 0)
								end
							end
						end
					end

					local local_info = parse_semantic_local(body_line)
					if local_info then
						method_context.locals[local_info.name] = local_info.type_name
							or infer_expression_type_semantic(local_info.default_expr, semantic_model, class_info, method_context)
							or infer_literal_type(local_info.default_expr)
					end
				end
			end
		end
	end
end

local M = {}
M.validate_semantic_method_calls = validate_semantic_method_calls

return M
