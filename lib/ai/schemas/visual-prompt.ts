import { z } from "zod";

export const visualPromptAgentSchema = z.object({
  analysisSummary: z.string().default(""),
  finalPrompt: z.string().min(20),
  negativePrompt: z.string().default(""),
  qualityChecklist: z.array(z.string()).default([]),
});

export type VisualPromptAgentResult = z.infer<typeof visualPromptAgentSchema>;
