import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createHttpMetricsMiddleware } from "../../src/metrics/http-metrics.js";
import { renderMetrics, resetMetricsRegistry } from "../../src/metrics/registry.js";

describe("http metrics middleware", () => {
  beforeEach(() => {
    resetMetricsRegistry();
  });

  it("records requests with templated route labels", async () => {
    const app = express();
    app.use(createHttpMetricsMiddleware());
    app.get("/telegram/webhook/:token", (_req, res) => {
      res.status(200).send("ok");
    });

    await request(app).get("/telegram/webhook/secret-token");

    const metrics = await renderMetrics();
    expect(metrics).toContain(
      'http_requests_total{method="GET",route="/telegram/webhook/:token",status_code="200"} 1',
    );
    expect(metrics).not.toContain('route="/telegram/webhook/secret-token"');
  });

  it("uses unmatched route label for unknown routes", async () => {
    const app = express();
    app.use(createHttpMetricsMiddleware());
    app.get("/healthz", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await request(app).get("/does-not-exist").expect(404);

    const metrics = await renderMetrics();
    expect(metrics).toContain('http_requests_total{method="GET",route="unmatched",status_code="404"} 1');
  });

  it("records request duration histogram", async () => {
    const app = express();
    app.use(createHttpMetricsMiddleware());
    app.get("/healthz", (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await request(app).get("/healthz").expect(200);

    const metrics = await renderMetrics();
    expect(metrics).toMatch(/http_request_duration_seconds_bucket\{(?=[^}]*le="0\.005")(?=[^}]*method="GET")(?=[^}]*route="\/healthz")(?=[^}]*status_code="200")[^}]*\} 1/);
    expect(metrics).toContain('http_request_duration_seconds_count{method="GET",route="/healthz",status_code="200"} 1');
  });
});
