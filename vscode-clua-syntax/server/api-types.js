"use strict";

const PRIMITIVE_TYPES = new Set([
  "any",
  "nil",
  "boolean",
  "number",
  "string",
  "table",
  "function",
  "thread",
  "userdata",
  "file",
]);

function primitive(name) {
  return { kind: "primitive", name };
}

function named(name) {
  return { kind: "named", name };
}

function union(...types) {
  return { kind: "union", types };
}

function optional(type) {
  return { kind: "optional", type };
}

function variadic(type) {
  return { kind: "variadic", type };
}

function isTypeSpec(value) {
  return value && typeof value === "object" && typeof value.kind === "string";
}

function assertString(value, fieldPath) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldPath} must be a non-empty string`);
  }
}

function validateTypeSpec(typeSpec, fieldPath) {
  if (!isTypeSpec(typeSpec)) {
    throw new Error(`${fieldPath} must be a type spec object`);
  }

  if (typeSpec.kind === "primitive") {
    assertString(typeSpec.name, `${fieldPath}.name`);
    if (!PRIMITIVE_TYPES.has(typeSpec.name)) {
      throw new Error(`${fieldPath}.name uses unknown primitive: ${typeSpec.name}`);
    }
    return;
  }

  if (typeSpec.kind === "named") {
    assertString(typeSpec.name, `${fieldPath}.name`);
    return;
  }

  if (typeSpec.kind === "union") {
    if (!Array.isArray(typeSpec.types) || typeSpec.types.length < 2) {
      throw new Error(`${fieldPath}.types must be an array with at least 2 entries`);
    }
    for (let i = 0; i < typeSpec.types.length; i += 1) {
      validateTypeSpec(typeSpec.types[i], `${fieldPath}.types[${i}]`);
    }
    return;
  }

  if (typeSpec.kind === "optional") {
    validateTypeSpec(typeSpec.type, `${fieldPath}.type`);
    return;
  }

  if (typeSpec.kind === "variadic") {
    validateTypeSpec(typeSpec.type, `${fieldPath}.type`);
    return;
  }

  throw new Error(`${fieldPath}.kind has unknown value: ${typeSpec.kind}`);
}

function typeSpecToTypeName(typeSpec) {
  switch (typeSpec.kind) {
    case "primitive":
    case "named":
      return typeSpec.name;
    case "union":
      return typeSpec.types.map(typeSpecToTypeName).join("|");
    case "optional":
      return `${typeSpecToTypeName(typeSpec.type)}?`;
    case "variadic":
      return `...${typeSpecToTypeName(typeSpec.type)}`;
    default:
      return "any";
  }
}

function parseTypeName(typeName) {
  if (typeof typeName !== "string" || typeName.length === 0) {
    throw new Error(`typeName must be a non-empty string`);
  }

  if (typeName.startsWith("...")) {
    const inner = typeName.slice(3) || "any";
    return variadic(parseTypeName(inner));
  }

  if (typeName.endsWith("?")) {
    const inner = typeName.slice(0, -1);
    return optional(parseTypeName(inner));
  }

  if (typeName.includes("|")) {
    const parts = typeName.split("|").map((p) => p.trim());
    if (parts.length < 2) {
      throw new Error(`invalid union typeName: ${typeName}`);
    }
    return union(...parts.map(parseTypeName));
  }

  if (PRIMITIVE_TYPES.has(typeName)) {
    return primitive(typeName);
  }

  return named(typeName);
}

function parseSignatureParams(signature) {
  const open = signature.indexOf("(");
  const close = signature.indexOf(")");
  if (open < 0 || close < 0 || close <= open) {
    return [];
  }

  const str = signature.slice(open + 1, close);
  const results = [];

  function helper(input, optionalContext) {
    let i = 0;
    let token = "";

    while (i < input.length) {
      const ch = input[i];
      if (ch === "[") {
        // commit any current token first
        if (token.trim()) {
          results.push({ name: token.trim(), optional: optionalContext });
          token = "";
        }

        // find matching ']' for nested optional group
        let depth = 1;
        let start = i + 1;
        i += 1;
        while (i < input.length && depth > 0) {
          if (input[i] === "[") {
            depth += 1;
          } else if (input[i] === "]") {
            depth -= 1;
          }
          i += 1;
        }

        const inner = input.slice(start, i - 1);
        helper(inner, true);
        token = "";
        continue;
      }

      if (ch === "]") {
        // should not happen in well-formed input
        i += 1;
        continue;
      }

      if (ch === ",") {
        if (token.trim()) {
          results.push({ name: token.trim(), optional: optionalContext });
          token = "";
        }
        i += 1;
        continue;
      }

      token += ch;
      i += 1;
    }

    if (token.trim()) {
      results.push({ name: token.trim(), optional: optionalContext });
    }
  }

  helper(str, false);
  return results;
}

function normalizeParam(param, fieldPath, isOptional = false) {
  if (!param || typeof param !== "object") {
    throw new Error(`${fieldPath} must be an object`);
  }

  assertString(param.name, `${fieldPath}.name`);
  assertString(param.doc, `${fieldPath}.doc`);

  let typeSpec = null;
  if (param.type) {
    typeSpec = param.type;
  } else if (param.typeName) {
    typeSpec = parseTypeName(param.typeName);
  } else if (param.name === "...") {
    typeSpec = variadic(primitive("any"));
  } else {
    throw new Error(`${fieldPath} must have type or typeName`);
  }

  if (param.name === "...") {
    // variadic parameter
    if (typeSpec.kind !== "variadic") {
      typeSpec = variadic(typeSpec);
    }
  }

  if (isOptional && typeSpec.kind !== "optional" && typeSpec.kind !== "variadic") {
    typeSpec = optional(typeSpec);
  }

  validateTypeSpec(typeSpec, `${fieldPath}.type`);

  return {
    name: param.name,
    doc: param.doc,
    type: typeSpec,
    typeName: typeSpecToTypeName(typeSpec),
  };
}

function normalizeApiEntry(entry, fieldPath) {
  if (!entry || typeof entry !== "object") {
    throw new Error(`${fieldPath} must be an object`);
  }

  assertString(entry.signature, `${fieldPath}.signature`);
  assertString(entry.doc, `${fieldPath}.doc`);

  const params = Array.isArray(entry.params) ? entry.params : [];
  const signatureParams = parseSignatureParams(entry.signature);
  const normalizedParams = params.map((param, index) => {
    const optional = signatureParams[index] ? signatureParams[index].optional : false;
    return normalizeParam(param, `${fieldPath}.params[${index}]`, optional);
  });

  return {
    signature: entry.signature,
    doc: entry.doc,
    params: normalizedParams,
  };
}

function normalizeApiMap(map, fieldPath) {
  const out = {};

  for (const [name, value] of Object.entries(map || {})) {
    out[name] = normalizeApiEntry(value, `${fieldPath}.${name}`);
  }

  return out;
}

function normalizeLibraryMap(libs, fieldPath) {
  const out = {};

  for (const [libName, methods] of Object.entries(libs || {})) {
    const normalizedMethods = {};
    for (const [methodName, entry] of Object.entries(methods || {})) {
      normalizedMethods[methodName] = normalizeApiEntry(
        entry,
        `${fieldPath}.${libName}.${methodName}`,
      );
    }
    out[libName] = normalizedMethods;
  }

  return out;
}

module.exports = {
  PRIMITIVE_TYPES,
  primitive,
  named,
  union,
  optional,
  variadic,
  typeSpecToTypeName,
  normalizeApiMap,
  normalizeLibraryMap,
};