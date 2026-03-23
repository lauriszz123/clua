package.path = "./?.lua;./?/init.lua;" .. package.path
local clua = require("clua")

local chunk, err = clua.loadfile("src/main.clua")
if not chunk then
	error(err)
end

local exported = chunk()
if type(exported) == "table" and type(exported.new) == "function" then
	local instance = exported.new()

	if exported.__extends == "Love" then
		local love_callbacks = {
			"load",
			"update",
			"draw",
			"keypressed",
			"keyreleased",
			"textinput",
			"mousepressed",
			"mousereleased",
			"mousemoved",
			"wheelmoved",
			"resize",
			"quit",
			"focus",
			"visible",
			"joystickpressed",
			"joystickreleased",
			"gamepadpressed",
			"gamepadreleased",
			"gamepadaxis",
			"touchpressed",
			"touchreleased",
			"touchmoved",
		}
		for _, cb in ipairs(love_callbacks) do
			if type(instance[cb]) == "function" then
				love[cb] = instance[cb]
			end
		end
	end

	return instance
end

return exported
