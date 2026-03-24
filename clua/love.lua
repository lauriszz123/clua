local M = {}
local unpack_args = (table and table.unpack) or unpack

local Love = {
	__name = "Love",
}

local DEFAULT_CALLBACKS = {
	"load",
	"update",
	"draw",
	"quit",
	"focus",
	"resize",
	"mousepressed",
	"mousereleased",
	"mousemoved",
	"wheelmoved",
	"keypressed",
	"keyreleased",
	"textinput",
	"textedited",
	"gamepadpressed",
	"gamepadreleased",
	"joystickadded",
	"joystickremoved",
}

local function resolve_main_class(main_ref)
	if type(main_ref) == "table" then
		return main_ref
	end

	if type(main_ref) == "string" and main_ref ~= "" then
		return require(main_ref)
	end

	error("clua.love.bind expected a class table or module path string", 3)
end

local function instantiate_main(main_class, ctor_args)
	if type(main_class) ~= "table" then
		error("clua.love.bind resolved module did not return a class table", 3)
	end

	local ctor = rawget(main_class, "new")
	if type(ctor) ~= "function" then
		error("clua.love.bind requires Main.new(...) constructor", 3)
	end

	if type(unpack_args) ~= "function" then
		error("clua.love.bind could not find unpack implementation", 3)
	end

	return ctor(unpack_args(ctor_args or {}))
end

local function normalize_callbacks(opts)
	if opts and type(opts.callbacks) == "table" then
		return opts.callbacks
	end
	return DEFAULT_CALLBACKS
end

function M.bind(main_ref, opts)
	opts = opts or {}

	local main_class = resolve_main_class(main_ref)
	local instance = instantiate_main(main_class, opts.args)
	local love_api = opts.love or rawget(_G, "love")

	if type(love_api) ~= "table" then
		error("clua.love.bind expected global love table (run inside LOVE or pass opts.love)", 2)
	end

	local allow_override = opts.override ~= false
	for _, callback_name in ipairs(normalize_callbacks(opts)) do
		local method = instance[callback_name]
		if type(method) == "function" then
			if allow_override or type(love_api[callback_name]) ~= "function" then
				love_api[callback_name] = function(...)
					return method(instance, ...)
				end
			end
		end
	end

	return instance
end

function M.run(main_ref, opts)
	return M.bind(main_ref, opts)
end

M.Love = Love

if rawget(_G, "Love") == nil then
	_G.Love = Love
end

return M
