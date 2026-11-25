FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV DB_PATH=/data/amigo.db
VOLUME /data
EXPOSE 3000
CMD ["node", "--env-file-if-exists=.env", "server.js"]
