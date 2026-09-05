type ApiErrorBody = { error?: string; errors?: string[] }

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null
    throw new Error(body?.error ?? '요청을 처리하지 못했어요.')
  }
  return (await response.json()) as T
}

export async function apiGet<T>(path: string): Promise<T> {
  return handle<T>(await fetch(path))
}

export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return handle<T>(response)
}
