# clua

Minimal typed class transpiler for Lua with on-the-fly `.clua` loading.

## Install (LuaRocks)

From this repository:

```bash
luarocks make clua-scm-1.rockspec
```

For local development, prefer `luarocks make` over installing a packed `scm` source rock. An `scm` rock built with `luarocks pack clua-scm-1.rockspec` is generated from `source.url`, so it may not include unpushed local changes.

For project-local installs (recommended for editor/LSP resolution in any workspace):

```bash
luarocks --tree ./lib make clua-scm-1.rockspec
```

This installs modules under paths such as `lib/share/lua/5.4/...` that the CLua language server resolves automatically.

Then in Lua:

```lua
require("clua")
```

Create a source rock locally:

```bash
luarocks pack clua-scm-1.rockspec
```

## Publish Notes

- The rockspec file is `clua-scm-1.rockspec`.
- Before publishing to LuaRocks, update `source.url` and `description.homepage`
  in the rockspec if your canonical repository URL differs.
- For a stable release, add a versioned rockspec such as `clua-0.1.0-1.rockspec`
  pointing at a tagged release archive.

## What it supports

- `class Name`
- Typed fields inside class blocks (for example `var x: number`)
- Typed method parameters inside class blocks
- `function new(...)` constructor lowering to `Class.new(...)`
- `require("module")` can load `module.clua` directly once `require("clua")` is called

## Syntax

```clua
class Test
    var x: number

    function new(x: number)
        self.x = x
    end
end
```

## Love2D setup

In your `main.lua`, load clua first:

```lua
require("clua")

local Test = require("Test") -- loads Test.clua automatically

function love.load()
  local t = Test.new(10)
  print(t.x)
end
```

## Notes

- You must call `require("clua")` before requiring `.clua` modules.
- Imports like `import std.List` are resolved against installed module trees (global LuaRocks, project `.luarocks`, and common project folders like `lib/` and `vendor/`).
- This is intentionally minimal and line-based, so class bodies should contain only field declarations and methods.
- Inheritance is not supported yet.
