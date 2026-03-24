local M = {}

local SEP = package.config:sub(1, 1)
local IS_WINDOWS = SEP == "\\"

local function command_ok(ok, why, code)
	if ok == true then
		return true
	end
	if type(ok) == "number" then
		return ok == 0
	end
	return why == "exit" and code == 0
end

local function shell_quote(path)
	return '"' .. tostring(path):gsub('"', '\\"') .. '"'
end

function M.setup_package_path()
	local rootPrefix = "./?.lua;./?/init.lua;"
	if not package.path:find(rootPrefix, 1, true) then
		package.path = rootPrefix .. package.path
	end
end

function M.join_path(...)
	local parts = { ... }
	return table.concat(parts, SEP)
end

function M.mkdir_p(path)
	local parent = tostring(path):match("^(.*)[/\\][^/\\]+$")
	if parent and parent ~= path and parent ~= "" and not parent:match("^[A-Za-z]:$") then
		M.mkdir_p(parent)
	end

	local command
	if IS_WINDOWS then
		command = ("cmd /c if not exist %s mkdir %s"):format(shell_quote(path), shell_quote(path))
	else
		command = ("mkdir -p %s >/dev/null 2>&1"):format(shell_quote(path))
	end

	local ok, why, code = os.execute(command)
	assert(command_ok(ok, why, code), "failed to create directory: " .. tostring(path))
	return path
end

function M.rm_rf(path)
	local command
	if IS_WINDOWS then
		command = ("cmd /c rmdir /s /q %s >NUL 2>NUL"):format(shell_quote(path))
	else
		command = ("rm -rf %s >/dev/null 2>&1"):format(shell_quote(path))
	end
	os.execute(command)
end

function M.write_file(path, content)
	local dir = path:match("^(.*)[/\\][^/\\]+$")
	if dir and dir ~= "" then
		M.mkdir_p(dir)
	end
	local file = assert(io.open(path, "w"))
	file:write(content)
	file:close()
	return path
end

function M.with_temp_dir(fn)
	local base = os.tmpname() .. "_clua_tests"
	os.remove(base)
	M.mkdir_p(base)
	local ok, result = xpcall(function()
		return fn(base)
	end, debug.traceback)
	M.rm_rf(base)
	assert(ok, result)
	return result
end

function M.finish_counts(name, passed, failed, total)
	total = total or (passed + failed)
	print("")
	print(("======================== %s ========================"):format(name))
	print("Tests passed: " .. passed)
	print("Tests failed: " .. failed)
	print("Total: " .. total)
	print("========================================================")
	return failed == 0
end

return M
