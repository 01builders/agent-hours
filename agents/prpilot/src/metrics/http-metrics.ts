import type { NextFunction, Request, Response } from "express";
import { Counter, Histogram } from "prom-client";
import { metricsRegistry } from "./registry.js";

const HTTP_REQUESTS_TOTAL = "http_requests_total";
const HTTP_REQUEST_DURATION_SECONDS = "http_request_duration_seconds";

const requestCounter = getOrCreateCounter(HTTP_REQUESTS_TOTAL, "Total number of HTTP requests", [
  "method",
  "route",
  "status_code",
]);

const requestDurationHistogram = getOrCreateHistogram(
  HTTP_REQUEST_DURATION_SECONDS,
  "HTTP request duration in seconds",
  ["method", "route", "status_code"],
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
);

export function createHttpMetricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAtNs = process.hrtime.bigint();

    res.on("finish", () => {
      const durationSeconds = Number(process.hrtime.bigint() - startedAtNs) / 1_000_000_000;
      const route = resolveRouteLabel(req);
      const labels = {
        method: req.method,
        route,
        status_code: String(res.statusCode),
      };

      requestCounter.inc(labels, 1);
      requestDurationHistogram.observe(labels, durationSeconds);
    });

    next();
  };
}

function resolveRouteLabel(req: Request): string {
  const routePath = req.route?.path;
  if (!routePath) return "unmatched";

  const normalizedRoutePath = Array.isArray(routePath) ? routePath[0] : routePath;
  if (typeof normalizedRoutePath !== "string") return "unmatched";

  const basePath = req.baseUrl || "";
  return `${basePath}${normalizedRoutePath}`;
}

function getOrCreateCounter(name: string, help: string, labelNames: string[]): Counter<string> {
  const existing = metricsRegistry.getSingleMetric(name);
  if (existing) {
    return existing as Counter<string>;
  }

  return new Counter({
    name,
    help,
    labelNames,
    registers: [metricsRegistry],
  });
}

function getOrCreateHistogram(
  name: string,
  help: string,
  labelNames: string[],
  buckets: number[],
): Histogram<string> {
  const existing = metricsRegistry.getSingleMetric(name);
  if (existing) {
    return existing as Histogram<string>;
  }

  return new Histogram({
    name,
    help,
    labelNames,
    buckets,
    registers: [metricsRegistry],
  });
}
