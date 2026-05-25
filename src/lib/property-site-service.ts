import { prisma } from '@/lib/database';
import { DEFAULT_SITE } from '@/lib/app-config';
import type { Prisma } from '@prisma/client';

const DEFAULT_SITE_NAMES = [DEFAULT_SITE.name, ...DEFAULT_SITE.legacyNames];

type SiteMatch = {
  id: number;
  name: string;
  code: string;
  _count: {
    assets: number;
    records: number;
    userAssignments: number;
    personnel: number;
  };
};

function siteDataCount(site: SiteMatch): number {
  return site._count.assets + site._count.records + site._count.userAssignments + site._count.personnel;
}

function chooseDefaultSiteTarget(sites: SiteMatch[]): SiteMatch {
  return [...sites].sort((a, b) => {
    const dataDiff = siteDataCount(b) - siteDataCount(a);
    if (dataDiff !== 0) return dataDiff;
    if (a.name === DEFAULT_SITE.name && b.name !== DEFAULT_SITE.name) return -1;
    if (b.name === DEFAULT_SITE.name && a.name !== DEFAULT_SITE.name) return 1;
    if (a.code === DEFAULT_SITE.code && b.code !== DEFAULT_SITE.code) return -1;
    if (b.code === DEFAULT_SITE.code && a.code !== DEFAULT_SITE.code) return 1;
    return a.id - b.id;
  })[0];
}

function strongerMaintenanceRole(a: string, b: string): string {
  const rank: Record<string, number> = { MAINTAINER: 1, SUPERVISOR: 2, ADMIN: 3 };
  return (rank[b] ?? 0) > (rank[a] ?? 0) ? b : a;
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'P2002';
}

async function mergeSourceSiteIntoTarget(
  tx: Prisma.TransactionClient,
  sourceId: number,
  targetId: number
) {
  const assignments = await tx.userSiteAssignment.findMany({ where: { siteId: sourceId } });
  for (const assignment of assignments) {
    const targetAssignment = await tx.userSiteAssignment.findUnique({
      where: { userId_siteId: { userId: assignment.userId, siteId: targetId } },
    });
    if (targetAssignment) {
      await tx.userSiteAssignment.update({
        where: { id: targetAssignment.id },
        data: {
          maintenanceRole: strongerMaintenanceRole(
            targetAssignment.maintenanceRole,
            assignment.maintenanceRole
          ),
          isActive: targetAssignment.isActive || assignment.isActive,
        },
      });
      await tx.userSiteAssignment.delete({ where: { id: assignment.id } });
    } else {
      await tx.userSiteAssignment.update({
        where: { id: assignment.id },
        data: { siteId: targetId },
      });
    }
  }

  const personnel = await tx.propertyPersonnel.findMany({ where: { siteId: sourceId } });
  for (const person of personnel) {
    const targetPerson = await tx.propertyPersonnel.findUnique({
      where: { siteId_name: { siteId: targetId, name: person.name } },
    });
    if (targetPerson) {
      await tx.maintenanceRecord.updateMany({
        where: { maintainerPersonnelId: person.id },
        data: { maintainerPersonnelId: targetPerson.id },
      });
      await tx.propertyPersonnel.delete({ where: { id: person.id } });
    } else {
      await tx.propertyPersonnel.update({
        where: { id: person.id },
        data: { siteId: targetId },
      });
    }
  }

  const assets = await tx.propertyAsset.findMany({ where: { siteId: sourceId } });
  for (const asset of assets) {
    const targetAsset = await tx.propertyAsset.findUnique({
      where: { siteId_assetCode: { siteId: targetId, assetCode: asset.assetCode } },
    });
    if (targetAsset) {
      await tx.maintenanceRecord.updateMany({
        where: { assetId: asset.id },
        data: { assetId: targetAsset.id, siteId: targetId },
      });
      await tx.assetModificationRequest.updateMany({
        where: { assetId: asset.id },
        data: { assetId: targetAsset.id },
      });
      await tx.propertyAsset.delete({ where: { id: asset.id } });
    } else {
      await tx.propertyAsset.update({
        where: { id: asset.id },
        data: { siteId: targetId },
      });
    }
  }

  await tx.maintenanceRecord.updateMany({
    where: { siteId: sourceId },
    data: { siteId: targetId },
  });
  await tx.propertySite.delete({ where: { id: sourceId } });
}

export async function getOrCreateDefaultPropertySite(retryOnUniqueConflict = true) {
  try {
    return await prisma.$transaction(async (tx) => {
      const matches = await tx.propertySite.findMany({
        where: {
          OR: [
            { code: DEFAULT_SITE.code },
            { name: { in: DEFAULT_SITE_NAMES } },
          ],
        },
        include: {
          _count: {
            select: {
              assets: true,
              records: true,
              userAssignments: true,
              personnel: true,
            },
          },
        },
      });

      if (matches.length === 0) {
        return tx.propertySite.create({
          data: {
            name: DEFAULT_SITE.name,
            code: DEFAULT_SITE.code,
            institutionTitle: DEFAULT_SITE.institutionTitle,
          },
          select: { id: true, name: true },
        });
      }

      const target = chooseDefaultSiteTarget(matches);
      for (const source of matches) {
        if (source.id !== target.id) {
          await mergeSourceSiteIntoTarget(tx, source.id, target.id);
        }
      }

      return tx.propertySite.update({
        where: { id: target.id },
        data: {
          name: DEFAULT_SITE.name,
          code: DEFAULT_SITE.code,
          institutionTitle: DEFAULT_SITE.institutionTitle,
          isActive: true,
        },
        select: { id: true, name: true },
      });
    });
  } catch (error) {
    if (retryOnUniqueConflict && isUniqueConstraintError(error)) {
      return getOrCreateDefaultPropertySite(false);
    }
    throw error;
  }
}

export async function findExistingDefaultPropertySite() {
  return prisma.propertySite.findFirst({
    where: {
      OR: [
        { code: DEFAULT_SITE.code },
        { name: { in: DEFAULT_SITE_NAMES } },
      ],
    },
    orderBy: { id: 'asc' },
    select: { id: true, name: true },
  });
}
