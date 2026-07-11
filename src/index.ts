import { buildServer } from "./server.js";

const { app, config } = await buildServer();
await app.listen({ host: "0.0.0.0", port: config.PORT });
