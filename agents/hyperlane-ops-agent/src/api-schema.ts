import { Type, type Static } from "@sinclair/typebox";

export const PlanRequestSchema = Type.Object({
  goal: Type.String({ minLength: 1 }),
  context: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
});

export type PlanRequest = Static<typeof PlanRequestSchema>;

export const ApproveRequestSchema = Type.Object({
  planId: Type.String({ minLength: 1 }),
  commandHashes: Type.Array(Type.String({ minLength: 1 })),
  ttlSeconds: Type.Optional(Type.Number({ minimum: 30, maximum: 86400 })),
});

export type ApproveRequest = Static<typeof ApproveRequestSchema>;

export const ExecuteRequestSchema = Type.Object({
  planId: Type.String({ minLength: 1 }),
  approvalToken: Type.Optional(Type.String()),
  readOnly: Type.Optional(Type.Boolean()),
});

export type ExecuteRequest = Static<typeof ExecuteRequestSchema>;
