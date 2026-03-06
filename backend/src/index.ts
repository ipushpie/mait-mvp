import express from 'express';
import cors from 'cors';
import { Agent, setGlobalDispatcher } from 'undici';
import { config } from './config';
import { prisma } from './database';
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
app.use(cors({ origin: '*' }));
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

// Reset any analyses stuck in RUNNING state (from previous container crashes)
prisma.documentAnalysis.updateMany({
  where: { status: 'RUNNING' },
  data: { status: 'FAILED', errorMessage: 'Server restarted while analysis was in progress. Please re-trigger.' },
}).then((r) => {
  if (r.count > 0) console.log(`Reset ${r.count} stuck RUNNING analyses to FAILED`);
}).catch(console.error);

// Start server
app.listen(config.port, '0.0.0.0', async () => {
  console.log(`Backend running on http://0.0.0.0:${config.port}`);

  // Check Ollama connectivity
  try {
    const r = await fetch(`${config.ollamaBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as { models?: { name: string }[] };
    const modelNames = data.models?.map((m) => m.name).join(', ') || 'none listed';
    console.log(`Ollama reachable. Models: ${modelNames}`);
  } catch (e) {
    console.warn('Ollama not reachable:', e);
  }
});

export default app;
