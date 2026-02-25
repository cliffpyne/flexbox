FROM node:20-alpine
RUN corepack enable && npm install -g tsx
WORKDIR /app
COPY . .
RUN yarn install
RUN yarn workspace @flexbox/booking-service run build
CMD ["yarn", "workspace", "@flexbox/booking-service", "exec", "tsx", "src/index.ts"]
