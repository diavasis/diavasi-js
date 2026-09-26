FROM node:22-bookworm-slim
WORKDIR /app
COPY . /app
RUN npm install --omit=dev
RUN chmod +x /app/wait-ca.sh
CMD ["/bin/sh", "-c", "/app/wait-ca.sh && node examples/consume.js --addr \"$DIAVASI_DATA_ADDR\" --ca \"$DIAVASI_CA\" --token \"$DIAVASI_API_TOKEN\" --group demo --consumer js --total 8"]
