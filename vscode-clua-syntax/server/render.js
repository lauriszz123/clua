"use strict";
// Rendering helpers: hover content, parameter display, signature information.

function renderDocsText(docs) {
  if (!docs) {
    return "";
  }

  const parts = [];
  if (docs.description) {
    parts.push(docs.description);
  }

  if (docs.params && docs.params.size > 0) {
    const paramLines = [];
    for (const param of docs.params.values()) {
      const description = param.description ? ` - ${param.description}` : "";
      paramLines.push(`- ${param.name}: ${param.typeName}${description}`);
    }
    parts.push(`Parameters:\n${paramLines.join("\n")}`);
  }

  return parts.join("\n\n");
}

function makeHover(signature, docs) {
  const docText = renderDocsText(docs);
  return {
    contents: {
      kind: "markdown",
      value: docText ? `\`${signature}\`\n\n${docText}` : `\`${signature}\``,
    },
  };
}

function getDisplayParams(methodInfo, docs) {
  const display = [];
  const seen = new Set();
  const typedParams = (methodInfo && methodInfo.params) || [];
  const docParams = docs && docs.params ? docs.params : new Map();

  for (const param of typedParams) {
    const docParam = docParams.get(param.name);
    display.push({
      name: param.name,
      typeName: docParam && docParam.typeName ? docParam.typeName : param.typeName,
      description: docParam && docParam.description ? docParam.description : "",
    });
    seen.add(param.name);
  }

  for (const docParam of docParams.values()) {
    if (seen.has(docParam.name)) {
      continue;
    }
    display.push({
      name: docParam.name,
      typeName: docParam.typeName,
      description: docParam.description || "",
    });
  }

  return display;
}

function buildMethodDisplayLabel(prefix, methodInfo, docs) {
  const displayParams = getDisplayParams(methodInfo, docs);
  const paramsText = displayParams.map((p) => `${p.name}: ${p.typeName}`).join(", ");
  const returnSuffix = methodInfo && methodInfo.returnTypeName ? `: ${methodInfo.returnTypeName}` : "";
  return `${prefix}(${paramsText})${returnSuffix}`;
}

function buildClassHoverData(classInfo) {
  const ctor = classInfo.methods.get("new");
  if (!ctor) {
    return {
      signature: `class ${classInfo.name}${classInfo.extendsName ? ` extends ${classInfo.extendsName}` : ""}`,
      docs: classInfo.docs,
    };
  }
  return {
    signature: buildMethodDisplayLabel(`new ${classInfo.name}`, ctor, ctor.docs),
    docs: ctor.docs && ctor.docs.description ? ctor.docs : classInfo.docs,
  };
}

function buildClassTypeHoverData(classInfo) {
  return {
    signature: `class ${classInfo.name}${classInfo.extendsName ? ` extends ${classInfo.extendsName}` : ""}`,
    docs: classInfo.docs,
  };
}

function buildSignatureInformation(labelPrefix, methodInfo, docs) {
  const params = getDisplayParams(methodInfo, docs);
  const paramLabel = params.map((p) => `${p.name}: ${p.typeName}`).join(", ");
  const label = `${labelPrefix}(${paramLabel})`;
  const parameters = params.map((param) => ({
    label: `${param.name}: ${param.typeName}`,
    documentation: param.description ? param.description : undefined,
  }));

  return {
    label,
    documentation: renderDocsText(docs),
    parameters,
  };
}

module.exports = {
  renderDocsText,
  makeHover,
  getDisplayParams,
  buildMethodDisplayLabel,
  buildClassHoverData,
  buildClassTypeHoverData,
  buildSignatureInformation,
};
