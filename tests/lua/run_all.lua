local suites = {
	"tests/lua/generics_compiler.lua",
	"tests/lua/generics_integration.lua",
	"tests/lua/love_wrapper.lua",
	"tests/lua/try_catch.lua",
}

package.path = "./?.lua;./?/init.lua;" .. package.path

local failures = 0

for _, suitePath in ipairs(suites) do
	print(("\n>>> Running %s"):format(suitePath))
	local ok, result = xpcall(function()
		return dofile(suitePath)
	end, debug.traceback)
	if not ok then
		print(("FAIL %s\n%s"):format(suitePath, tostring(result)))
		failures = failures + 1
	elseif result == false then
		print(("FAIL %s"):format(suitePath))
		failures = failures + 1
	else
		print(("PASS %s"):format(suitePath))
	end
end

os.exit(failures == 0 and 0 or 1)
