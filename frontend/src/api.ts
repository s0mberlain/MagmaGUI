export interface VersionInfo {
  name: string;
  version: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  health: () => getJson<{ status: string }>("/api/health"),
  version: () => getJson<VersionInfo>("/api/version"),
};
