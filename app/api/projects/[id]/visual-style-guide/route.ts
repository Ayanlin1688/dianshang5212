import { NextRequest } from "next/server";
import { z } from "zod";

import { withProviderCredentials } from "@/lib/services/provider-runtime";
import { regenerateVisualStyleGuide } from "@/lib/services/planner-service";
import { handleRouteError, ok } from "@/lib/utils/route";

const requestSchema = z.object({
  modelId: z.string().optional().nullable(),
});

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  return withProviderCredentials(request, async () => {
    try {
      const input = requestSchema.parse(await request.json().catch(() => ({})));
      const result = await regenerateVisualStyleGuide(context.params.id, input.modelId);
      return ok(result);
    } catch (error) {
      return handleRouteError(error);
    }
  });
}