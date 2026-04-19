import { verifyPassword } from '@/lib/auth';
import { prisma } from '@/lib/database';
import type { PasswordPolicy } from '@/lib/password-policy';

type PasswordReuseReader = {
  passwordHistory: {
    findMany: (args: {
      where: { userId: number };
      orderBy: { createdAt: 'desc' };
      take: number;
      select: { passwordHash: true };
    }) => Promise<Array<{ passwordHash: string }>>;
  };
};

function buildPasswordReuseMessage(policy: PasswordPolicy) {
  return policy.passwordHistoryCount > 0
    ? `不可重複使用目前密碼或最近 ${policy.passwordHistoryCount} 次密碼`
    : '不可重複使用目前密碼';
}

export async function getPasswordReuseViolation(
  userId: number,
  newPassword: string,
  currentPasswordHash: string | null | undefined,
  policy: PasswordPolicy,
  reader: PasswordReuseReader = prisma
): Promise<string | null> {
  if (!policy.preventPasswordReuse) {
    return null;
  }

  const historyHashes = policy.passwordHistoryCount > 0
    ? await reader.passwordHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: policy.passwordHistoryCount,
        select: { passwordHash: true }
      })
    : [];

  const disallowedHashes = [
    currentPasswordHash ?? null,
    ...historyHashes.map((history) => history.passwordHash)
  ].filter((hash): hash is string => typeof hash === 'string' && hash.length > 0);

  for (const hash of disallowedHashes) {
    if (await verifyPassword(newPassword, hash)) {
      return buildPasswordReuseMessage(policy);
    }
  }

  return null;
}
