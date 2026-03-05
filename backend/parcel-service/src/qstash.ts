import 'dotenv/config';

export async function publishEvent(topic: string, event: object): Promise<void> {
  const qstashUrl   = process.env.QSTASH_URL;
  const qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashUrl || !qstashToken) {
    console.log(`[QStash DEV] Topic: ${topic}`, JSON.stringify(event, null, 2));
    return;
  }
  try {
    await fetch(`${qstashUrl}/v2/publish/${topic}`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${qstashToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(event),
    });
  } catch (err: any) {
    console.error('QStash error:', err.message);
  }
}

// Schedule a delayed message — used for SLA enforcement
export async function scheduleMessage(topic: string, event: object, delaySeconds: number): Promise<void> {
  const qstashUrl   = process.env.QSTASH_URL;
  const qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashUrl || !qstashToken) {
    console.log(`[QStash DEV] Scheduled in ${delaySeconds}s — Topic: ${topic}`);
    return;
  }
  try {
    await fetch(`${qstashUrl}/v2/publish/${topic}`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${qstashToken}`,
        'Content-Type':  'application/json',
        'Upstash-Delay': `${delaySeconds}s`,
      },
      body: JSON.stringify(event),
    });
  } catch (err: any) {
    console.error('QStash schedule error:', err.message);
  }
}