export type FormField = {
  id: string;
  label: string;
  type: "string" | "long" | "boolean" | "enum" | "date";
  required: boolean;
  readonly: boolean;
  defaultValue: string | null;
  options: { id: string; label: string }[];
};

export type ParsedForms = {
  startFields: FormField[];
  taskFields: Record<string, FormField[]>;
};

const ELEMENT_RE =
  /<(?:[\w.-]+:)?(startEvent|userTask)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?\1>)/g;
const FIELD_RE =
  /<(?:[\w.-]+:)?formField\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?formField>)/g;

export function parseBpmnForms(xml: string): ParsedForms {
  const startFields: FormField[] = [];
  const taskFields: Record<string, FormField[]> = {};

  for (const match of xml.matchAll(ELEMENT_RE)) {
    const kind = match[1];
    const attrs = match[2] ?? "";
    const inner = match[3] ?? "";
    const fields = parseFields(inner);
    if (kind === "startEvent") {
      startFields.push(...fields);
      continue;
    }
    const id = attribute(attrs, "id");
    if (id) taskFields[id] = fields;
  }

  return { startFields, taskFields };
}

function parseFields(inner: string): FormField[] {
  const fields: FormField[] = [];
  for (const match of inner.matchAll(FIELD_RE)) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const id = attribute(attrs, "id");
    if (!id) continue;
    const rawType = attribute(attrs, "type") ?? "string";
    const constraints = [...body.matchAll(/\bname="(required|readonly)"/g)].map((item) => item[1]);
    fields.push({
      id,
      label: attribute(attrs, "label") ?? id,
      type: normalizeType(rawType),
      required: constraints.includes("required"),
      readonly: constraints.includes("readonly"),
      defaultValue: attribute(attrs, "defaultValue"),
      options: parseOptions(body),
    });
  }
  return fields;
}

function parseOptions(body: string) {
  const options: { id: string; label: string }[] = [];
  const valueRe = /<(?:[\w.-]+:)?value\b([^>]*?)\/?>/g;
  for (const match of body.matchAll(valueRe)) {
    const attrs = match[1] ?? "";
    const id = attribute(attrs, "id");
    if (!id) continue;
    options.push({ id, label: attribute(attrs, "name") ?? id });
  }
  return options;
}

function normalizeType(type: string): FormField["type"] {
  if (type === "long" || type === "boolean" || type === "enum" || type === "date") return type;
  return "string";
}

function attribute(source: string, name: string) {
  const match = source.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decode(match[1]) : null;
}

function decode(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
