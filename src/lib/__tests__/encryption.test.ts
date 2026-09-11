describe('encryption key safeguards', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ENCRYPTION_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('falls back to the compatibility key when ENCRYPTION_KEY is missing in production', async () => {
    process.env.NODE_ENV = 'production';
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await jest.isolateModulesAsync(async () => {
      const { encrypt, decrypt } = await import('../encryption');
      const encrypted = encrypt('secret');

      expect(encrypted).not.toBe('secret');
      expect(decrypt(encrypted)).toBe('secret');
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'ENCRYPTION_KEY 環境變數未設定，已改用既有相容預設金鑰以避免資料加解密中斷'
    );
    consoleWarnSpy.mockRestore();
  });

  it('falls back to the development key outside production', async () => {
    process.env.NODE_ENV = 'test';

    await jest.isolateModulesAsync(async () => {
      const { encrypt, decrypt } = await import('../encryption');
      const encrypted = encrypt('secret');

      expect(encrypted).not.toBe('secret');
      expect(decrypt(encrypted)).toBe('secret');
    });
  });
});
