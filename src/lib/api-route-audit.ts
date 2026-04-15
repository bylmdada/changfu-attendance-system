import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface RouteReference {
  filePath: string;
  line: number;
  raw: string;
  normalizedPath: string;
}

export interface BackendRoute {
  filePath: string;
  routePath: string;
  segments: string[];
}

export interface RouteMismatch {
  reference: RouteReference;
  closestRoutes: string[];
}

export interface RouteAuditReport {
  frontendReferenceCount: number;
  backendRouteCount: number;
  exactMatches: number;
  dynamicMatches: number;
  unresolved: RouteMismatch[];
}

const API_REFERENCE_PATTERN = /(['"`])((?:\/api\/[A-Za-z0-9_./\-[\]${}]+)(?:\?[^'"`}]*)?)/g;

function shouldSkipFrontendReferenceFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');

  return normalized.endsWith('/src/lib/api-route-audit.ts');
}

export async function collectBackendRoutes(apiRoot: string): Promise<BackendRoute[]> {
  const routeFiles = await collectFiles(apiRoot, (entryPath) => path.basename(entryPath) === 'route.ts');

  return routeFiles
    .map((filePath) => {
      const relativePath = path.relative(apiRoot, filePath);
      const routePath = `/${relativePath}`
        .replace(/\\/g, '/')
        .replace(/\/route\.ts$/, '')
        .replace(/^\/$/, '');

      const normalizedPath = routePath ? `/api/${routePath}`.replace(/\/+/g, '/') : '/api';

      return {
        filePath,
        routePath: normalizedPath,
        segments: splitPathSegments(normalizedPath),
      };
    })
    .sort((left, right) => left.routePath.localeCompare(right.routePath));
}

export async function collectFrontendApiReferences(searchRoots: string[]): Promise<RouteReference[]> {
  const references: RouteReference[] = [];

  for (const searchRoot of searchRoots) {
    const files = await collectFiles(searchRoot, (entryPath) => {
      const normalized = entryPath.replace(/\\/g, '/');
      if (normalized.includes('/src/app/api/')) {
        return false;
      }

      return /\.(ts|tsx|js|jsx|mjs)$/.test(normalized);
    });

    for (const filePath of files) {
      if (shouldSkipFrontendReferenceFile(filePath)) {
        continue;
      }

      const content = await readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/);

      lines.forEach((lineText, index) => {
        for (const match of lineText.matchAll(API_REFERENCE_PATTERN)) {
          const raw = match[2];
          const normalizedPath = normalizeApiPath(raw);

          if (!normalizedPath.startsWith('/api/')) {
            continue;
          }

          references.push({
            filePath,
            line: index + 1,
            raw,
            normalizedPath,
          });
        }
      });
    }
  }

  return dedupeReferences(references).sort((left, right) => {
    if (left.filePath === right.filePath) {
      return left.line - right.line;
    }

    return left.filePath.localeCompare(right.filePath);
  });
}

export function auditApiRoutes(
  frontendReferences: RouteReference[],
  backendRoutes: BackendRoute[]
): RouteAuditReport {
  let exactMatches = 0;
  let dynamicMatches = 0;
  const unresolved: RouteMismatch[] = [];

  for (const reference of frontendReferences) {
    const exact = backendRoutes.find((route) => route.routePath === reference.normalizedPath);
    if (exact) {
      exactMatches += 1;
      continue;
    }

    const dynamic = backendRoutes.find((route) => routeMatchesReference(route, reference.normalizedPath));
    if (dynamic) {
      dynamicMatches += 1;
      continue;
    }

    unresolved.push({
      reference,
      closestRoutes: findClosestRoutes(reference.normalizedPath, backendRoutes),
    });
  }

  return {
    frontendReferenceCount: frontendReferences.length,
    backendRouteCount: backendRoutes.length,
    exactMatches,
    dynamicMatches,
    unresolved,
  };
}

export function formatRouteAuditReport(report: RouteAuditReport): string {
  const lines = [
    'API route audit report',
    `- frontend references: ${report.frontendReferenceCount}`,
    `- backend routes: ${report.backendRouteCount}`,
    `- exact matches: ${report.exactMatches}`,
    `- dynamic matches: ${report.dynamicMatches}`,
    `- unresolved: ${report.unresolved.length}`,
  ];

  if (report.unresolved.length > 0) {
    lines.push('', 'Unresolved references:');

    for (const item of report.unresolved) {
      lines.push(
        `- ${item.reference.normalizedPath} (${item.reference.filePath}:${item.reference.line})`
      );

      if (item.closestRoutes.length > 0) {
        lines.push(`  closest: ${item.closestRoutes.join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}

async function collectFiles(
  root: string,
  includeFile: (entryPath: string) => boolean
): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath, includeFile)));
      continue;
    }

    if (includeFile(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

function dedupeReferences(references: RouteReference[]): RouteReference[] {
  const seen = new Set<string>();
  const result: RouteReference[] = [];

  for (const reference of references) {
    const key = `${reference.filePath}:${reference.line}:${reference.raw}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(reference);
  }

  return result;
}

function normalizeApiPath(raw: string): string {
  const pathWithoutQuery = raw.split('?')[0] || raw;
  const normalized = pathWithoutQuery
    .replace(/\$\{[^}]+\}/g, '__DYNAMIC__')
    .replace(/\/+/g, '/');

  return normalized.endsWith('/') && normalized !== '/api/'
    ? normalized.slice(0, -1)
    : normalized;
}

function splitPathSegments(routePath: string): string[] {
  return routePath.split('/').filter(Boolean);
}

function routeMatchesReference(route: BackendRoute, referencePath: string): boolean {
  const routeSegments = route.segments;
  const referenceSegments = splitPathSegments(referencePath);

  if (routeSegments.length !== referenceSegments.length) {
    return false;
  }

  return routeSegments.every((segment, index) => {
    if (isDynamicRouteSegment(segment)) {
      return true;
    }

    return segment === referenceSegments[index];
  });
}

function isDynamicRouteSegment(segment: string): boolean {
  return /^\[.*\]$/.test(segment);
}

function findClosestRoutes(referencePath: string, routes: BackendRoute[]): string[] {
  const referenceSegments = splitPathSegments(referencePath);

  return routes
    .map((route) => ({
      routePath: route.routePath,
      score: similarityScore(referenceSegments, route.segments),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.routePath.localeCompare(right.routePath))
    .slice(0, 3)
    .map((item) => item.routePath);
}

function similarityScore(left: string[], right: string[]): number {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) {
    return 0;
  }

  let score = 0;
  const minLength = Math.min(left.length, right.length);

  for (let index = 0; index < minLength; index += 1) {
    if (left[index] === right[index]) {
      score += 2;
      continue;
    }

    if (isDynamicRouteSegment(right[index])) {
      score += 1;
    }
  }

  return score / (maxLength * 2);
}