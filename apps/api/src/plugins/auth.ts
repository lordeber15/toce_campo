import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { hasAnyRole, type Role } from '@toce/shared';
import { env } from '../env.js';

export type AccessPayload = {
  sub: string;
  dni: string;
  roles: Role[];
  specialtyId: string | null;
  sid: string; // session id
  /** Solo en tickets de descarga: ruta (sin query) a la que da acceso. */
  dl?: string;
};

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessPayload;
    user: AccessPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRoles: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Como requireRoles, pero también acepta `?ticket=` (ticket de descarga de esa misma ruta). */
    requireRolesOrTicket: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app) => {
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_TTL },
  });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'No autenticado' });
    }
    if (req.user.dl) return reply.code(401).send({ error: 'No autenticado' });
  });

  app.decorate('requireRoles', (...roles: Role[]) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        await req.jwtVerify();
      } catch {
        return reply.code(401).send({ error: 'No autenticado' });
      }
      if (req.user.dl) return reply.code(401).send({ error: 'No autenticado' });
      if (!hasAnyRole(req.user.roles, roles)) {
        return reply.code(403).send({ error: 'Sin permisos para esta acción' });
      }
    };
  });

  // Los enlaces de descarga (Excel, ZIP) los abre el navegador sin cabecera de autorización:
  // llevan un ticket de corta duración atado a la ruta.
  app.decorate('requireRolesOrTicket', (...roles: Role[]) => {
    const byHeader = app.requireRoles(...roles);
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const ticket = (req.query as { ticket?: string } | undefined)?.ticket;
      if (!ticket) return byHeader(req, reply);
      try {
        const p = app.jwt.verify<AccessPayload>(ticket);
        if (!p.dl || p.dl !== req.url.split('?')[0]) throw new Error('ruta');
        req.user = p;
      } catch {
        return reply.code(401).send({ error: 'El enlace de descarga venció; vuelve a intentarlo' });
      }
      if (!hasAnyRole(req.user.roles, roles)) return reply.code(403).send({ error: 'Sin permisos para esta acción' });
    };
  });
});
