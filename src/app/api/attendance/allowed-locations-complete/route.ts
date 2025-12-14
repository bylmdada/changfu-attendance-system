import { NextRequest, NextResponse } from 'next/server';

interface AllowedLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  isActive: boolean;
}

// 預設允許的打卡位置
const DEFAULT_ALLOWED_LOCATIONS = [
  {
    id: 1,
    name: '總公司',
    latitude: 25.0330,
    longitude: 121.5654,
    radius: 100,
    isActive: true
  },
  {
    id: 2,
    name: '分店A',
    latitude: 25.0478,
    longitude: 121.5318,
    radius: 50,
    isActive: true
  }
];

// 模擬資料庫 (實際使用時應該使用真實資料庫)
const allowedLocationsList = [...DEFAULT_ALLOWED_LOCATIONS];
let nextId = 3;

// GET - 獲取允許的位置列表
export async function GET() {
  try {
    return NextResponse.json({ 
      success: true, 
      locations: allowedLocationsList 
    });
  } catch (error) {
    console.error('獲取允許位置失敗:', error);
    return NextResponse.json(
      { success: false, message: '獲取允許位置失敗' },
      { status: 500 }
    );
  }
}

// POST - 添加新的允許位置
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, latitude, longitude, radius, isActive = true } = body;

    // 驗證必要欄位
    if (!name || latitude === undefined || longitude === undefined || radius === undefined) {
      return NextResponse.json(
        { success: false, message: '缺少必要的位置資訊' },
        { status: 400 }
      );
    }

    // 添加新位置
    const newLocation: AllowedLocation = {
      id: nextId++,
      name,
      latitude: parseFloat(latitude.toString()),
      longitude: parseFloat(longitude.toString()),
      radius: parseFloat(radius.toString()),
      isActive: Boolean(isActive)
    };

    allowedLocationsList.push(newLocation);

    return NextResponse.json({ 
      success: true, 
      message: '位置添加成功',
      location: newLocation
    });
  } catch (error) {
    console.error('添加允許位置失敗:', error);
    return NextResponse.json(
      { success: false, message: '添加位置失敗' },
      { status: 500 }
    );
  }
}

// PUT - 更新位置
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, latitude, longitude, radius, isActive } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, message: '缺少位置ID' },
        { status: 400 }
      );
    }

    const locationIndex = allowedLocationsList.findIndex(loc => loc.id === id);
    if (locationIndex === -1) {
      return NextResponse.json(
        { success: false, message: '找不到指定位置' },
        { status: 404 }
      );
    }

    // 更新位置資訊
    const updatedLocation: AllowedLocation = {
      ...allowedLocationsList[locationIndex],
      ...(name !== undefined && { name }),
      ...(latitude !== undefined && { latitude: parseFloat(latitude.toString()) }),
      ...(longitude !== undefined && { longitude: parseFloat(longitude.toString()) }),
      ...(radius !== undefined && { radius: parseFloat(radius.toString()) }),
      ...(isActive !== undefined && { isActive: Boolean(isActive) })
    };

    allowedLocationsList[locationIndex] = updatedLocation;

    return NextResponse.json({ 
      success: true, 
      message: '位置更新成功',
      location: updatedLocation
    });
  } catch (error) {
    console.error('更新允許位置失敗:', error);
    return NextResponse.json(
      { success: false, message: '更新位置失敗' },
      { status: 500 }
    );
  }
}

// DELETE - 刪除位置
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, message: '缺少位置ID' },
        { status: 400 }
      );
    }

    const locationIndex = allowedLocationsList.findIndex(loc => loc.id === id);
    if (locationIndex === -1) {
      return NextResponse.json(
        { success: false, message: '找不到指定位置' },
        { status: 404 }
      );
    }

    // 刪除位置
    allowedLocationsList.splice(locationIndex, 1);

    return NextResponse.json({ 
      success: true, 
      message: '位置刪除成功'
    });
  } catch (error) {
    console.error('刪除允許位置失敗:', error);
    return NextResponse.json(
      { success: false, message: '刪除位置失敗' },
      { status: 500 }
    );
  }
}
