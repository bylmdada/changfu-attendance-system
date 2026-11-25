import { loadAllEmployees } from '@/lib/load-all-employees';

type Employee = { id: number; employeeId: string; name: string; isActive: boolean };

const makeEmployees = (count: number): Employee[] =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    employeeId: `E${String(index + 1).padStart(4, '0')}`,
    name: `員工${String(index + 1).padStart(4, '0')}`,
    isActive: index % 10 !== 0,
  }));

// 模擬 /api/employees：預設每頁 10 人、limit 上限 1,000，並回傳 pagination.pages
const fakeApi = (all: Employee[]) => {
  const requests: URLSearchParams[] = [];
  const fetchImpl = jest.fn(async (input: string) => {
    const params = new URL(input, 'http://localhost').searchParams;
    requests.push(params);
    const limit = Math.min(Number(params.get('limit') || 10), 1000);
    const page = Number(params.get('page') || 1);
    let list = all;
    if (params.get('status')) list = list.filter((employee) => employee.isActive === (params.get('status') === 'active'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        employees: list.slice((page - 1) * limit, page * limit),
        pagination: { page, limit, total: list.length, pages: Math.ceil(list.length / limit) },
      }),
    } as Response;
  });
  return { fetchImpl, requests };
};

describe('loadAllEmployees', () => {
  it('returns everyone instead of only the default first 10', async () => {
    const { fetchImpl, requests } = fakeApi(makeEmployees(25));

    const employees = await loadAllEmployees<Employee>({}, fetchImpl);

    expect(employees).toHaveLength(25);
    expect(employees[24].employeeId).toBe('E0025');
    expect(requests).toHaveLength(1);
    expect(requests[0].get('limit')).toBe('1000');
  });

  it('keeps paging past the 1,000-per-page cap so the 1,001st employee is found', async () => {
    const { fetchImpl, requests } = fakeApi(makeEmployees(1200));

    const employees = await loadAllEmployees<Employee>({}, fetchImpl);

    expect(employees).toHaveLength(1200);
    expect(employees.find((employee) => employee.employeeId === 'E1100')).toBeDefined();
    expect(requests.map((params) => params.get('page'))).toEqual(['1', '2']);
  });

  it('walks every page when the page size is small, without duplicates', async () => {
    const { fetchImpl } = fakeApi(makeEmployees(7));

    const employees = await loadAllEmployees<Employee>({ pageSize: 3 }, fetchImpl);

    expect(employees.map((employee) => employee.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('asks for a stable name order so paging cannot repeat or skip people', async () => {
    const { fetchImpl, requests } = fakeApi(makeEmployees(5));

    await loadAllEmployees<Employee>({}, fetchImpl);

    expect(requests[0].get('sortBy')).toBe('name');
    expect(requests[0].get('sortOrder')).toBe('asc');
  });

  it('passes the status filter through, so only active employees can be requested', async () => {
    const { fetchImpl, requests } = fakeApi(makeEmployees(30));

    const employees = await loadAllEmployees<Employee>({ status: 'active' }, fetchImpl);

    expect(requests[0].get('status')).toBe('active');
    expect(employees.every((employee) => employee.isActive)).toBe(true);
    expect(employees).toHaveLength(27);
  });

  it('drops a person who shows up on two pages and stops when a later page is empty', async () => {
    const pages = [
      { employees: [{ id: 1 }, { id: 2 }], pagination: { pages: 5 } },
      { employees: [{ id: 2 }, { id: 3 }], pagination: { pages: 5 } }, // 名單在翻頁時有變動，id 2 重複
      { employees: [], pagination: { pages: 5 } }, // 後面其實沒資料了
    ];
    let call = 0;
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => pages[call++] }) as Response);

    const employees = await loadAllEmployees<{ id: number }>({ pageSize: 2 }, fetchImpl);

    expect(employees.map((employee) => employee.id)).toEqual([1, 2, 3]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('throws instead of returning a partial list when a page fails', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ employees: [{ id: 1 }], pagination: { pages: 2 } }) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as Response);

    await expect(loadAllEmployees<{ id: number }>({ pageSize: 1 }, fetchImpl)).rejects.toThrow('HTTP 503');
  });
});
