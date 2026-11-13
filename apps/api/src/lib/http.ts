import { z } from 'zod';

export const idParam = z.object({ id: z.string().uuid() });
export const projectParam = z.object({ projectId: z.string().uuid() });

/** Error de negocio con código HTTP (lo traduce el error handler). */
export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}
export const notFound = (what: string) => new HttpError(404, `${what} no encontrado`);
export const conflict = (msg: string) => new HttpError(409, msg);
export const badRequest = (msg: string) => new HttpError(400, msg);

/** Código de violación de unicidad de Postgres. */
export const isUniqueViolation = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === '23505' || (e as { cause?: { code?: string } })?.cause?.code === '23505';
