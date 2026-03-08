import 'dotenv/config';
export async function publishEvent(topic: string, event: object, opts?: { delay_seconds?: number; dedup_id?: string }): Promise<void> {
  const url = process.env.QSTASH_URL; const token = process.env.QSTASH_TOKEN;
  if (!url || !token) { console.log(`[QStash DEV] ${topic}`, JSON.stringify(event)); return; }
  const headers: any = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (opts?.delay_seconds) headers['Upstash-Delay'] = `${opts.delay_seconds}s`;
  if (opts?.dedup_id) headers['Upstash-Deduplication-Id'] = opts.dedup_id;
  try { await fetch(`${url}/v2/publish/${topic}`, { method: 'POST', headers, body: JSON.stringify(event) }); }
  catch (err: any) { console.error('QStash error:', err.message); }
}