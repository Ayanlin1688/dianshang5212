import { NextRequest } from "next/server";

import { readProviderCredentialsFromRequest, withProviderCredentials } from "@/lib/services/provider-runtime";
import { retryWorkflowTask } from "@/lib/services/workflow-task-service";
import { handleRouteError, ok } from "@/lib/utils/route";

export async function POST(request: NextRequest, context: { params: { taskId: string } }) {
  return withProviderCredentials(request, async () => {
    try {
      const task = await retryWorkflowTask(context.params.taskId, readProviderCredentialsFromRequest(request));
      return ok(task, { status: 202 });
    } catch (error) {
      return handleRouteError(error);
    }
  });
}