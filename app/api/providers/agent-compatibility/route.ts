import { NextRequest } from "next/server";
import { resolveAgentConnection } from "@/lib/detail-runs/provider";
import { withProviderCredentials } from "@/lib/services/provider-runtime";
import { handleRouteError, ok } from "@/lib/utils/route";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    return await withProviderCredentials(request, async () => {
      const body = await request.json().catch(() => ({}));
      const role = body?.role === "analysis" ? "analysis" : "planning";
      const { baseUrl, modelId, transport } = await resolveAgentConnection(true, role);
      return ok({ baseUrl, modelId, transport, role, compatible: true });
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
