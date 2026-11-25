/**
 * 載入完整員工名單（瀏覽器端用）。
 * `/api/employees` 不帶 limit 時每頁只回 10 人，且單頁最多 1,000 人，所以不能把第一頁當成全部；
 * 這裡依 `pagination.pages` 逐頁取完。排序固定用姓名＋id（伺服器端有 id 當同值排序），
 * 翻頁才不會因為建立時間相同而重複或漏人。
 */
export interface LoadAllEmployeesOptions {
  /** 只要在職（active）或只要離職（inactive）；不帶就是全部 */
  status?: 'active' | 'inactive';
  /** 每頁筆數，伺服器上限 1,000 */
  pageSize?: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function loadAllEmployees<T extends { id: number }>(
  options: LoadAllEmployeesOptions = {},
  fetchImpl: FetchLike = (input, init) => fetch(input, init)
): Promise<T[]> {
  const pageSize = options.pageSize ?? 1000;
  const employees: T[] = [];
  const seen = new Set<number>();

  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(pageSize),
      sortBy: 'name',
      sortOrder: 'asc',
    });
    if (options.status) params.set('status', options.status);

    const response = await fetchImpl(`/api/employees?${params}`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`載入員工清單失敗（HTTP ${response.status}）`);
    }

    const data = await response.json();
    const batch: T[] = Array.isArray(data?.employees) ? data.employees : [];
    for (const employee of batch) {
      if (!seen.has(employee.id)) {
        seen.add(employee.id);
        employees.push(employee);
      }
    }

    const pages = Number(data?.pagination?.pages);
    totalPages = Number.isFinite(pages) && pages > 0 ? pages : 1;
    if (batch.length === 0) break; // 後面的頁已經沒資料（名單中途變少），不要空轉
    page += 1;
  }

  return employees;
}
