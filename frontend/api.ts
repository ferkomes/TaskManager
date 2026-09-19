let accessToken = '';
export function setAccessToken(token: string) { accessToken = token; }
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string,string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api${path}`, {headers, method:body === undefined ? 'GET' : 'POST', body:body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)});
  const data = await response.json() as T & {error?:string};
  if (!response.ok) throw new Error(data.error || `A művelet nem sikerült (${response.status}).`);
  return data;
}
