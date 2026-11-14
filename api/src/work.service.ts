import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { FormField, ParsedForms, parseBpmnForms } from "./bpmn-form";
import { OperatonService } from "./operaton.service";

type DeploymentDto = {
  id: string;
  name: string | null;
  deploymentTime: string;
};

type DefinitionDto = {
  id: string;
  key: string;
  name: string | null;
  version: number;
  resource: string | null;
  deploymentId: string;
  suspended: boolean;
};

type ProcessInstance = {
  id: string;
  businessKey: string | null;
  processDefinitionId: string;
  processDefinitionKey: string;
  processDefinitionName: string | null;
  startTime: string;
  endTime: string | null;
  state: string;
};

type EngineTask = {
  id: string;
  name: string;
  description: string | null;
  taskDefinitionKey: string;
  processDefinitionId: string;
  processInstanceId: string;
  assignee: string | null;
  created: string;
};

type HistoricVariable = {
  name: string;
  value: unknown;
  processInstanceId: string;
};

type Activity = {
  processInstanceId: string;
  activityName: string | null;
  activityId: string;
};

@Injectable()
export class WorkService {
  private readonly formsCache = new Map<string, ParsedForms>();

  constructor(@Inject(OperatonService) private readonly operaton: OperatonService) {}

  async health() {
    try {
      const [deployments, definitions] = await Promise.all([
        this.operaton.request<{ count: number }>("/deployment/count"),
        this.operaton.request<{ count: number }>("/process-definition/count?latestVersion=true"),
      ]);
      return {
        ok: true,
        operaton: this.operaton.baseUrl,
        deployments: deployments.count,
        processes: definitions.count,
      };
    } catch (error) {
      return {
        ok: false,
        operaton: this.operaton.baseUrl,
        message: error instanceof Error ? error.message : "Không kết nối được Operaton",
      };
    }
  }

  async deployments() {
    const [deployments, definitions] = await Promise.all([
      this.operaton.request<DeploymentDto[]>("/deployment?sortBy=deploymentTime&sortOrder=desc"),
      this.operaton.request<DefinitionDto[]>("/process-definition"),
    ]);

    const processes = await Promise.all(definitions.map((definition) => this.describe(definition)));
    return deployments.map((deployment) => ({
      id: deployment.id,
      name: deployment.name ?? deployment.id,
      deploymentTime: deployment.deploymentTime,
      processes: processes.filter((process) => process.deploymentId === deployment.id),
    }));
  }

  async work(filter: { deploymentId?: string; processDefinitionId?: string }) {
    const definitions = await this.operaton.request<DefinitionDto[]>("/process-definition");
    const deployments = await this.operaton.request<DeploymentDto[]>("/deployment");
    const deploymentName = new Map(deployments.map((item) => [item.id, item.name ?? item.id]));
    const definitionById = new Map(definitions.map((item) => [item.id, item]));

    let allowed = definitions;
    if (filter.processDefinitionId) {
      allowed = definitions.filter((item) => item.id === filter.processDefinitionId);
    } else if (filter.deploymentId) {
      allowed = definitions.filter((item) => item.deploymentId === filter.deploymentId);
    }
    const allowedIds = filter.deploymentId || filter.processDefinitionId ? allowed.map((item) => item.id) : null;

    const [instances, tasks] = await Promise.all([
      this.instances(allowedIds),
      this.tasks(allowedIds),
    ]);

    const variableRows = instances.length
      ? await this.operaton.request<HistoricVariable[]>(
          `/history/variable-instance?processInstanceIdIn=${instances.map((item) => item.id).join(",")}`,
        )
      : [];
    const values = groupVariables(variableRows);
    const endings = await this.endings(instances);
    const forms = new Map<string, ParsedForms>();
    for (const definitionId of new Set([...instances, ...tasks].map((item) => item.processDefinitionId))) {
      forms.set(definitionId, await this.forms(definitionId));
    }

    const taskViews = tasks.map((task) => {
      const definition = definitionById.get(task.processDefinitionId);
      const parsed = forms.get(task.processDefinitionId);
      const data = values.get(task.processInstanceId) ?? {};
      const instance = instances.find((item) => item.id === task.processInstanceId);
      return {
        id: task.id,
        name: task.name,
        description: task.description,
        assignee: task.assignee,
        created: task.created,
        processDefinitionId: task.processDefinitionId,
        processDefinitionKey: definition?.key ?? "",
        processDefinitionName: definition?.name ?? definition?.key ?? task.processDefinitionId,
        processInstanceId: task.processInstanceId,
        businessKey: instance?.businessKey ?? null,
        fields: (parsed?.taskFields[task.taskDefinitionKey] ?? []).map((field) => ({
          ...field,
          value: data[field.id] ?? null,
        })),
      };
    });

    const cases = instances.map((instance) => {
      const definition = definitionById.get(instance.processDefinitionId);
      const parsed = forms.get(instance.processDefinitionId);
      const labels = labelMap(parsed);
      const data = values.get(instance.id) ?? {};
      const openTasks = taskViews.filter((task) => task.processInstanceId === instance.id);
      return {
        id: instance.id,
        businessKey: instance.businessKey,
        processDefinitionKey: instance.processDefinitionKey,
        processDefinitionName: instance.processDefinitionName ?? definition?.name ?? instance.processDefinitionKey,
        deploymentName: definition ? deploymentName.get(definition.deploymentId) ?? "" : "",
        startTime: instance.startTime,
        endTime: instance.endTime,
        status: instance.endTime
          ? endings.get(instance.id) ?? "Đã xong"
          : openTasks.map((task) => task.name).join(", ") || "Đang chạy",
        variables: Object.entries(data)
          .filter(([, value]) => value != null && value !== "")
          .map(([name, value]) => ({
            name: labels.get(name) ?? name,
            value: formatValue(value),
          })),
      };
    });

    return { tasks: taskViews, cases };
  }

  async start(processDefinitionId: string, businessKey: string | undefined, values: Record<string, unknown>) {
    if (!processDefinitionId) throw new BadRequestException("Cần chọn một quy trình.");
    const definition = await this.operaton.request<DefinitionDto>(
      `/process-definition/${encodeURIComponent(processDefinitionId)}`,
    );
    if (definition.suspended) throw new BadRequestException("Quy trình này đang tạm dừng.");
    const fields = (await this.forms(processDefinitionId)).startFields;
    const started = await this.operaton.request<{ id: string }>(
      `/process-definition/${encodeURIComponent(processDefinitionId)}/start`,
      {
        method: "POST",
        body: JSON.stringify({
          ...(businessKey?.trim() ? { businessKey: businessKey.trim() } : {}),
          variables: typedVariables(fields, values),
        }),
      },
    );
    return { id: started.id };
  }

  async complete(taskId: string, values: Record<string, unknown>) {
    const task = await this.operaton.request<EngineTask>(`/task/${encodeURIComponent(taskId)}`);
    if (!task?.id) throw new NotFoundException("Không còn việc này.");
    const fields = (await this.forms(task.processDefinitionId)).taskFields[task.taskDefinitionKey] ?? [];
    await this.operaton.request(`/task/${encodeURIComponent(taskId)}/complete`, {
      method: "POST",
      body: JSON.stringify({ variables: typedVariables(fields.filter((field) => !field.readonly), values) }),
    });
    return { ok: true };
  }

  async caseSheet(processInstanceId: string) {
    const id = encodeURIComponent(processInstanceId);
    let instance: ProcessInstance;
    try {
      instance = await this.operaton.request<ProcessInstance>(`/history/process-instance/${id}`);
    } catch {
      throw new NotFoundException("Không tìm thấy hồ sơ.");
    }
    if (!instance?.id) throw new NotFoundException("Không tìm thấy hồ sơ.");

    const [definition, variableRows, openTasks] = await Promise.all([
      this.operaton.request<DefinitionDto>(
        `/process-definition/${encodeURIComponent(instance.processDefinitionId)}`,
      ),
      this.operaton.request<HistoricVariable[]>(`/history/variable-instance?processInstanceId=${id}`),
      this.operaton.request<EngineTask[]>(`/task?processInstanceId=${id}`),
    ]);
    const deployment = await this.operaton.request<DeploymentDto>(
      `/deployment/${encodeURIComponent(definition.deploymentId)}`,
    );
    const labels = labelMap(await this.forms(instance.processDefinitionId));
    const data = groupVariables(variableRows).get(instance.id) ?? {};
    const endings = await this.endings([instance]);
    return {
      id: instance.id,
      businessKey: instance.businessKey,
      processDefinitionName: instance.processDefinitionName ?? definition.name ?? instance.processDefinitionKey,
      deploymentName: deployment.name ?? "",
      startTime: instance.startTime,
      endTime: instance.endTime,
      status: instance.endTime
        ? endings.get(instance.id) ?? "Đã xong"
        : openTasks.map((task) => task.name).join(", ") || "Đang chạy",
      variables: Object.entries(data)
        .filter(([, value]) => value != null && value !== "")
        .map(([name, value]) => ({
          name: labels.get(name) ?? name,
          value: formatValue(value),
        })),
    };
  }

  private async describe(definition: DefinitionDto) {
    const forms = await this.forms(definition.id);
    return {
      id: definition.id,
      key: definition.key,
      name: definition.name ?? definition.key,
      version: definition.version,
      resource: definition.resource,
      deploymentId: definition.deploymentId,
      suspended: definition.suspended,
      startFields: forms.startFields,
    };
  }

  private async forms(processDefinitionId: string) {
    const cached = this.formsCache.get(processDefinitionId);
    if (cached) return cached;
    const body = await this.operaton.request<{ bpmn20Xml: string }>(
      `/process-definition/${encodeURIComponent(processDefinitionId)}/xml`,
    );
    const parsed = parseBpmnForms(body.bpmn20Xml);
    this.formsCache.set(processDefinitionId, parsed);
    return parsed;
  }

  private instances(definitionIds: string[] | null) {
    if (definitionIds == null) {
      return this.operaton.request<ProcessInstance[]>(
        "/history/process-instance?sortBy=startTime&sortOrder=desc&maxResults=30",
      );
    }
    return this.byDefinition(definitionIds, (id) =>
      this.operaton.request<ProcessInstance[]>(
        `/history/process-instance?processDefinitionId=${encodeURIComponent(id)}&sortBy=startTime&sortOrder=desc&maxResults=20`,
      ),
    );
  }

  private tasks(definitionIds: string[] | null) {
    if (definitionIds == null) {
      return this.operaton.request<EngineTask[]>("/task?sortBy=created&sortOrder=desc&maxResults=40");
    }
    if (definitionIds.length === 1) {
      return this.operaton.request<EngineTask[]>(
        `/task?processDefinitionId=${encodeURIComponent(definitionIds[0])}&sortBy=created&sortOrder=desc`,
      );
    }
    return this.operaton.request<EngineTask[]>("/task?sortBy=created&sortOrder=desc&maxResults=80").then((tasks) => {
      const allowed = new Set(definitionIds);
      return tasks.filter((task) => allowed.has(task.processDefinitionId));
    });
  }

  private async byDefinition<T extends { startTime: string }>(ids: string[], load: (id: string) => Promise<T[]>) {
    if (ids.length === 0) return [];
    const pages = await Promise.all(ids.map(load));
    return pages.flat().sort((left, right) => right.startTime.localeCompare(left.startTime)).slice(0, 30);
  }

  private async endings(instances: ProcessInstance[]) {
    const keys = [...new Set(instances.filter((item) => item.endTime).map((item) => item.processDefinitionKey))];
    const pages = await Promise.all(
      keys.map((key) =>
        this.operaton.request<Activity[]>(
          `/history/activity-instance?processDefinitionKey=${encodeURIComponent(key)}&activityType=noneEndEvent`,
        ),
      ),
    );
    return new Map(pages.flat().map((item) => [item.processInstanceId, item.activityName || "Đã xong"]));
  }
}

function typedVariables(fields: FormField[], values: Record<string, unknown>) {
  const variables: Record<string, { value: string | number | boolean; type: string }> = {};
  for (const field of fields) {
    if (field.readonly) continue;
    const raw = values[field.id];
    if (field.type === "boolean") {
      variables[field.id] = { value: raw === true || raw === "true", type: "Boolean" };
      continue;
    }
    const text = raw == null ? "" : String(raw).trim();
    if (!text) {
      if (field.required) throw new BadRequestException(`Cần nhập ${field.label}.`);
      continue;
    }
    if (field.type === "long") {
      const amount = Number(text);
      if (!Number.isInteger(amount)) throw new BadRequestException(`${field.label} phải là số nguyên.`);
      variables[field.id] = { value: amount, type: "Long" };
      continue;
    }
    if (field.type === "enum" && !field.options.some((option) => option.id === text)) {
      throw new BadRequestException(`${field.label} không hợp lệ.`);
    }
    if (field.type === "date") {
      variables[field.id] = { value: text.includes("T") ? text : `${text}T00:00:00.000+0700`, type: "Date" };
      continue;
    }
    variables[field.id] = { value: text, type: "String" };
  }
  return variables;
}

function groupVariables(rows: HistoricVariable[]) {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const bucket = map.get(row.processInstanceId) ?? {};
    bucket[row.name] = row.value;
    map.set(row.processInstanceId, bucket);
  }
  return map;
}

function labelMap(forms: ParsedForms | undefined) {
  const labels = new Map<string, string>();
  if (!forms) return labels;
  for (const field of forms.startFields) labels.set(field.id, field.label);
  for (const fields of Object.values(forms.taskFields)) {
    for (const field of fields) labels.set(field.id, field.label);
  }
  return labels;
}

function formatValue(value: unknown) {
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN").format(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
