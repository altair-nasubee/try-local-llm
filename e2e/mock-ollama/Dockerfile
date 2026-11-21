FROM node:22-bookworm-slim
WORKDIR /app
COPY server.mjs ./
ENV PORT=11434
EXPOSE 11434
USER node
CMD ["node", "server.mjs"]
