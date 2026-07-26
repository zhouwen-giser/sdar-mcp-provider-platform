export async function withLeaseHeartbeat<T>(
  renew: () => Promise<void>,
  leaseMilliseconds: number,
  action: () => Promise<T>,
): Promise<T> {
  await renew();
  const intervalMilliseconds = Math.max(25, Math.floor(leaseMilliseconds / 3));
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let renewalFailure: unknown;

  const schedule = (): void => {
    timer = setTimeout(() => {
      void renew()
        .catch((error: unknown) => {
          renewalFailure = error;
        })
        .finally(() => {
          if (!stopped) schedule();
        });
    }, intervalMilliseconds);
    timer.unref();
  };

  schedule();
  try {
    const value = await action();
    if (renewalFailure !== undefined) {
      throw renewalFailure instanceof Error
        ? renewalFailure
        : new Error("LEASE_RENEWAL_FAILED", { cause: renewalFailure });
    }
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    await renew();
    return value;
  } finally {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  }
}
