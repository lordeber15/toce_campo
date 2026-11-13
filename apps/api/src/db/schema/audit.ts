import { pgTable, text, uuid, jsonb, index, timestamp } from 'drizzle-orm/pg-core';
import { id } from './_common.js';
import { users } from './core.js';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    action: text('action').notNull(), // create | update | delete | login | approve ...
    before: jsonb('before').$type<unknown>(),
    after: jsonb('after').$type<unknown>(),
    ipAddress: text('ip_address'),
    deviceId: text('device_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_logs_entity_idx').on(t.entity, t.entityId), index('audit_logs_user_idx').on(t.userId, t.at)],
);
