import { Router } from "express";

export function healthRouter(): Router {
  const router = Router();
  router.get("/healthz", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
  });
  return router;
}
