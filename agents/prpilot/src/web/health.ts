import type { Express } from "express";

export function registerHealthRoutes(app: Express): void {
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/readyz", (_req, res) => {
    res.status(200).json({ ready: true });
  });
}
