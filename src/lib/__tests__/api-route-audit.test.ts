import { auditApiRoutes } from '@/lib/api-route-audit';

test('reports actual missing paths separately from unresolvable dynamic references', () => {
  const report = auditApiRoutes([
    {filePath:'page.tsx',line:1,raw:'/api/missing',normalizedPath:'/api/missing'},
    {filePath:'page.tsx',line:2,raw:'/api/reports/${kind}',normalizedPath:'/api/reports/__DYNAMIC__'},
    {filePath:'page.tsx',line:3,raw:'/api/comp-leave/balance?year=2026',normalizedPath:'/api/comp-leave/balance'},
  ], [{filePath:'route.ts',routePath:'/api/comp-leave/balance',segments:['api','comp-leave','balance']}]);
  expect(report.exactMatches).toBe(1);
  expect(report.unresolved.map(item => item.reference.normalizedPath)).toEqual(['/api/missing']);
  expect(report.unverified.map(item => item.line)).toEqual([2]);
});
