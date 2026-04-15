import { NextRequest } from 'next/server';
import { GET } from '../route';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { decrypt } from '@/lib/encryption';

jest.mock('@/lib/database', () => ({
  prisma: {
    payrollRecord: {
      findMany: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/logoBase64', () => ({
  LOGO_BASE64: 'data:image/png;base64,logo',
}));

jest.mock('@/lib/encryption', () => ({
  decrypt: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockedDecrypt = decrypt as jest.MockedFunction<typeof decrypt>;

describe('withholding certificate HTML escaping', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedGetUserFromRequest.mockResolvedValue({
      userId: 1,
      employeeId: 99,
      username: 'hr',
      role: 'HR',
      sessionId: 'session-1',
    } as never);

    mockedPrisma.payrollRecord.findMany.mockResolvedValue([
      {
        payMonth: 1,
        grossPay: 40000,
        basePay: 36000,
        overtimePay: 4000,
        laborInsurance: 800,
        healthInsurance: 600,
        laborPensionSelf: 500,
        incomeTax: 1000,
        netPay: 37100,
        hourlyWage: 250,
      },
    ] as never);

    mockedPrisma.employee.findUnique.mockResolvedValue({
      id: 99,
      employeeId: 'EMP<script>9</script>',
      name: '<img src=x onerror=alert(9)>',
      idNumber: 'encrypted-id',
      department: '<svg/onload=alert(8)>',
      birthday: new Date('1990-01-01T00:00:00Z'),
      address: 'Test',
      hireDate: new Date('2020-01-01T00:00:00Z'),
    } as never);

    mockedDecrypt.mockReturnValue('A123456789');
  });

  it('escapes employee data before generating downloadable HTML', async () => {
    const request = new NextRequest('http://localhost/api/reports/withholding-certificate?year=2026&employeeId=99&format=html');

    const response = await GET(request);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain('<img src=x onerror=alert(9)>');
    expect(html).not.toContain('<svg/onload=alert(8)>');
    expect(html).not.toContain('EMP<script>9</script>');
    expect(html).toContain('&lt;img src=x onerror=alert(9)&gt;');
    expect(html).toContain('&lt;svg/onload=alert(8)&gt;');
    expect(html).toContain('EMP&lt;script&gt;9&lt;/script&gt;');
    expect(html).toContain('A***6789');
  });

  it('does not expose unused personal fields in JSON responses', async () => {
    const request = new NextRequest('http://localhost/api/reports/withholding-certificate?year=2026');

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.certificate.employee).toMatchObject({
      employeeId: 'EMP<script>9</script>',
      name: '<img src=x onerror=alert(9)>',
      department: '<svg/onload=alert(8)>',
      idNumber: 'A***6789',
    });
    expect(data.certificate.employee).not.toHaveProperty('birthday');
    expect(data.certificate.employee).not.toHaveProperty('address');
    expect(data.certificate.employee).not.toHaveProperty('hireDate');
  });

  it.each([
    ['http://localhost/api/reports/withholding-certificate?year=abc&employeeId=99&format=html', '無效的年份參數'],
    ['http://localhost/api/reports/withholding-certificate?year=2026&employeeId=abc&format=html', '無效的員工編號參數'],
    ['http://localhost/api/reports/withholding-certificate?year=2026&employeeId=99&format=xml', '無效的格式參數'],
  ])('returns 400 for invalid query params: %s', async (url, expectedError) => {
    const request = new NextRequest(url);

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: expectedError });
    expect(mockedPrisma.payrollRecord.findMany).not.toHaveBeenCalled();
    expect(mockedPrisma.employee.findUnique).not.toHaveBeenCalled();
  });
});