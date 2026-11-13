import { pgTable, text, boolean, uuid, timestamp, index, uniqueIndex, pgEnum, jsonb } from 'drizzle-orm/pg-core';
import { ROLES } from '@toce/shared';
import { id, createdAt, updatedAt, deletedAt } from './_common.js';

export const roleEnum = pgEnum('role', ROLES);

/** Especialidades: Aves, Mastofauna, Herpetofauna, Entomofauna, Flora. */
export const specialties = pgTable('specialties', {
  id: id(),
  code: text('code').notNull().unique(), // AVE, MAS, HER, ENT, FLO
  name: text('name').notNull(),
  icon: text('icon'),
  sortOrder: text('sort_order'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    dni: text('dni').notNull(),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    roles: roleEnum('roles').array().notNull().default([]),
    specialtyId: uuid('specialty_id').references(() => specialties.id),
    isActive: boolean('is_active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('users_dni_idx').on(t.dni), index('users_specialty_idx').on(t.specialtyId)],
);

/** Sesiones = refresh tokens emitidos. Un dispositivo solo puede tener un usuario activo. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    deviceId: text('device_id'),
    deviceName: text('device_name'),
    platform: text('platform'), // android | ios | web
    appVersion: text('app_version'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** rotated = reemplazada por renovación normal (tiene gracia); logout | admin | device = definitiva. */
    revokeReason: text('revoke_reason'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_device_idx').on(t.deviceId)],
);

/** Catálogo de especies por especialidad (gestionado por supervisor/coordinador). */
export const species = pgTable(
  'species',
  {
    id: id(),
    specialtyId: uuid('specialty_id')
      .notNull()
      .references(() => specialties.id),
    scientificName: text('scientific_name').notNull(),
    commonName: text('common_name'),
    family: text('family'),
    order: text('order_name'),
    conservationStatus: text('conservation_status'),
    extra: jsonb('extra').$type<Record<string, unknown>>(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('species_specialty_idx').on(t.specialtyId),
    uniqueIndex('species_specialty_name_idx').on(t.specialtyId, t.scientificName),
  ],
);
