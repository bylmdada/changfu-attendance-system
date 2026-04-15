export function buildSuccessPayload<T extends Record<string, unknown>>(payload: T) {
  return {
    success: true,
    data: payload,
    ...payload,
  };
}