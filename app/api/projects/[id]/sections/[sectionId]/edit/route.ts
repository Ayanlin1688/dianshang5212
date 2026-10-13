import { NextRequest } from "next/server";

import { editSectionImage } from "@/lib/services/generation-service";
import { generationRequestSchema } from "@/lib/validations/generation";
import { withProviderCredentials } from "@/lib/services/provider-runtime";
import { handleRouteError, ok } from "@/lib/utils/route";

export async function POST(
  request: NextRequest,
  context: { params: { id: string; sectionId: string } },
) {
  return withProviderCredentials(request, async () => {
    try {
      const input = generationRequestSchema.parse(await request.json().catch(() => ({})));
      const result = await editSectionImage(context.params.id, context.params.sectionId, {
        preferredModelId: input.modelId,
        referenceAssetIds: input.referenceAssetIds,
        editMode: input.editMode,
        targetLanguage: input.targetLanguage,
      });
      return ok(result);
    } catch (error) {
      return handleRouteError(error);
    }
  });
}
