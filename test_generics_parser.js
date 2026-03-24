#!/usr/bin/env node
// Test suite for CLua generics LSP parser support
// Run with: node test_generics_parser.js

const {
	buildModel,
	isKnownType,
	inferExpressionType,
} = require("./vscode-clua-syntax/server/parser");
const {
	validateTextDocument,
} = require("./vscode-clua-syntax/server/diagnostics");

let passed = 0;
let failed = 0;

function test(name, fn) {
	try {
		fn();
		console.log("✓ " + name);
		passed += 1;
	} catch (err) {
		console.log("✗ " + name + ": " + err.message);
		failed += 1;
	}
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message || "Assertion failed");
	}
}

function eq(a, b, message) {
	if (a !== b) {
		throw new Error((message || "") + ` (expected ${b}, got ${a})`);
	}
}

function has(arr, predicate, message) {
	if (!arr.some(predicate)) {
		throw new Error(message || "Array does not contain expected element");
	}
}

function isEmpty(arr, message) {
	if (arr && arr.length > 0) {
		throw new Error(
			(message || "") + ` (expected empty, got ${arr.length} items)`,
		);
	}
}

// ============================================================================
// Test: Simple generic class model
// ============================================================================
test("Parse simple generic class (Box<T>)", function () {
	const src = `
class Box<T>
  local value: T
  
  function new(v: T)
    self.value = v
  end
end
`;
	const model = buildModel(src);
	assert(model.classes.has("Box"), "Should have Box class");

	const box = model.classes.get("Box");
	assert(Array.isArray(box.typeParams), "Box should have typeParams array");
	eq(box.typeParams.length, 1, "Box should have 1 type parameter");
	eq(box.typeParams[0], "T", "Type parameter should be T");
});

// ============================================================================
// Test: Multi-parameter generic class
// ============================================================================
test("Parse multi-parameter generic (Result<T, U>)", function () {
	const src = `
class Result<T, U>
  local ok: T
  local err: U
end
`;
	const model = buildModel(src);
	const result = model.classes.get("Result");
	assert(result.typeParams);
	eq(result.typeParams.length, 2, "Result should have 2 type parameters");
	eq(result.typeParams[0], "T");
	eq(result.typeParams[1], "U");
});

// ============================================================================
// Test: Generic method parsing
// ============================================================================
test("Parse generic method (function map<T>)", function () {
	const src = `
class Mapper
  function map<T>(v: T): T
    return v
  end
end
`;
	const model = buildModel(src);
	const mapper = model.classes.get("Mapper");
	assert(mapper.methodOverloads.has("map"), "Should have map method");

	const mapOverloads = mapper.methodOverloads.get("map");
	const mapMethod = mapOverloads[0];
	assert(Array.isArray(mapMethod.typeParams), "map should have typeParams");
	eq(mapMethod.typeParams.length, 1, "map should have 1 type parameter");
	eq(mapMethod.typeParams[0], "T", "Type parameter should be T");
});

// ============================================================================
// Test: Generic type in field
// ============================================================================
test("Parse generic type in field", function () {
	const src = `
class Container<T>
  local value: T
end
`;
	const model = buildModel(src);
	const container = model.classes.get("Container");
	assert(container.fields.has("value"), "Should have value field");

	const value = container.fields.get("value");
	eq(value.typeName, "T", "Field should have type T");
});

// ============================================================================
// Test: Generic arrays
// ============================================================================
test("Parse generic arrays (T[])", function () {
	const src = `
class Collection<T>
  local items: T[]
end
`;
	const model = buildModel(src);
	const collection = model.classes.get("Collection");
	const items = collection.fields.get("items");
	eq(items.typeName, "T[]", "Field should have type T[]");
});

// ============================================================================
// Test: Nested generics
// ============================================================================
test("Parse nested generics (Box<T>[])", function () {
	const src = `
class Shelf<T>
  local boxes: Box<T>[]
end
`;
	const model = buildModel(src);
	const shelf = model.classes.get("Shelf");
	const boxes = shelf.fields.get("boxes");
	eq(boxes.typeName, "Box<T>[]", "Field should have type Box<T>[]");
});

// ============================================================================
// Test: Generic extends
// ============================================================================
test("Parse generic extends (MyBox<T> extends Box<T>)", function () {
	const src = `
class MyBox<T> extends Box<T>
end
`;
	const model = buildModel(src);
	const mybox = model.classes.get("MyBox");
	eq(mybox.typeParams.length, 1, "MyBox should have 1 type parameter");
	eq(mybox.extendsName, "Box<T>", "Should extend Box<T>");
});

// ============================================================================
// Test: Diagnostics accept generic type parameters
// ============================================================================
test("Diagnostics treat generic params as known types", function () {
	const src = `
class Box<T>
  local value: T
  
  function new(v: T)
    self.value = v
  end
end
`;
	const doc = { getText: () => src };
	const diags = validateTextDocument(doc, new Map());

	isEmpty(diags, "Should have no diagnostics for valid generics");
});

// ============================================================================
// Test: Diagnostics catch unknown concrete types with generics
// ============================================================================
test("Diagnostics flag unknown concrete types with generics present", function () {
	const src = `
class Box<T>
  local value: T
  local unknown: UnknownType
end
`;
	const doc = { getText: () => src };
	const diags = validateTextDocument(doc, new Map());

	has(
		diags,
		(d) => d.message.includes("Unknown field type UnknownType"),
		"Should flag UnknownType as error",
	);
});

// ============================================================================
// Test: Diagnostics accept generic params in method signatures
// ============================================================================
test("Diagnostics accept generic params in method parameters", function () {
	const src = `
class Box<T>
  value: T
  function set(v: T)
    self.value = v
  end
end
`;
	const doc = { getText: () => src };
	const diags = validateTextDocument(doc, new Map());

	isEmpty(diags, "Should have no diagnostics for generic method params");
});

// ============================================================================
// Test: Diagnostics catch type mismatches with generics
// ============================================================================
test("Diagnostics catch field reassignment with new concrete instance", function () {
	const src = `
class Box<T>
  local value: T
  
  function replace()
    self.value = new Ball()
  end
end
`;
	const doc = { getText: () => src };
	const diags = validateTextDocument(doc, new Map());

	has(
		diags,
		(d) =>
			d.message.includes("Type mismatch") &&
			(d.message.includes("Ball") || d.message.includes("unknown")),
		"Should flag type mismatch for non-generic assignment",
	);
});

// ============================================================================
// Test: isKnownType accepts generic parameters in scope
// ============================================================================
test("isKnownType accepts generic type params in scope", function () {
	const knownTypes = new Set(["number", "string"]);
	const genericParams = new Set(["T", "U"]);

	assert(
		isKnownType("T", knownTypes, genericParams),
		"Should recognize T as known when in genericParams",
	);
	assert(
		isKnownType("U[]", knownTypes, genericParams),
		"Should recognize U[] as known when U is in genericParams",
	);
	assert(
		!isKnownType("Unknown", knownTypes, genericParams),
		"Should reject Unknown type",
	);
});

// ============================================================================
// Test: Multiple generic constraints in same method
// ============================================================================
test("Parse method with multiple generic params", function () {
	const src = `
class Pair<T, U>
  function make(t: T, u: U)
    return self
  end
end
`;
	const model = buildModel(src);
	const pair = model.classes.get("Pair");
	eq(pair.typeParams.length, 2);

	const make = pair.methodOverloads.get("make")[0];
	eq(make.params.length, 2);
	eq(make.params[0].typeName, "T");
	eq(make.params[1].typeName, "U");
});

// ============================================================================
// Test: Generic inference in constructor
// ============================================================================
test("Parse generic class instantiation", function () {
	const src = `
class Test
  function run()
    local b = new Box<number>()
  end
end
`;
	const model = buildModel(src);
	const test = model.classes.get("Test");
	const run = test.methodOverloads.get("run")[0];

	assert(run.locals.has("b"), "Should parse local variable b");
});

// ============================================================================
// Test: Constructor local inference keeps concrete type
// ============================================================================
test("Infer local type from constructor expression", function () {
	const src = `
class Main
  function update()
    local ball = new Ball(1, 2, 3, 4, 5)
  end
end
`;
	const model = buildModel(src);
	const mainClass = model.classes.get("Main");
	const update = mainClass.methodOverloads.get("update")[0];
	assert(update.locals.has("ball"), "Should parse local ball");

	const localBall = update.locals.get("ball");
	eq(localBall.typeName, "Ball", "local ball should infer type Ball");

	const inferred = inferExpressionType(
		"ball",
		model,
		mainClass,
		update,
		new Map(),
	);
	eq(inferred, "Ball", "ball expression should resolve as Ball");
});

// ============================================================================
// Test: Generic arrays with constraints
// ============================================================================
test("Parse complex generic with arrays and nesting", function () {
	const src = `
class Complex<T, U>
  local data: T[][]
  local mapped: Map<T, U>[]
end
`;
	const model = buildModel(src);
	const complex = model.classes.get("Complex");

	const data = complex.fields.get("data");
	eq(data.typeName, "T[][]", "Should handle nested arrays");

	const mapped = complex.fields.get("mapped");
	eq(mapped.typeName, "Map<T,U>[]", "Should handle generic types in arrays");
});

// ============================================================================
// Test: Generic standalone function
// ============================================================================
test("Parse generic standalone function", function () {
	const src = `
function identity<T>(x: T): T
  return x
end
`;
	const model = buildModel(src);
	// Note: Top-level functions not yet tracked in model, just verify compilation
	assert(model, "Should build model without error");
});

// ============================================================================
// Test: Generic with three parameters
// ============================================================================
test("Parse three-parameter generic (T, U, V)", function () {
	const src = `
class Triple<T, U, V>
  a: T
  b: U
  c: V
end
`;
	const model = buildModel(src);
	const triple = model.classes.get("Triple");
	eq(triple.typeParams.length, 3);
	eq(triple.typeParams[0], "T");
	eq(triple.typeParams[1], "U");
	eq(triple.typeParams[2], "V");
});

// ============================================================================
// Test: Method generic shadows class generic
// ============================================================================
test("Method generic param shadows class generic", function () {
	const src = `
class Box<T>
  value: T
  function transform<T>(x: T): T
    return x
  end
end
`;
	const model = buildModel(src);
	const box = model.classes.get("Box");
	eq(box.typeParams[0], "T", "Class has generic T");

	const transform = box.methodOverloads.get("transform")[0];
	eq(transform.typeParams[0], "T", "Method also has generic T (shadows class)");
});

// ============================================================================
// Test: Multiple generic methods in class
// ============================================================================
test("Class with multiple generic methods", function () {
	const src = `
class Converter<T>
  value: T
  function map<U>(other: U): U
    return other
  end
  function fold<U>(initial: U): U
    return initial
  end
end
`;
	const model = buildModel(src);
	const converter = model.classes.get("Converter");

	const hasMap = converter.methodOverloads.has("map");
	const hasFold = converter.methodOverloads.has("fold");
	assert(hasMap, "Should have map method");
	assert(hasFold, "Should have fold method");
});

// ============================================================================
// Test: Generic function type parameter
// ============================================================================
test("Generic with function type parameter", function () {
	const src = `
class Filter<T>
  items: T[]
  function test(item: T): boolean
    return item ~= nil
  end
end
`;
	const model = buildModel(src);
	const filter = model.classes.get("Filter");

	const items = filter.fields.get("items");
	assert(items, "Should have items field");
	eq(items.typeName, "T[]");
});

// ============================================================================
// Test: Diagnostics with multiple generic params
// ============================================================================
test("Diagnostics with multiple generic class params", function () {
	const src = `
class Pair<T, U>
  first: T
  second: U
  function set(t: T, u: U)
    self.first = t
    self.second = u
  end
end
`;
	const doc = { getText: () => src };
	const diags = validateTextDocument(doc, new Map());
	isEmpty(diags, "Should accept multiple generic type params");
});

// ============================================================================
// Test: Unknown member on class-typed generic field
// ============================================================================
test("Diagnostics catch unknown member on class-typed generic field", function () {
	const src = `
class ArrayList<T>
  function add(item: T)
  end
end

class Main
  balls: ArrayList<number>
  function update()
    self.balls.update(1)
  end
end
`;
	const doc = { getText: () => src };
	const diags = validateTextDocument(doc, new Map());
	has(
		diags,
		(d) => d.message.includes("has no member 'update'"),
		"Should report unknown member update",
	);
});

// ============================================================================
// Test: Generic in nested scope
// ============================================================================
test("Generic type in nested class context", function () {
	const src = `
class Container<T>
  items: T[]
  function getFirst()
    return self.items[1]
  end
end
`;
	const model = buildModel(src);
	const container = model.classes.get("Container");

	const items = container.fields.get("items");
	assert(items, "Should have items field");
	eq(items.typeName, "T[]", "items should have generic array type");
});

// ============================================================================
// Test: Mixed generic and concrete types
// ============================================================================
test("Class with mixed generic and concrete field types", function () {
	const src = `
class Tagged<T>
  value: T
  count: number
  name: string
end
`;
	const model = buildModel(src);
	const tagged = model.classes.get("Tagged");

	const value = tagged.fields.get("value");
	const count = tagged.fields.get("count");
	const name = tagged.fields.get("name");

	eq(value.typeName, "T");
	eq(count.typeName, "number");
	eq(name.typeName, "string");
});

// ============================================================================
// Test: function type return annotation does not break block parsing
// ============================================================================
test("Iterator return annotation keeps class block balanced", function () {
	const src = `
class ArrayList<T>
  local items: T[]

  function iter(): function(): T
    local i = 0
    return function()
      i = i + 1
      if i <= #self.items then
        return self.items[i]
      end
    end
  end
end

class Main
  balls: ArrayList<number>
  function update()
    self.balls.iter()
  end
end
`;
	const model = buildModel(src);
	const arrayList = model.classes.get("ArrayList");
	const main = model.classes.get("Main");

	assert(arrayList, "Should parse ArrayList class");
	assert(main, "Should parse Main class after ArrayList");
	assert(arrayList.methodOverloads.has("iter"), "Should parse iter method");
});

// ============================================================================
// Test: for-in loop variable infers concrete generic element type
// ============================================================================
test("For-in loop variable resolves from ArrayList<T>.iter()", function () {
	const src = `
class Ball
  function update(dt)
  end
end

class ArrayList<T>
  function iter(): function(): T
    return function()
      return nil
    end
  end
end

class Main
  balls: ArrayList<Ball>
  function update(dt)
    for ball in self.balls.iter() do
      ball.update(dt)
    end
  end
end
`;

	const model = buildModel(src);
	const main = model.classes.get("Main");
	const update = main.methodOverloads.get("update")[0];

	assert(
		update.locals.has("ball"),
		"Loop variable ball should be available in method locals",
	);
	eq(
		update.locals.get("ball").typeName,
		"Ball",
		"Loop variable ball should infer Ball type",
	);

	const inferred = inferExpressionType("ball", model, main, update, new Map());
	eq(inferred, "Ball", "Expression type for ball should resolve to Ball");
});

// ============================================================================
// Print summary
// ============================================================================
console.log("");
console.log("========================");
console.log("Tests passed: " + passed);
console.log("Tests failed: " + failed);
console.log("Total: " + (passed + failed));
console.log("========================");

process.exit(failed > 0 ? 1 : 0);
