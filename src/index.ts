import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AnthropicLlmService } from "./services/llm.js";
import { logger } from "./utils/logger.js";

const config = loadConfig();
const app = createApp(config, new AnthropicLlmService());

const server = app.listen(config.port, () => {
  logger.info("ai-gateway started", { port: config.port, clients: config.apiKeys.size });
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info("shutting down", { signal });
    server.close(() => process.exit(0));
  });
}
