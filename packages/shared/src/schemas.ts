import { z } from 'zod';
import { ROLES } from './roles.js';

export const dniSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z]{6,12}$/, 'DNI inválido');

export const loginSchema = z.object({
  dni: dniSchema,
  password: z.string().min(4, 'Contraseña muy corta'),
  deviceId: z.string().min(8).optional(),
  deviceName: z.string().max(120).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const authUserSchema = z.object({
  id: z.string().uuid(),
  dni: z.string(),
  fullName: z.string(),
  roles: z.array(z.enum(ROLES)),
  specialtyId: z.string().uuid().nullable(),
  specialtyCode: z.string().nullable(),
  isActive: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: authUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const createUserSchema = z.object({
  dni: dniSchema,
  fullName: z.string().min(3).max(160),
  password: z.string().min(6).max(72),
  roles: z.array(z.enum(ROLES)).min(1),
  specialtyId: z.string().uuid().nullable().optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.partial().extend({
  isActive: z.boolean().optional(),
});
