import { beforeEach, describe, expect, it, vi } from "vitest";

const generateCommercialPlanPdf = vi.fn();

vi.mock("@/server/generate-commercial-plan-pdf", () => ({ generateCommercialPlanPdf }));

const { buildPlanPdfUrl } = await import("@/lib/pdf/plan-pdf-link");
const { GET } = await import("@/app/diagnostico/[diagnosticId]/plano.pdf/route");

const DIAGNOSTIC_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function request(diagnosticId: string) {
  return {
    params: Promise.resolve({ diagnosticId }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  generateCommercialPlanPdf.mockResolvedValue({
    status: "ready",
    url: "https://storage.example/pdf-assinado?token=abc",
    version: 1,
  });
});

describe("buildPlanPdfUrl", () => {
  it("monta a URL da rota do PDF a partir de APP_URL", () => {
    expect(buildPlanPdfUrl("https://app.exemplo.com", DIAGNOSTIC_ID)).toBe(
      `https://app.exemplo.com/diagnostico/${DIAGNOSTIC_ID}/plano.pdf`,
    );
  });

  it("funciona com APP_URL terminando em barra (nunca gera barra dupla)", () => {
    expect(buildPlanPdfUrl("https://app.exemplo.com/", DIAGNOSTIC_ID)).toBe(
      `https://app.exemplo.com/diagnostico/${DIAGNOSTIC_ID}/plano.pdf`,
    );
  });
});

describe("GET /diagnostico/[diagnosticId]/plano.pdf", () => {
  it("redireciona para a signed URL recém-gerada, sem deixar ninguém cachear o redirecionamento", async () => {
    const response = await GET(new Request("https://app.exemplo.com"), request(DIAGNOSTIC_ID));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://storage.example/pdf-assinado?token=abc");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(generateCommercialPlanPdf).toHaveBeenCalledWith(DIAGNOSTIC_ID);
  });

  it("404 para um diagnosticId malformado — nunca chega a consultar o banco", async () => {
    const response = await GET(new Request("https://app.exemplo.com"), request("nao-e-uuid"));

    expect(response.status).toBe(404);
    expect(generateCommercialPlanPdf).not.toHaveBeenCalled();
  });

  it("404 quando o diagnóstico não existe ou o plano ainda não foi gerado", async () => {
    generateCommercialPlanPdf.mockResolvedValue({ status: "skipped", reason: "plan_not_ready" });
    const response = await GET(new Request("https://app.exemplo.com"), request(DIAGNOSTIC_ID));

    expect(response.status).toBe(404);
  });

  it("503 com Retry-After quando outra geração do mesmo PDF já está em andamento", async () => {
    generateCommercialPlanPdf.mockResolvedValue({ status: "generating" });
    const response = await GET(new Request("https://app.exemplo.com"), request(DIAGNOSTIC_ID));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
  });

  it("500 quando a geração falha de verdade (render/upload)", async () => {
    generateCommercialPlanPdf.mockResolvedValue({ status: "failed", reason: "render_failed" });
    const response = await GET(new Request("https://app.exemplo.com"), request(DIAGNOSTIC_ID));

    expect(response.status).toBe(500);
  });
});
