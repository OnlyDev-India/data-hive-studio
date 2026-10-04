import {
  fitsInt32,
  valueText,
  type CodeInput,
  type Ext,
  type Syntax,
} from "./values";

const isIdent = (k: string) => /^[A-Za-z_$][\w$]*$/.test(k);

function special(n: string, inf: string, nan: string): string | null {
  if (n === "Infinity") return inf;
  if (n === "-Infinity") return `-${inf}`;
  if (n === "NaN") return nan;
  return null;
}

/** "a.b" keeps a point, so a double reads back as a double. */
const doubleText = (n: string) => (/^-?\d+$/.test(n) ? `${n}.0` : n);

const NODE: Syntax = {
  indent: "  ",
  key: (k) => (isIdent(k) ? k : JSON.stringify(k)),
  literal: { null: "null", true: "true", false: "false" },
  ext(e: Ext, need) {
    const make = (name: string, args: string) => {
      need(name);
      return `new ${name}(${args})`;
    };
    switch (e.t) {
      case "oid":
        return make("ObjectId", JSON.stringify(e.hex));
      case "date":
        return `new Date(${JSON.stringify(new Date(e.ms).toISOString())})`;
      case "long":
        if (fitsInt32(e.n)) return e.n;
        need("Long");
        return `Long.fromString(${JSON.stringify(e.n)})`;
      case "int":
        return e.n;
      case "double":
        return special(e.n, "Infinity", "NaN") ?? doubleText(e.n);
      case "decimal":
        need("Decimal128");
        return `Decimal128.fromString(${JSON.stringify(e.n)})`;
      case "regex":
        return make(
          "BSONRegExp",
          `${JSON.stringify(e.pattern)}, ${JSON.stringify(e.options)}`,
        );
      case "binary":
        return make(
          "Binary",
          `Buffer.from(${JSON.stringify(e.base64)}, "base64"), ${e.subType}`,
        );
      case "timestamp":
        return make("Timestamp", `{ t: ${e.time}, i: ${e.inc} }`);
      case "minKey":
        return make("MinKey", "");
      case "maxKey":
        return make("MaxKey", "");
    }
  },
};

const PYTHON: Syntax = {
  indent: "    ",
  key: (k) => JSON.stringify(k),
  literal: { null: "None", true: "True", false: "False" },
  ext(e: Ext, need) {
    const make = (name: string, args: string) => {
      need(`bson:${name}`);
      return `${name}(${args})`;
    };
    switch (e.t) {
      case "oid":
        return make("ObjectId", JSON.stringify(e.hex));
      case "date": {
        need("datetime");
        const d = new Date(e.ms);
        const parts = [
          d.getUTCFullYear(),
          d.getUTCMonth() + 1,
          d.getUTCDate(),
          d.getUTCHours(),
          d.getUTCMinutes(),
          d.getUTCSeconds(),
          ...(d.getUTCMilliseconds() ? [d.getUTCMilliseconds() * 1000] : []),
        ];
        return `datetime(${parts.join(", ")}, tzinfo=timezone.utc)`;
      }
      case "long":
        return fitsInt32(e.n) ? e.n : make("Int64", e.n);
      case "int":
        return e.n;
      case "double":
        return special(e.n, 'float("inf")', 'float("nan")') ?? doubleText(e.n);
      case "decimal":
        return make("Decimal128", JSON.stringify(e.n));
      case "regex":
        return make(
          "Regex",
          `${JSON.stringify(e.pattern)}, ${JSON.stringify(e.options)}`,
        );
      case "binary":
        need("base64");
        return make(
          "Binary",
          `base64.b64decode(${JSON.stringify(e.base64)}), ${e.subType}`,
        );
      case "timestamp":
        return make("Timestamp", `${e.time}, ${e.inc}`);
      case "minKey":
        return make("MinKey", "");
      case "maxKey":
        return make("MaxKey", "");
    }
  },
};

/** Each stage's text at one level in, with its comment lines before it. */
function stageLines(
  input: CodeInput,
  indent: string,
  comment: string,
  text: (stage: unknown) => string,
  trailing: boolean,
): string {
  const last = input.stages.length - 1;
  return input.stages
    .map(({ stage, comments }, i) => {
      const lines = comments.map((c) => `${indent}${comment} ${c}`.trimEnd());
      const comma = trailing || i < last ? "," : "";
      lines.push(`${indent}${text(stage)}${comma}`);
      return lines.join("\n");
    })
    .join("\n");
}

export function nodeCode(input: CodeInput): string {
  const used = new Set<string>();
  const body = stageLines(
    input,
    "  ",
    "//",
    (s) => valueText(s, 1, NODE, (n) => used.add(n)),
    true,
  );
  const head = used.size
    ? `import { ${[...used].sort().join(", ")} } from "mongodb";\n\n`
    : "";
  return `${head}const cursor = db.collection(${JSON.stringify(input.collection)}).aggregate([\n${body}\n]);\n`;
}

export function pythonCode(input: CodeInput): string {
  const used = new Set<string>();
  const body = stageLines(
    input,
    "    ",
    "#",
    (s) => valueText(s, 1, PYTHON, (n) => used.add(n)),
    true,
  );
  const head: string[] = [];
  if (used.has("base64")) head.push("import base64");
  if (used.has("datetime"))
    head.push("from datetime import datetime, timezone");
  const bson = [...used]
    .filter((n) => n.startsWith("bson:"))
    .map((n) => n.slice(5))
    .sort();
  if (bson.length) head.push(`from bson import ${bson.join(", ")}`);
  const top = head.length ? `${head.join("\n")}\n\n` : "";
  return `${top}cursor = db[${JSON.stringify(input.collection)}].aggregate([\n${body}\n])\n`;
}

/** Canonical extended JSON keeps every type for the drivers that parse it. */
const canonical = (stage: unknown) => JSON.stringify(stage);

export function javaCode(input: CodeInput): string {
  const body = stageLines(
    input,
    "    ",
    "//",
    (s) => `Document.parse(${JSON.stringify(canonical(s))})`,
    false,
  );
  return [
    "import java.util.Arrays;",
    "import com.mongodb.client.AggregateIterable;",
    "import org.bson.Document;",
    "",
    `AggregateIterable<Document> result = db.getCollection(${JSON.stringify(input.collection)}).aggregate(Arrays.asList(`,
    body,
    "));",
    "",
  ].join("\n");
}

export function goCode(input: CodeInput): string {
  const notes = input.stages.flatMap(({ comments }, i) =>
    comments.length
      ? [
          `// Stage ${i + 1}: ${comments[0]}`,
          ...comments.slice(1).map((c) => `// ${c}`.trimEnd()),
        ]
      : [],
  );
  const json = `[\n${input.stages.map((s) => `  ${canonical(s.stage)}`).join(",\n")}\n]`;
  const literal = json.includes("`") ? JSON.stringify(json) : `\`${json}\``;
  return [
    ...notes,
    `pipelineJSON := ${literal}`,
    "var pipeline []bson.D",
    "if err := bson.UnmarshalExtJSON([]byte(pipelineJSON), true, &pipeline); err != nil {",
    "\tlog.Fatal(err)",
    "}",
    `cursor, err := db.Collection(${JSON.stringify(input.collection)}).Aggregate(ctx, pipeline)`,
    "",
  ].join("\n");
}
