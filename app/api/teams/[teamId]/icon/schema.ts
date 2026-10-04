import { z } from "zod";

export const teamIconParamsSchema = z.object({ teamId: z.string().uuid() });
export const teamIconFormSchema = z.object({
  file: z
    .custom<File>((value) => value instanceof File, "Choose an image file.")
    .refine((file) => file.size > 0, "Choose a file with image data."),
});
