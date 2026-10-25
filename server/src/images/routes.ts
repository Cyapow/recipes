import { createReadStream } from 'node:fs';
import path from 'node:path';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { IMAGE_ID_RE, type ImageStore } from './store.js';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function registerImageRoutes(app: FastifyInstance, store: ImageStore) {
  app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  app.post('/api/images', async (req, reply) => {
    if (!req.isMultipart()) return reply.code(415).send({ error: 'Expected multipart/form-data' });
    let bytes: Buffer;
    try {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'No file uploaded' });
      bytes = await file.toBuffer(); // throws if over the size limit
    } catch (e) {
      if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'Image is too large (15 MB max)' });
      }
      return reply.code(400).send({ error: 'Invalid upload' });
    }
    try {
      return { id: await store.save(bytes) };
    } catch {
      return reply.code(415).send({ error: 'File is not a supported image' });
    }
  });

  const serve = (file: string | undefined, reply: FastifyReply) => {
    if (!file) return reply.code(404).send({ error: 'Not found' });
    return reply
      .type('image/jpeg')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(createReadStream(file));
  };

  app.get<{ Params: { id: string } }>('/api/images/:id', async (req, reply) => {
    if (!IMAGE_ID_RE.test(req.params.id)) return reply.code(400).send({ error: 'Invalid image id' });
    return serve(store.path(req.params.id), reply);
  });

  app.get<{ Params: { id: string } }>('/api/images/:id/thumb', async (req, reply) => {
    if (!IMAGE_ID_RE.test(req.params.id)) return reply.code(400).send({ error: 'Invalid image id' });
    const full = store.path(req.params.id);
    return serve(full && path.join(store.dir, `thumb-${req.params.id}`), reply);
  });
}
