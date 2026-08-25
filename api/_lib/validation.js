/* Server-side validation. The client validates too, but only this runs on
 * input we actually trust. */

import { z } from 'zod';
import { isCleanName, NAME_BLOCKED_MESSAGE } from '../../lib/profanity.js';

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  .transform((v) => v.toLowerCase());

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(14, 'Names cap at 14 characters')
  // Control characters would corrupt the name texture baked onto the model.
  .regex(/^[^\p{C}]+$/u, 'That name has characters we cannot render')
  .refine(isCleanName, NAME_BLOCKED_MESSAGE);

/* mii_data is authored by the client renderer and its shape evolves with the
 * art, so it is accepted as opaque JSON with a hard size ceiling rather than
 * mirrored field by field here — validating it structurally would mean editing
 * this file every time a hairstyle is added. */
export const miiDataSchema = z
  .record(z.any())
  .refine((v) => {
    try { return JSON.stringify(v).length <= 8000; } catch { return false; }
  }, 'That character is too complex to store');

export const previewSchema = z
  .string()
  .max(2_000_000)
  .regex(/^data:image\/(png|jpeg|webp);base64,/, 'Preview must be a PNG, JPEG or WebP data URL')
  .optional();

export const createMiiSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  dna: miiDataSchema,
  preview: previewSchema
});

export const updateMiiSchema = z.object({
  name: nameSchema.optional(),
  dna: miiDataSchema,
  preview: previewSchema
}).superRefine((data, ctx) => {
  const candidate = data.name || (data.dna && data.dna.name);
  if (!candidate || typeof candidate !== 'string') return;
  if (isCleanName(candidate)) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: NAME_BLOCKED_MESSAGE,
    path: ['name']
  });
});

export const magicLinkSchema = z.object({ email: emailSchema });

export const walletSchema = z.object({
  id: z.string().uuid('Unknown badge'),
  name: nameSchema.optional(),
  email: emailSchema.optional()
});

/* Zod's flatten() is verbose for a UI banner; surface the first message. */
export function firstError(err) {
  const issue = err?.issues?.[0];
  if (!issue) return 'That input did not look right';
  return issue.message || 'That input did not look right';
}

export function parseOr400(schema, input) {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, error: firstError(parsed.error) };
}
