import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";

export function validateBody<T>(schema: TSchema, body: unknown): T {
  if (!Value.Check(schema, body)) {
    const errors = [...Value.Errors(schema, body)].map((error) => `${error.path || "body"}: ${error.message}`);
    throw new Error(`Invalid request body: ${errors.join(", ")}`);
  }

  return body as T;
}
