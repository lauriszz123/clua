package = "clua"
version = "scm-1"

source = {
  url = "git+https://github.com/lauriszz123/clua"
}

description = {
  summary = "Minimal typed class transpiler for Lua with on-the-fly .clua loading",
  detailed = [[
clua provides a small compiler and loader for .clua files.
It supports typed class fields/method params and on-the-fly transpilation
for require() once require("clua") has been loaded.
]],
  homepage = "https://github.com/lauriszz123/clua",
  license = "MIT"
}

dependencies = {
  "lua >= 5.1"
}

build = {
  type = "builtin",
  modules = {
    ["clua"] = "clua/init.lua",
    ["clua.compiler"] = "clua/compiler.lua",
    ["clua.runtime"] = "clua/runtime.lua"
  },
  copy_directories = {
    "clua/std"
  }
}
