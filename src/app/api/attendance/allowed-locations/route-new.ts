import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';

// 簡化的用戶驗證
function getUserFromRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader === 'Bearer admin-token') {
    return { id: 1, role: 'ADMIN' };
  }
  return null;
}

// GET - 獲取所有允許位置
export async function GET(request: NextRequest) {
  try {
    // 檢查管理員權限
    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    console.log('=== GET Request - Fetching allowed locations ===');
    
    // 直接使用 prisma.allowedLocation
    const locations = await prisma.allowedLocation.findMany({
      orderBy: { createdAt: 'desc' }
    });

    console.log('Found locations:', locations.length);
    
    return NextResponse.json({
      message: '獲取成功',
      locations
    });

  } catch (error) {
    console.error('獲取允許位置失敗:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    
    return NextResponse.json(
      { 
        error: '獲取允許位置失敗',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// POST - 新增位置
export async function POST(request: NextRequest) {
  try {
    // 檢查管理員權限
    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    console.log('=== POST Request - Creating location ===');
    console.log('Request body:', body);
    
    const { name, latitude, longitude, radius, isActive, department, workHours } = body;

    // 驗證必填欄位
    if (!name || latitude === undefined || longitude === undefined || !radius) {
      console.error('Missing required fields:', { name, latitude, longitude, radius });
      return NextResponse.json(
        { error: '缺少必填欄位' },
        { status: 400 }
      );
    }

    const locationData = {
      name,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      radius: parseInt(radius),
      isActive: isActive !== false,
      department: department || null,
      workHours: workHours || null
    };

    console.log('Creating location with data:', locationData);

    // 直接使用 prisma.allowedLocation
    const newLocation = await prisma.allowedLocation.create({
      data: locationData
    });

    console.log('Location created successfully:', newLocation);
    
    return NextResponse.json({
      message: '新增成功',
      location: newLocation
    });

  } catch (error) {
    console.error('新增允許位置失敗:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : 'No stack trace',
      name: error instanceof Error ? error.name : 'Unknown error type'
    });
    
    return NextResponse.json(
      { 
        error: '新增允許位置失敗',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// PUT - 更新位置
export async function PUT(request: NextRequest) {
  try {
    // 檢查管理員權限
    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    console.log('=== PUT Request - Updating location ===');
    console.log('Request body:', body);
    
    const { id, name, latitude, longitude, radius, isActive, department, workHours } = body;

    if (!id) {
      return NextResponse.json(
        { error: '缺少位置ID' },
        { status: 400 }
      );
    }

    const updateData = {
      name,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      radius: parseInt(radius),
      isActive: isActive !== false,
      department: department || null,
      workHours: workHours || null
    };

    console.log('Updating location with data:', updateData);

    const updatedLocation = await prisma.allowedLocation.update({
      where: { id: parseInt(id) },
      data: updateData
    });

    console.log('Location updated successfully:', updatedLocation);
    
    return NextResponse.json({
      message: '更新成功',
      location: updatedLocation
    });

  } catch (error) {
    console.error('更新允許位置失敗:', error);
    return NextResponse.json(
      { 
        error: '更新允許位置失敗',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// DELETE - 刪除位置
export async function DELETE(request: NextRequest) {
  try {
    // 檢查管理員權限
    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    console.log('=== DELETE Request - Deleting location ===');
    console.log('Request body:', body);
    
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: '缺少位置ID' },
        { status: 400 }
      );
    }

    await prisma.allowedLocation.delete({
      where: { id: parseInt(id) }
    });

    console.log('Location deleted successfully, ID:', id);
    
    return NextResponse.json({
      message: '刪除成功'
    });

  } catch (error) {
    console.error('刪除允許位置失敗:', error);
    return NextResponse.json(
      { 
        error: '刪除允許位置失敗',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
