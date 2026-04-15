import path from 'node:path';

import {
  auditApiRoutes,
  collectBackendRoutes,
  collectFrontendApiReferences,
  formatRouteAuditReport,
} from '@/lib/api-route-audit';

async function main() {
  const projectRoot = process.cwd();
  const apiRoot = path.join(projectRoot, 'src/app/api');
  const searchRoots = [path.join(projectRoot, 'src/app'), path.join(projectRoot, 'src/lib')];

  const backendRoutes = await collectBackendRoutes(apiRoot);
  const frontendReferences = await collectFrontendApiReferences(searchRoots);
  const report = auditApiRoutes(frontendReferences, backendRoutes);

  console.log(formatRouteAuditReport(report));

  if (report.unresolved.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Failed to audit API routes:', error);
  process.exitCode = 1;
});