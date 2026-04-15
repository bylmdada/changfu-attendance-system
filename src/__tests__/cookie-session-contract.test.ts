import fs from 'fs';
import path from 'path';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('cookie session contract', () => {
  it('does not persist auth token in the login page', () => {
    const source = readWorkspaceFile('src/app/login/page.tsx');

    expect(source).not.toContain("localStorage.setItem('token'");
  });

  it.each([
    'src/app/dashboard-stats/page.tsx',
    'src/app/health-insurance-dependents/page.tsx',
    'src/app/bonus-management/page.tsx',
    'src/app/pro-rated-bonus/page.tsx',
  ])('%s no longer reads localStorage token or adds bearer headers', (relativePath) => {
    const source = readWorkspaceFile(relativePath);

    expect(source).not.toContain("localStorage.getItem('token')");
    expect(source).not.toMatch(/Authorization\s*:\s*`Bearer \$\{token\}`/);
    expect(source).not.toMatch(/'Authorization'\s*:\s*`Bearer \$\{token\}`/);
  });

  it.each([
    'src/app/api/batch-approve/route.ts',
    'src/app/api/attendance-freeze/route.ts',
  ])('%s no longer manually parses bearer Authorization headers', (relativePath) => {
    const source = readWorkspaceFile(relativePath);

    expect(source).not.toContain("request.headers.get('Authorization')");
  });
});