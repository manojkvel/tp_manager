import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

const HEADER = 'x-correlation-id';

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.decorateRequest('correlationId', '');

  app.addHook('onRequest', async (req, reply) => {
    const incoming = req.headers[HEADER];
    const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    req.correlationId = id;
    reply.header(HEADER, id);
  });

  app.addHook('preHandler', async (req) => {
    req.log = req.log.child({ correlation_id: req.correlationId });
  });
};

export const correlationIdPlugin = fp(plugin, { name: 'correlation-id' });
