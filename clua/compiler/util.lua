-- Shared primitive utilities used by all compiler sub-modules.

local M = {}

function M.trim(s)
	return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

function M.escape_lua_pattern(text)
	return (text:gsub("([^%w])", "%%%1"))
end

function M.split_lines(source)
	local lines = {}
	source = source:gsub("\r\n", "\n")
	for line in (source .. "\n"):gmatch("(.-)\n") do
		lines[#lines + 1] = line
	end
	return lines
end

M.TYPE_NAME_PATTERN = "([%a_][%w_%.%[%]<>%,]*)"

function M.split_top_level_commas(text)
	local parts = {}
	local angle_depth = 0
	local paren_depth = 0
	local bracket_depth = 0
	local string_quote = nil
	local escape_next = false
	local start_idx = 1

	for i = 1, #text do
		local ch = text:sub(i, i)
		if string_quote then
			if escape_next then
				escape_next = false
			elseif ch == "\\" then
				escape_next = true
			elseif ch == string_quote then
				string_quote = nil
			end
		elseif ch == '"' or ch == "'" then
			string_quote = ch
		elseif ch == "<" then
			angle_depth = angle_depth + 1
		elseif ch == ">" then
			angle_depth = angle_depth - 1
			if angle_depth < 0 then
				return nil
			end
		elseif ch == "(" then
			paren_depth = paren_depth + 1
		elseif ch == ")" then
			paren_depth = paren_depth - 1
			if paren_depth < 0 then
				return nil
			end
		elseif ch == "[" then
			bracket_depth = bracket_depth + 1
		elseif ch == "]" then
			bracket_depth = bracket_depth - 1
			if bracket_depth < 0 then
				return nil
			end
		elseif ch == "," and angle_depth == 0 and paren_depth == 0 and bracket_depth == 0 then
			parts[#parts + 1] = M.trim(text:sub(start_idx, i - 1))
			start_idx = i + 1
		end
	end

	if angle_depth ~= 0 or paren_depth ~= 0 or bracket_depth ~= 0 then
		return nil
	end

	parts[#parts + 1] = M.trim(text:sub(start_idx))
	return parts
end

-- Normalises `import std.Foo` → `clua.std.Foo` for runtime require().
function M.normalize_import_module_path(module_path)
	if type(module_path) == "string" and module_path:match("^std%.") then
		return "clua." .. module_path
	end
	return module_path
end

return M
