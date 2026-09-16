import "server-only";

/**
 * Caminho da rota que entrega o plano comercial em PDF — precisa bater
 * exatamente com a pasta em
 * src/app/diagnostico/[diagnosticId]/plano.pdf/route.ts. Escrito aqui
 * uma única vez: nenhum outro lugar do código deve repetir essa string.
 */
function planPdfPath(diagnosticId: string): string {
  return `/diagnostico/${encodeURIComponent(diagnosticId)}/plano.pdf`;
}

/**
 * URL absoluta e ESTÁVEL do plano em PDF de um diagnóstico — é o que vai
 * para o RD Station no campo `cf_link_plano_comercial` (ver
 * src/server/send-rd-station-conversion.ts).
 *
 * De propósito NÃO é uma signed URL do Storage: o link fica gravado no
 * CRM e é usado pelo time comercial ao longo de semanas, então precisa
 * continuar funcionando depois que qualquer assinatura teria expirado. A
 * rota resolve isso assinando uma URL nova a cada acesso, e sempre para
 * a versão atual do plano.
 *
 * `new URL` (em vez de concatenar strings) para APP_URL funcionar com ou
 * sem barra no fim.
 */
export function buildPlanPdfUrl(appUrl: string, diagnosticId: string): string {
  return new URL(planPdfPath(diagnosticId), appUrl).toString();
}
