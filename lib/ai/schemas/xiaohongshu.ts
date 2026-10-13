import { z } from "zod";

export const xiaohongshuPageSchema = z.object({
  pageNumber: z.coerce.number().int().min(1).default(1),
  title: z.string().default(""),
  subtitle: z.string().default(""),
  body: z.string().default(""),
  visualDirection: z.string().default(""),
  layout: z.string().default(""),
  imagePrompt: z.string().default(""),
  negativePrompt: z.string().default(""),
});

export const xiaohongshuPlanSchema = z.object({
  topic: z.string().default(""),
  audience: z.string().default(""),
  coreInsight: z.string().default(""),
  titleOptions: z.array(z.string()).default([]),
  coverTitle: z.string().default(""),
  coverSubtitle: z.string().default(""),
  pages: z.array(xiaohongshuPageSchema).default([]),
  caption: z.string().default(""),
  hashtags: z.array(z.string()).default([]),
  exportNote: z.string().default(""),
});

export type XiaohongshuPlan = z.infer<typeof xiaohongshuPlanSchema>;
