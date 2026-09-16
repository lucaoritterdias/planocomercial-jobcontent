/**
 * Ajusta uma resposta da IA aos LIMITES do JSON Schema (maxLength,
 * maxItems, minimum/maximum) antes da validação Zod.
 *
 * O modo "Structured Outputs" (strict: true) da OpenAI garante a
 * estrutura (campos, tipos, enums), mas NÃO impõe maxLength de string —
 * um único texto 10 caracteres acima do limite fazia o plano inteiro ser
 * rejeitado. Cortar o excesso é muito melhor do que perder a resposta.
 *
 * Só corrige limites; nunca inventa campo, nunca troca tipo. O que não
 * dá para corrigir aqui (ex.: campo faltando) continua sendo rejeitado
 * pelo `schema.safeParse()` em src/lib/ai/client.ts.
 */

type JsonSchemaNode = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  maxLength?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
};

const ELLIPSIS = "…";

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= ELLIPSIS.length) return text.slice(0, maxLength);

  const hardCut = text.slice(0, maxLength - ELLIPSIS.length);
  const lastSpace = hardCut.lastIndexOf(" ");
  // Corta na última palavra inteira quando isso não joga fora texto demais.
  const cut = lastSpace > hardCut.length * 0.6 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${cut.replace(/[\s,;:.–-]+$/, "")}${ELLIPSIS}`;
}

function matchesType(node: JsonSchemaNode, value: unknown): boolean {
  if (!node.type) return true;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  return types.some((type) => {
    switch (type) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number";
      case "integer":
        return typeof value === "number" && Number.isInteger(value);
      case "boolean":
        return typeof value === "boolean";
      case "null":
        return value === null;
      case "array":
        return Array.isArray(value);
      case "object":
        return typeof value === "object" && value !== null && !Array.isArray(value);
      default:
        return false;
    }
  });
}

export function fitToJsonSchema(value: unknown, schema: unknown): unknown {
  const node = schema as JsonSchemaNode | undefined;
  if (!node || typeof node !== "object") return value;

  const variants = node.anyOf ?? node.oneOf;
  if (variants) {
    const variant = variants.find((candidate) => matchesType(candidate, value));
    return variant ? fitToJsonSchema(value, variant) : value;
  }

  if (typeof value === "string" && typeof node.maxLength === "number") {
    return truncateText(value, node.maxLength);
  }

  if (typeof value === "number") {
    let clamped = value;
    if (typeof node.minimum === "number") clamped = Math.max(clamped, node.minimum);
    if (typeof node.maximum === "number") clamped = Math.min(clamped, node.maximum);
    return clamped;
  }

  if (Array.isArray(value)) {
    const limited = typeof node.maxItems === "number" ? value.slice(0, node.maxItems) : value;
    return node.items ? limited.map((item) => fitToJsonSchema(item, node.items)) : limited;
  }

  if (typeof value === "object" && value !== null && node.properties) {
    const result: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const [key, propertySchema] of Object.entries(node.properties)) {
      if (key in result) result[key] = fitToJsonSchema(result[key], propertySchema);
    }
    return result;
  }

  return value;
}
