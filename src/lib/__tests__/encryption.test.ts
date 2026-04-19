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

  it('requires ENCRYPTION_KEY when encrypting in production', async () => {
    process.env.NODE_ENV = 'production';

    await jest.isolateModulesAsync(async () => {
      const { encrypt } = await import('../encryption');
      expect(() => encrypt('secret')).toThrow('ENCRYPTION_KEY 環境變數未設定');
    });
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
