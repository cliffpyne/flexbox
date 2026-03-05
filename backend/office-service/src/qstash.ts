import 'dotenv/config';

export async function publishEvent(topic: string, event: object): Promise<void> {
  const qstashUrl = process.env.QSTASH_URL;
  const qstashToken = process.env.QSTASH_TOKEN;

  if (!qstashUrl || !qstashToken) {
    console.log(`[QStash DEV] Topic: ${topic}`, event);
    return;
  }

  try {
    await fetch(`${qstashUrl}/v2/publish/${topic}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${qstashToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });
  } catch (err: any) {
    console.error('QStash publish error:', err.message);
  }
}