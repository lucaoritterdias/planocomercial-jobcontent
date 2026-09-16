/**
 * Impede que um número (taxa, percentual, contagem) que a IA cite nos
 * campos de texto do plano seja aceito se não vier rastreável ao
 * contexto que foi de fato enviado a ela — a IA interpreta os números já
 * calculados, nunca inventa um novo.
 *
 * Heurística, não uma prova formal: procura, nos campos de MAIOR risco de
 * fabricação (interpretação do gap, causa-raiz, valores de indicadores —
 * onde um número específico e concreto apareceria), qualquer token
 * numérico que não exista em lugar nenhum do JSON do contexto enviado.
 * Números estruturais do próprio formato do relatório (1 a 3 prioridades,
 * fases de 30/60/90 dias) nunca contam como inventados.
 *
 * A comparação é por VALOR, não por texto: "50.000", "50000", "50 mil" e
 * "R$ 50.000,00" são o mesmo número — a IA escreve em formato brasileiro,
 * enquanto o contexto costuma ter o número cru (ou o texto digitado pela
 * pessoa, em qualquer um desses formatos).
 */
import type { CommercialPlan } from "@/schemas/commercial-plan";

const STRUCTURAL_SAFE_NUMBERS = ["0", "1", "2", "3", "30", "60", "90"];

/** Milhar com ponto (1.500 / 1.500.000,50) OU número simples com decimal opcional; depois, sufixo de escala opcional. */
const NUMBER_PATTERN =
  /(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?:\s*(mil|k|mi|milh(?:ão|ao|ões|oes)|bi|bilh(?:ão|ao|ões|oes))(?![\p{L}]))?/giu;

const THOUSANDS_PATTERN = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;

function scaleOf(suffix: string | undefined): number {
  if (!suffix) return 1;
  const s = suffix.toLowerCase();
  if (s === "mil" || s === "k") return 1_000;
  if (s.startsWith("bi")) return 1_000_000_000;
  return 1_000_000;
}

function canonical(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  // Arredonda ruído de ponto flutuante (ex.: 1.2 * 1000) sem perder casas reais.
  return String(Number(value.toFixed(6)));
}

/** Todos os valores que um token numérico pode representar ("1.500" pode ser 1500 ou 1.5). */
function valuesOf(raw: string, suffix: string | undefined): string[] {
  const readings: number[] = [];
  if (THOUSANDS_PATTERN.test(raw)) {
    readings.push(Number(raw.replace(/\./g, "").replace(",", ".")));
  }
  readings.push(Number(raw.replace(",", ".")));

  const scale = scaleOf(suffix);
  const values = new Set<string>();
  for (const reading of readings) {
    for (const candidate of [reading, reading * scale]) {
      const value = canonical(candidate);
      if (value !== null) values.add(value);
    }
  }
  return [...values];
}

type NumericToken = { raw: string; values: string[] };

function extractTokens(text: string): NumericToken[] {
  return [...text.matchAll(NUMBER_PATTERN)].map((match) => ({
    raw: match[1],
    values: valuesOf(match[1], match[2]),
  }));
}

export function extractNumericTokens(text: string): string[] {
  return extractTokens(text).map((token) => token.raw);
}

export function buildAllowedNumberSet(contextJson: string): Set<string> {
  const allowed = new Set<string>(STRUCTURAL_SAFE_NUMBERS);
  for (const token of extractTokens(contextJson)) {
    for (const value of token.values) allowed.add(value);
  }
  return allowed;
}

/** Campos de texto livre onde uma métrica concreta e específica apareceria — não varremos o plano inteiro (nomes de indicador, títulos etc. teriam falsos positivos demais). */
function riskFieldsOf(plan: CommercialPlan): { field: string; text: string }[] {
  const fields: { field: string; text: string }[] = [
    { field: "goalGapInterpretation", text: plan.goalGapInterpretation },
    { field: "rootCause.description", text: plan.rootCause.description },
  ];

  plan.indicators.forEach((indicator, index) => {
    if (indicator.currentValue) {
      fields.push({ field: `indicators[${index}].currentValue`, text: indicator.currentValue });
    }
    if (indicator.targetValue) {
      fields.push({ field: `indicators[${index}].targetValue`, text: indicator.targetValue });
    }
  });

  return fields;
}

export type UngroundedNumberFinding = { field: string; value: string };

export function findUngroundedNumbers(
  plan: CommercialPlan,
  contextJson: string,
): UngroundedNumberFinding[] {
  const allowed = buildAllowedNumberSet(contextJson);
  const findings: UngroundedNumberFinding[] = [];

  for (const { field, text } of riskFieldsOf(plan)) {
    for (const token of extractTokens(text)) {
      if (!token.values.some((value) => allowed.has(value))) {
        findings.push({ field, value: token.raw });
      }
    }
  }

  return findings;
}

const INDICATOR_VALUE_FIELD = /^indicators\[(\d+)\]\.(currentValue|targetValue)$/;

/**
 * Remove do plano os números não rastreáveis que dá para remover sem
 * estragar o relatório: valor atual/meta de indicador vira null (o
 * próprio schema já prevê null para "valor desconhecido" — a tela e o
 * PDF já tratam esse caso). Achados em texto corrido
 * (goalGapInterpretation, rootCause.description) não têm como ser
 * removidos sem quebrar a frase — são devolvidos em `remaining` para
 * quem chama registrar em log, mas o plano não é descartado por isso.
 */
export function sanitizeUngroundedNumbers(
  plan: CommercialPlan,
  contextJson: string,
): { plan: CommercialPlan; removed: UngroundedNumberFinding[]; remaining: UngroundedNumberFinding[] } {
  const findings = findUngroundedNumbers(plan, contextJson);
  if (findings.length === 0) return { plan, removed: [], remaining: [] };

  const removed: UngroundedNumberFinding[] = [];
  const remaining: UngroundedNumberFinding[] = [];
  const indicators = plan.indicators.map((indicator) => ({ ...indicator }));

  for (const finding of findings) {
    const match = INDICATOR_VALUE_FIELD.exec(finding.field);
    if (match) {
      indicators[Number(match[1])][match[2] as "currentValue" | "targetValue"] = null;
      removed.push(finding);
    } else {
      remaining.push(finding);
    }
  }

  return { plan: { ...plan, indicators }, removed, remaining };
}
