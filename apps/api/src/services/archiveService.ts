import archiver from 'archiver';
import * as fs from 'fs';
import type { FastifyReply } from 'fastify';

export async function streamJobZip(jobOutputDir: string, jobId: string, reply: FastifyReply): Promise<void> {
  if (!fs.existsSync(jobOutputDir)) {
    throw new Error('Output directory not found');
  }

  const archive = archiver('zip', { zlib: { level: 6 } });

  reply.raw.setHeader('Content-Type', 'application/zip');
  reply.raw.setHeader('Content-Disposition', `attachment; filename="NSIX-Package-${jobId}.zip"`);
  reply.raw.setHeader('Transfer-Encoding', 'chunked');

  archive.on('error', (err) => { throw err; });
  archive.pipe(reply.raw);
  archive.directory(jobOutputDir, false);

  await archive.finalize();
}
