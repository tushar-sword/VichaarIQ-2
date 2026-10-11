import dotenv from "dotenv";
import path from "node:path";

dotenv.config({
  path: path.resolve(process.cwd(), "../../.env"),
});

console.log(
  "OpenAI key loaded:",
  Boolean(process.env.OPENAI_API_KEY)
);


import Fastify from "fastify";
import cors from "@fastify/cors";
import { AnalyticsPlanRequestSchema } from "@vichaar/shared";
import { createAnalyticsPlan } from "@vichaar/agents";
const app = Fastify({logger:true});
const port = Number(process.env.API_PORT ?? 4000);
await app.register(cors,{origin:process.env.WEB_ORIGIN ?? "http://localhost:3000"});
app.get("/health",async()=>({status:"ok",service:"vichaar-iq-api",phase:"2-agent-prototype"}));
app.post("/api/analytics/plan",async(request,reply)=>{
  const parsed=AnalyticsPlanRequestSchema.safeParse(request.body);
  if(!parsed.success) return reply.code(400).send({error:"Invalid request",details:parsed.error.issues.map(i=>({path:i.path.join("."),message:i.message}))});
  if(!process.env.OPENAI_API_KEY) return reply.code(503).send({error:"OPENAI_API_KEY is not configured. Add it to the root .env and restart the API."});
  try {
    const result=await createAnalyticsPlan(parsed.data,process.env.OPENAI_MODEL ?? "gpt-4.1-mini");
    return reply.send(result);
  } catch(error) {
    request.log.error({err:error},"Agent plan generation failed");
    return reply.code(502).send({error:"AI planning failed. Check the API key, model access, and API logs."});
  }
});
await app.listen({host:"127.0.0.1",port});
