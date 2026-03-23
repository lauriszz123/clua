# CLua Syntax (VS Code)

This folder contains a minimal VS Code language package for `.clua` files.

## Included

- Language id: `clua`
- File extension: `.clua`
- TextMate grammar for:
  - `class`, `var`, `extends`
  - function declarations
  - typed declarations (`name: Type`)
  - comments, strings, numbers, operators, constants
- Snippets for class, method, var, typed local, and runtime assert

## Snippets

In a `.clua` file, trigger these prefixes:

1. `class`
1. `method`
1. `var`
1. `localt`
1. `assertt`

## Use it

1. Open this folder as a separate VS Code extension workspace:
   - `clua/vscode-clua-syntax`
2. Press `F5` to launch an Extension Development Host.
3. Open your main project in that host and edit `.clua` files.

## Package as VSIX

1. Open a terminal in `clua/vscode-clua-syntax`.
1. Run `npm install`.
1. Run `npm run package:out`.
1. In VS Code, run "Extensions: Install from VSIX..." and pick `clua-syntax.vsix`.

## Notes

- The main project workspace already maps `*.clua` to `clua` in `.vscode/settings.json`.
- This package is minimal and can be expanded later with snippets and richer scopes.

## About typechecking in editor

This extension now includes a minimal CLua language server (LSP) for live diagnostics.

Current live checks:

1. Unknown field types and unknown method parameter types.
1. Duplicate class names.
1. Unknown base class in `extends`.
1. Literal type mismatches in field defaults.
1. Literal type mismatches in `self.field = ...` assignments.

Current editor intelligence:

1. Autocomplete for CLua keywords, types, class names, and `self.` members.
1. Hover type info for classes, fields, methods, and typed parameters.
1. Go to definition for class names and class members, including cross-file member targets from typed receiver chains like `self.point.move()`.
1. Workspace symbol search for CLua classes, methods, and fields.

How to run the LSP in VS Code:

1. Open `clua/vscode-clua-syntax` in VS Code.
1. Press `F5` to launch the Extension Development Host.
1. Open your project in the host and edit `.clua` files.
1. See diagnostics in the Problems panel while you type.

The runtime CLua checks are still active when code executes; this LSP adds editor-time feedback.
