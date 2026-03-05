import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';

import routeRoutes from './routes/routes';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());

app.use('/routes', routeRoutes);

app.get('/health', (_, res) => res.json({
  status:  'ok',
  service: 'routing-service',
  time:    new Date().toISOString(),
}));

const PORT = process.env.PORT || 3003;

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Routing Service running on port ${PORT}`);
});