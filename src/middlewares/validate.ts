import type { ZodSchema } from 'zod';

export function validate<T>(schema: ZodSchema<T>) {
  return (req: any, res: any, next: any) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      return res.status(400).json({
        ok: false,
        error: 'Validation failed',
        fieldErrors: flat.fieldErrors,
        formErrors: flat.formErrors,
      });
    }
    req.body = parsed.data;
    next();
  };
}
