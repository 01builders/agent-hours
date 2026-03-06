import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { registerHealthRoutes } from "../../src/web/health.js";

describe("health routes", () => {
  it("responds healthy on /healthz and /readyz", async () => {
    const app = express();
    registerHealthRoutes(app);

    await request(app).get("/healthz").expect(200, { ok: true });
    await request(app).get("/readyz").expect(200, { ready: true });
  });
});
