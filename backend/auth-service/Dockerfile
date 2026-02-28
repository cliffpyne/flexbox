FROM node:20-alpine

RUN corepack enable

WORKDIR /app

COPY .yarnrc.yml yarn.lock package.json ./
COPY backend/auth-service/package.json ./backend/auth-service/
COPY packages/ ./packages/

RUN yarn install --immutable

COPY backend/auth-service/ ./backend/auth-service/

RUN yarn workspace @flexbox/auth-service build

EXPOSE 3001

CMD ["node", "backend/auth-service/dist/index.js"]
