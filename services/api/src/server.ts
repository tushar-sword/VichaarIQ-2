import dotenv from "dotenv";
import path from "node:path";
import { createApp } from "./app.js";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
const app = await createApp();
await app.listen({ host: "127.0.0.1", port: Number(process.env.API_PORT ?? 4000) });
