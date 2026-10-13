import { z } from "zod";

export const visualStyleGuideSchema = z.object({
  styleName: z.string().default(""),
  colorPalette: z.string().default(""),
  backgroundSystem: z.string().default(""),
  lighting: z.string().default(""),
  cameraLanguage: z.string().default(""),
  typography: z.string().default(""),
  layoutRules: z.string().default(""),
  propRules: z.string().default(""),
  productRenderingRules: z.string().default(""),
  negativeStyleConstraints: z.string().default(""),
});

const sectionPlanItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  goal: z.string(),
  copy: z.string(),
  visualPrompt: z.string(),
  editableFields: z.record(z.string(), z.any()).default({}),
});

export const sectionPlanOutputSchema = z
  .union([
    z.object({
      visualStyleGuide: visualStyleGuideSchema.optional(),
      sections: z.array(sectionPlanItemSchema),
    }),
    z.array(sectionPlanItemSchema),
    z.object({
      data: z.object({
        visualStyleGuide: visualStyleGuideSchema.optional(),
        sections: z.array(sectionPlanItemSchema),
      }),
    }),
    z.object({
      result: z.object({
        visualStyleGuide: visualStyleGuideSchema.optional(),
        sections: z.array(sectionPlanItemSchema),
      }),
    }),
  ])
  .transform((value) => {
    if (Array.isArray(value)) {
      return { sections: value, visualStyleGuide: undefined };
    }
    if ("sections" in value) {
      return { sections: value.sections, visualStyleGuide: value.visualStyleGuide };
    }
    if ("data" in value) {
      return { sections: value.data.sections, visualStyleGuide: value.data.visualStyleGuide };
    }
    return { sections: value.result.sections, visualStyleGuide: value.result.visualStyleGuide };
  });

export type SectionPlanOutput = z.infer<typeof sectionPlanOutputSchema>;
export type VisualStyleGuideOutput = z.infer<typeof visualStyleGuideSchema>;