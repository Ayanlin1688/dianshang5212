import { cancelTask } from "@/lib/services/task-service";
import { handleRouteError, ok } from "@/lib/utils/route";

export async function POST(_request: Request, context: { params: { taskId: string } }) {
  try {
    const task = await cancelTask(context.params.taskId);
    return ok(task);
  } catch (error) {
    return handleRouteError(error);
  }
}