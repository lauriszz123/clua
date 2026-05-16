# clua

[![CI](https://github.com/lauriszz123/clua/actions/workflows/ci.yml/badge.svg)](https://github.com/lauriszz123/clua/actions/workflows/ci.yml)

Minimal typed class transpiler for Lua with on-the-fly `.clua` loading.

## Architecture

This repository is organized into four cooperating layers. New contributors
should pick the layer that matches the change they want to make:

| Layer | Path | Purpose |
| --- | --- | --- |
| Compiler | [clua/compiler/](clua/compiler/) | Parser, semantic analyzer, type system, and code generator that transpile `.clua` source into Lua. |
| Runtime / loader | [clua/init.lua](clua/init.lua), [clua/runtime.lua](clua/runtime.lua) | Installs the `require` hook so `.clua` modules transpile and load on demand. Entry point for end users (`require("clua")`). |
| Standard library | [clua/std/](clua/std/) | Portable, runtime-agnostic `.clua` modules (`List`, `HashMap`, `Option`, `Result`, ...) shipped via the rockspec. |
| Love2D integration | [clua/love.lua](clua/love.lua) | Optional bridge that wires a CLua class to Love2D callbacks (`love.load`, `love.update`, `love.draw`, ...). Only loaded when the host explicitly requires it. |
| Editor tooling | [vscode-clua-syntax/](vscode-clua-syntax/) | Self-contained VS Code extension: TextMate grammar, snippets, and a Node-based language server (completion, diagnostics, hover, definitions, formatting). Has its own `package.json` and test suite and does not depend on the Lua runtime at build time. |

The core compiler, runtime, and stdlib are distributed together through the
[`clua-scm-1.rockspec`](clua-scm-1.rockspec). The Love2D bridge and the VS Code
extension are independent surfaces that build on top of the core but can be
shipped, versioned, and tested separately.

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
- `try/catch` lowering to `pcall(...)`
- `require("module")` can load `module.clua` directly once `require("clua")` is called

## Portable Standard Library

These modules are runtime-agnostic and build on plain Lua primitives:

- `import std.ArrayList`
- `import std.List`
- `import std.HashMap`
- `import std.Option`
- `import std.Result`

Example:

```clua
import std.HashMap
import std.Option

class App
  function new()
    local m: HashMap<string, number>
    m = new HashMap<string, number>()
    m.set("users", 10)

    local maybe: Option<number>
    maybe = new Option<number>(m.get("users"))
    print(maybe.unwrapOr(0))
  end
end
```

## Syntax

```clua
class Test
    var x: number

    function new(x: number)
        self.x = x
    end
end
```

`try/catch/finally` example:

```clua
function readConfig(): string
  try
    error("missing config")
  catch err
    print("recovering from: " .. tostring(err))
    return "default"
  finally
    print("cleanup")
  end
end
```

`try/finally` without `catch` is also supported:

```clua
function withCleanup()
  try
    print("work")
  finally
    print("always runs")
  end
end
```

`try/catch/finally` is useful for bridging Lua errors, while `Option` and `Result` are still useful for explicit, typed control flow in application code.

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

## Love2D Main Class Wrapper

You can wire Love callbacks from a CLua class automatically.

`main.lua`:

```lua
require("clua")
local love_bridge = require("clua.love")

-- Loads src/Main.clua, creates Main.new(), and binds callbacks like
-- love.load, love.update, love.draw, love.keypressed, etc.
love_bridge.bind("src.Main")
```

`src/Main.clua`:

```clua
class Main extends Love
  function new()
    self.time = 0
  end

  function update(dt: number)
    self.time = self.time + dt
  end

  function draw()
    love.graphics.print("time: " .. tostring(self.time), 10, 10)
  end
end
```

`extends Love` is a marker type for editor/runtime conventions. The bridge binds methods by name from the created `Main` instance.

## Notes

- You must call `require("clua")` before requiring `.clua` modules.
- Imports like `import std.List` are resolved against installed module trees (global LuaRocks, project `.luarocks`, and common project folders like `lib/` and `vendor/`).
- This is intentionally minimal and line-based, so class bodies should contain only field declarations and methods.
- Inheritance is not supported yet.

## Tests

- CLua runtime/compiler suites: `lua tests/lua/run_all.lua`
- VS Code language server and language asset suites: `cd vscode-clua-syntax && npm test`

Both suites run on every push and pull request via [GitHub Actions](.github/workflows/ci.yml),
covering Lua 5.1, 5.4, and LuaJIT 2.1 for the runtime, and Node.js 20 and 22 for
the VS Code extension. The workflow also lints the rockspec, performs a
`luarocks make` install test, and produces a VSIX packaging smoke build.

## Releases and build artifacts

Generated artifacts are intentionally not committed:

- `vscode-clua-syntax/node_modules/` is reproduced from `package-lock.json` with `npm ci`.
- `vscode-clua-syntax/clua-syntax.vsix` is built on demand with `npm run package:out` (or downloaded from the CI workflow's `clua-syntax-vsix` artifact).
- A locally installed LuaRocks tree under `lib/` (see install instructions above) is also ignored.

If you cloned the repo before these were removed, run
`git clean -fdX vscode-clua-syntax` to drop any leftover ignored files.
