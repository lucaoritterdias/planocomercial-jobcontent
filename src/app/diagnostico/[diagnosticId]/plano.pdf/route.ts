import { NextResponse } from "next/server";

import { generateCommercialPlanPdf } from "@/server/generate-commercial-plan-pdf";

/** Mesma validação da página de resultado — nunca deixa um valor malformado chegar a uma query. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Renderizar o PDF na primeira visita leva alguns segundos (mesmo custo
// da Server Action do botão "Baixar plano em PDF" — ver maxDuration na
// página de resultado). Aqui o limite é da própria rota, não da página.
export const maxDuration = 60;

/**
 * Link ESTÁVEL do plano comercial em PDF — é este endereço que vai para o
 * RD Station em `cf_link_plano_comercial`. Quem monta a URL absoluta é
 * src/lib/pdf/plan-pdf-link.ts: o caminho desta rota está escrito lá, então
 * renomear/mover esta pasta exige atualizar aquele arquivo (e o teste
 * plan-pdf-link.test.ts) junto. Nunca expira: a cada acesso
 * ele gera (ou reaproveita, pelo hash do conteúdo) o PDF e redireciona
 * para uma signed URL nova e de curta duração, em vez de gravar no CRM
 * uma URL assinada que morreria em alguns dias.
 *
 * Exposição: o mesmo `diagnosticId` (UUID) já abre a tela de resultado
 * pública em /diagnostico/[diagnosticId] — esta rota não amplia o que
 * quem tem o link consegue ver, só entrega o mesmo conteúdo em PDF. O
 * bucket continua privado; nenhum arquivo é servido direto daqui.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ diagnosticId: string }> },
): Promise<NextResponse> {
  const { diagnosticId } = await params;

  if (!UUID_PATTERN.test(diagnosticId)) {
    return notFoundResponse();
  }

  const result = await generateCommercialPlanPdf(diagnosticId);

  if (result.status === "ready") {
    // 302 + no-store: a signed URL de destino é descartável (1h) e muda a
    // cada acesso — nenhum intermediário pode guardar este redirecionamento.
    return NextResponse.redirect(result.url, {
      status: 302,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (result.status === "generating") {
    // Outra geração para o mesmo diagnóstico já está em andamento (dois
    // cliques, duas abas) — peça para tentar de novo em instantes em vez
    // de renderizar o mesmo PDF duas vezes em paralelo.
    return text(
      "O plano em PDF está sendo gerado. Atualize a página em alguns segundos.",
      503,
      { "Retry-After": "5" },
    );
  }

  if (result.status === "skipped") {
    return notFoundResponse();
  }

  return text("Não foi possível gerar o plano em PDF agora. Tente novamente mais tarde.", 500);
}

function notFoundResponse(): NextResponse {
  return text("Plano comercial não encontrado.", 404);
}

function text(body: string, status: number, headers: Record<string, string> = {}): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
