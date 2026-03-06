export function verifyWebhookSecret(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  return received === expected;
}

export function isAuthorizedUser(userId: number | undefined, allowedUserId: number): boolean {
  return userId !== undefined && userId === allowedUserId;
}
