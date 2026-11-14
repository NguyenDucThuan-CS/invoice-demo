export type FormField = {
  id: string;
  label: string;
  type: "string" | "long" | "boolean" | "enum" | "date";
  required: boolean;
  readonly: boolean;
  defaultValue: string | null;
  options: { id: string; label: string }[];
  value?: unknown;
};

export type ProcessDefinition = {
  id: string;
  key: string;
  name: string;
  version: number;
  resource: string | null;
  suspended: boolean;
  startFields: FormField[];
};

export type Deployment = {
  id: string;
  name: string;
  deploymentTime: string;
  processes: ProcessDefinition[];
};

export type WorkTask = {
  id: string;
  name: string;
  description: string | null;
  assignee: string | null;
  created: string;
  processDefinitionName: string;
  businessKey: string | null;
  fields: FormField[];
};

export type WorkCase = {
  id: string;
  businessKey: string | null;
  processDefinitionName: string;
  deploymentName: string;
  startTime: string;
  endTime: string | null;
  status: string;
  variables: { name: string; value: string }[];
};

export type Health = {
  ok: boolean;
  operaton: string;
  deployments?: number;
  processes?: number;
  message?: string;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message;
    const text = Array.isArray(message) ? message.join(", ") : message;
    throw new Error(text || "Không gọi được máy chủ");
  }
  return data as T;
}

export const api = {
  health: () => request<Health>("/api/health"),
  deployments: () => request<Deployment[]>("/api/deployments"),
  work: (filter: { deploymentId?: string; processDefinitionId?: string }) => {
    const params = new URLSearchParams();
    if (filter.deploymentId) params.set("deploymentId", filter.deploymentId);
    if (filter.processDefinitionId) params.set("processDefinitionId", filter.processDefinitionId);
    const query = params.toString();
    return request<{ tasks: WorkTask[]; cases: WorkCase[] }>(`/api/work${query ? `?${query}` : ""}`);
  },
  start: (body: { processDefinitionId: string; businessKey?: string; values: Record<string, unknown> }) =>
    request<{ id: string }>("/api/processes/start", { method: "POST", body: JSON.stringify(body) }),
  complete: (taskId: string, values: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/tasks/${taskId}/complete`, {
      method: "POST",
      body: JSON.stringify({ values }),
    }),
  minutes: (
    caseId: string,
    body: {
      signers: { name: string; email: string }[];
      fields: { signer: number; x: number; y: number; width: number; height: number }[];
    },
    token: string,
  ) =>
    request<{ signers: { name: string; email: string; signingUrl: string }[] }>(
      `/api/cases/${encodeURIComponent(caseId)}/minutes`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "X-Documenso-Token": token },
      },
    ),
};
