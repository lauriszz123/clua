local compiler = require("clua.compiler")

local M = {}

local function read_file(path)
	local file, open_err = io.open(path, "rb")
	if not file then
		return nil, open_err
	end

	local content = file:read("*a")
	file:close()
	return content
end

local function compat_load(source, chunk_name, env)
	if _VERSION == "Lua 5.1" then
		local fn, err = loadstring(source, chunk_name)
		if not fn then
			return nil, err
		end
		if env then
			setfenv(fn, env)
		end
		return fn
	end

	return load(source, chunk_name, "t", env or _G)
end

function M.compile(source, chunk_name)
	return compiler.compile(source, chunk_name)
end

function M.loadstring(source, chunk_name, env)
	local compiled = M.compile(source, chunk_name)
	return compat_load(compiled, chunk_name, env)
end

function M.loadfile(path, env)
	local source, read_err = read_file(path)
	if not source then
		return nil, read_err
	end

	local chunk_name = "@" .. path
	local compiled = M.compile(source, chunk_name)
	return compat_load(compiled, chunk_name, env)
end

local function default_clua_path()
	local lua_path = package.path or ""
	local patterns = {
		lua_path:gsub("%.lua", ".clua"),
		"./src/?.clua;./src/?/init.clua",
		"./?.clua;./?/init.clua",
	}
	return table.concat(patterns, ";")
end

local function import_aliases_for(module_name)
	if type(module_name) == "string" and module_name:match("^std%.") then
		return { module_name, "clua." .. module_name }
	end
	return { module_name }
end

function M.make_searcher(opts)
	opts = opts or {}
	local clua_path = opts.path or default_clua_path()

	return function(module_name)
		local errors = {}
		for _, candidate_name in ipairs(import_aliases_for(module_name)) do
			local module_file, search_err = package.searchpath(candidate_name, clua_path)
			if module_file then
				local chunk, load_err = M.loadfile(module_file)
				if not chunk then
					return load_err
				end

				return chunk, module_file
			end
			if search_err and search_err ~= "" then
				errors[#errors + 1] = search_err
			end
		end

		return table.concat(errors)
	end
end

function M.install_loader(opts)
	local searchers
	if _VERSION == "Lua 5.1" then
		searchers = rawget(package, "loaders")
	else
		searchers = rawget(package, "searchers")
	end

	if not searchers then
		searchers = rawget(package, "loaders") or rawget(package, "searchers")
	end

	if not searchers then
		error("Current Lua runtime does not expose package.searchers/package.loaders")
	end

	if M._loader_installed then
		return false
	end

	local searcher = M.make_searcher(opts)
	table.insert(searchers, 1, searcher)
	M._loader_installed = true
	return true
end

M.install_loader()

return M
