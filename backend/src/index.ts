import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Agent, setGlobalDispatcher } from 'undici';
import { config } from './utils/config';
import { prisma } from './utils/database';
import { logger } from './utils/logger';
import documentRoutes from './routes/documents';
import analysisRoutes from './routes/analysis';

// Increase undici's internal timeouts (default headersTimeout=300s is too low for LLM calls)
setGlobalDispatcher(
  new Agent({
    headersTimeout: 15 * 60 * 1000, // 15 minutes
    bodyTimeout: 15 * 60 * 1000,
    connectTimeout: 30 * 1000,
  })
);

const app = express();

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }));
app.use(express.json({ limit: '30mb' }));

// Routes
app.use('/documents', documentRoutes);
app.use('/documents', analysisRoutes);

// Health check
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', database: 'disconnected', error: String(err) });
  }
});

// Reset any analyses stuck in RUNNING or PARTIAL state (from previous container crashes)
prisma.documentAnalysis.updateMany({
  where: { status: { in: ['RUNNING', 'PARTIAL'] } },
  data: { status: 'FAILED', errorMessage: 'Server restarted while analysis was in progress. Please re-trigger.' },
}).then((r) => {
  if (r.count > 0) logger.warn('Startup', `Reset ${r.count} stuck analyses to FAILED`);
}).catch((e) => logger.error('Startup', 'Failed to reset stuck analyses', e as Error));

// Start server
app.listen(config.port, '0.0.0.0', async () => {
  logger.info('Startup', `Backend running on http://0.0.0.0:${config.port}`);

  // Check Ollama connectivity
  try {
    const r = await fetch(`${config.ollamaBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as { models?: { name: string }[] };
    const modelNames = data.models?.map((m) => m.name).join(', ') || 'none listed';
    logger.info('Startup', `Ollama reachable`, { models: modelNames });

    // Optionally warm up the generation model (disabled by default).
    if (config.warmupModel) {
      logger.info('Startup', `Warming up model (fire-and-forget)`, { model: config.generationModel });
      void fetch(`${config.ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.generationModel,
          messages: [{ role: 'user', content: 'hello' }],
          stream: false,
          keep_alive: -1,
        }),
        signal: AbortSignal.timeout(300_000),
      }).then(() => logger.info('Startup', `Model warmed up and loaded into VRAM`, { model: config.generationModel }))
        .catch((e) => logger.warn('Startup', `Model warmup failed (non-fatal)`, { error: String(e) }));
    }
  } catch (e) {
    logger.warn('Startup', 'Ollama not reachable', { error: String(e) });
  }
});

// Global error handler — must be last middleware (4 args)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('HTTP', err.message, err);
  const status = (err as any).status ?? (err as any).statusCode ?? 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

export default app;
