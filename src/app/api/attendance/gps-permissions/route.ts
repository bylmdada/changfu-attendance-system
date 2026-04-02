import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

// GPS 权限配置接口
interface GPSPermissionData {
  employeeId?: number | null;
  department?: string | null;
  isEnabled: boolean;
  priority?: number;
  reason?: string;
}

interface GPSPermissionRow {
  id: number;
  employee_id: number | null;
  department: string | null;
  is_enabled: boolean | number;
  priority: number;
  reason: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  employee_name?: string;
  employee_code?: string;
}

// 获取权限操作（使用原始 SQL 作为备用）
async function getPermissionOperations() {
  try {
    // 尝试创建表（如果不存在）
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS gps_attendance_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER,
      department TEXT,
      is_enabled BOOLEAN DEFAULT true,
      priority INTEGER DEFAULT 0,
      reason TEXT,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`;
    
    return {
      findMany: async () => {
        const results = await prisma.$queryRaw`
          SELECT gp.*, e.name as employee_name, e.employee_id as employee_code
          FROM gps_attendance_permissions gp
          LEFT JOIN employees e ON gp.employee_id = e.id
          ORDER BY gp.priority DESC, gp.created_at DESC
        `;
        return (results as GPSPermissionRow[]).map(row => ({
          id: row.id,
          employeeId: row.employee_id,
          department: row.department,
          isEnabled: !!row.is_enabled,
          priority: row.priority,
          reason: row.reason,
          createdBy: row.created_by,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
          employeeName: row.employee_name,
          employeeCode: row.employee_code
        }));
      },
      create: async (data: GPSPermissionData & { createdBy: number }) => {
        await prisma.$executeRaw`
          INSERT INTO gps_attendance_permissions (employee_id, department, is_enabled, priority, reason, created_by, created_at, updated_at)
          VALUES (${data.employeeId || null}, ${data.department || null}, ${data.isEnabled}, ${data.priority || 0}, ${data.reason || null}, ${data.createdBy}, datetime('now'), datetime('now'))
        `;
        
        const inserted = await prisma.$queryRaw`SELECT * FROM gps_attendance_permissions WHERE id = last_insert_rowid()`;
        const row = (inserted as GPSPermissionRow[])[0];
        return {
          id: row.id,
          employeeId: row.employee_id,
          department: row.department,
          isEnabled: !!row.is_enabled,
          priority: row.priority,
          reason: row.reason,
          createdBy: row.created_by,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at)
        };
      },
      update: async (id: number, data: Partial<GPSPermissionData>) => {
        await prisma.$executeRaw`
          UPDATE gps_attendance_permissions 
          SET employee_id = ${data.employeeId || null}, 
              department = ${data.department || null}, 
              is_enabled = ${data.isEnabled}, 
              priority = ${data.priority || 0}, 
              reason = ${data.reason || null}, 
              updated_at = datetime('now')
          WHERE id = ${id}
        `;
        
        const updated = await prisma.$queryRaw`SELECT * FROM gps_attendance_permissions WHERE id = ${id}`;
        const row = (updated as GPSPermissionRow[])[0];
        return {
          id: row.id,
          employeeId: row.employee_id,
          department: row.department,
          isEnabled: !!row.is_enabled,
          priority: row.priority,
          reason: row.reason,
          createdBy: row.created_by,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at)
        };
      },
      delete: async (id: number) => {
        const toDelete = await prisma.$queryRaw`SELECT * FROM gps_attendance_permissions WHERE id = ${id}`;
        await prisma.$executeRaw`DELETE FROM gps_attendance_permissions WHERE id = ${id}`;
        const row = (toDelete as GPSPermissionRow[])[0];
        return {
          id: row.id,
          employeeId: row.employee_id,
          department: row.department,
          isEnabled: !!row.is_enabled,
          priority: row.priority,
          reason: row.reason,
          createdBy: row.created_by,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at)
        };
      }
    };
  } catch (error) {
    console.error('GPS Permissions operations setup failed:', error);
    throw error;
  }
}

// GET - 获取所有 GPS 权限配置
export async function GET() {
  try {
    console.log('GET request to gps-permissions started');
    
    const operations = await getPermissionOperations();
    const permissions = await operations.findMany();
    
    console.log(`Found ${permissions.length} GPS permissions`);
    
    return NextResponse.json({
      success: true,
      permissions
    });
  } catch (error) {
    console.error('Error fetching GPS permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch GPS permissions' },
      { status: 500 }
    );
  }
}

// POST - 创建新的 GPS 权限配置
export async function POST(request: NextRequest) {
  try {
    console.log('POST request to gps-permissions started');
    
    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    const body = await request.json();
    console.log('GPS permission data:', body);

    // 验证数据
    if (!body.employeeId && !body.department) {
      return NextResponse.json(
        { error: 'Either employeeId or department must be specified' },
        { status: 400 }
      );
    }

    if (body.employeeId && body.department) {
      return NextResponse.json(
        { error: 'Cannot specify both employeeId and department' },
        { status: 400 }
      );
    }

    const operations = await getPermissionOperations();
    const permission = await operations.create({
      ...body,
      createdBy: user.userId
    });

    console.log('GPS permission created:', permission);

    return NextResponse.json({
      success: true,
      permission
    });
  } catch (error) {
    console.error('Error creating GPS permission:', error);
    return NextResponse.json(
      { error: 'Failed to create GPS permission' },
      { status: 500 }
    );
  }
}

// PUT - 更新 GPS 权限配置
export async function PUT(request: NextRequest) {
  try {
    console.log('PUT request to gps-permissions started');
    
    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { id, ...updateData } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Permission ID is required' },
        { status: 400 }
      );
    }

    const operations = await getPermissionOperations();
    const permission = await operations.update(id, updateData);

    console.log('GPS permission updated:', permission);

    return NextResponse.json({
      success: true,
      permission
    });
  } catch (error) {
    console.error('Error updating GPS permission:', error);
    return NextResponse.json(
      { error: 'Failed to update GPS permission' },
      { status: 500 }
    );
  }
}

// DELETE - 删除 GPS 权限配置
export async function DELETE(request: NextRequest) {
  try {
    console.log('DELETE request to gps-permissions started');
    
    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Permission ID is required' },
        { status: 400 }
      );
    }

    const operations = await getPermissionOperations();
    const permission = await operations.delete(id);

    console.log('GPS permission deleted:', permission);

    return NextResponse.json({
      success: true,
      permission
    });
  } catch (error) {
    console.error('Error deleting GPS permission:', error);
    return NextResponse.json(
      { error: 'Failed to delete GPS permission' },
      { status: 500 }
    );
  }
}
