export class ApiError extends Error {
  status: number;
  errorCode?: string;

  constructor(message: string, status = 500, errorCode?: string) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
  }
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const { headers: initHeaders, ...rest } = init ?? {};
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(initHeaders ?? {}),
    },
    ...rest,
  });

  const data = (await response.json()) as { status?: string; message?: string; error_code?: string };
  if (!response.ok || data.status === "error") {
    throw new ApiError(data.message ?? "请求失败", response.status, data.error_code);
  }
  return data as T;
}

export function apiPath(path: string) {
  const base = import.meta.env.VITE_API_BASE || "/api";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}
