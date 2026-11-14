"use client";

import { FormEvent, useEffect, useState } from "react";
import { MinutesButton } from "./minutes-button";
import { api, Deployment, FormField, Health, ProcessDefinition, WorkCase, WorkTask } from "../lib/api";

export default function Page() {
  const [health, setHealth] = useState<Health | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deploymentId, setDeploymentId] = useState("all");
  const [processDefinitionId, setProcessDefinitionId] = useState("");
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [cases, setCases] = useState<WorkCase[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  async function reloadWork(nextDeploymentId = deploymentId, nextProcessId = processDefinitionId) {
    const work = await api.work({
      deploymentId: nextDeploymentId === "all" ? undefined : nextDeploymentId,
      processDefinitionId: nextProcessId || undefined,
    });
    setTasks(work.tasks);
    setCases(work.cases);
  }

  useEffect(() => {
    Promise.all([api.health(), api.deployments(), api.work({})])
      .then(([nextHealth, nextDeployments, work]) => {
        setHealth(nextHealth);
        setDeployments(nextDeployments);
        setTasks(work.tasks);
        setCases(work.cases);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  function chooseDeployment(id: string) {
    const deployment = deployments.find((item) => item.id === id);
    const onlyProcess = deployment?.processes.length === 1 ? deployment.processes[0].id : "";
    setDeploymentId(id);
    setProcessDefinitionId(onlyProcess);
    setNotice("");
    setError("");
    reloadWork(id, onlyProcess).catch((reason: Error) => setError(reason.message));
  }

  function chooseProcess(id: string) {
    setProcessDefinitionId(id);
    setNotice("");
    setError("");
    reloadWork(deploymentId, id).catch((reason: Error) => setError(reason.message));
  }

  const selectedDeployment = deployments.find((item) => item.id === deploymentId) ?? null;
  const selectedProcess =
    deployments.flatMap((item) => item.processes).find((item) => item.id === processDefinitionId) ?? null;
  const needle = query.trim().toLowerCase();
  const visibleDeployments = deployments.filter((deployment) => {
    if (!needle) return true;
    const haystack = [deployment.name, ...deployment.processes.map((process) => process.name)].join(" ").toLowerCase();
    return haystack.includes(needle);
  });

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <img src="/logo-gafood.png" alt="Gafood" />
          <div>
            <h1>Quy trình</h1>
            <p className="lede">
              Chọn một deployment trên Operaton. Form và các bước lấy từ file BPMN của deployment đó.
            </p>
          </div>
        </div>
        <ol className="chain">
          <li>Next.js :3000</li>
          <li>NestJS :3001</li>
          <li>Operaton :8080</li>
        </ol>
      </header>

      {error ? <p className="banner error">{error}</p> : null}
      {notice ? <p className="banner ok">{notice}</p> : null}
      {health && !health.ok ? <p className="banner error">{health.message}</p> : null}

      <div className="shell">
        <aside className="card sidebar">
          <h2>Deployments</h2>
          <p className="muted">
            {health?.ok ? `${health.deployments} gói, ${health.processes} quy trình` : "Danh sách gói đã deploy."}
          </p>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm deployment hoặc quy trình"
            aria-label="Tìm deployment"
          />
          <div className="deploy-list">
            <button
              type="button"
              className={deploymentId === "all" ? "choice active" : "choice"}
              onClick={() => chooseDeployment("all")}
            >
              <strong>Tất cả</strong>
              <span>Mọi việc và hồ sơ</span>
            </button>
            {visibleDeployments.map((deployment) => (
              <button
                key={deployment.id}
                type="button"
                className={deployment.id === deploymentId ? "choice active" : "choice"}
                title={deployment.name}
                onClick={() => chooseDeployment(deployment.id)}
              >
                <strong>{shortName(deployment.name)}</strong>
                <span>{deploymentSummary(deployment)}</span>
              </button>
            ))}
            {!loading && visibleDeployments.length === 0 ? <p className="empty">Không có deployment khớp.</p> : null}
          </div>
        </aside>

        <div className="workspace">
          <div className={selectedDeployment ? "work-grid" : "work-grid single"}>
            {selectedDeployment ? (
              <StartPanel
                deployment={selectedDeployment}
                process={selectedProcess}
                onProcess={chooseProcess}
                onDone={async (message) => {
                  setNotice(message);
                  setError("");
                  await reloadWork();
                }}
                onError={setError}
              />
            ) : null}

            <section className="card">
              <h2>Việc cần làm</h2>
              <p className="muted">
                {selectedDeployment
                  ? "Việc đang mở trong deployment này."
                  : "Chọn một deployment bên trái để mở hồ sơ mới."}
              </p>
              {loading ? <p className="empty">Đang tải…</p> : null}
              {!loading && tasks.length === 0 ? <p className="empty">Không có việc đang mở.</p> : null}
              <div className="tasks">
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onDone={async (message) => {
                      setNotice(message);
                      setError("");
                      await reloadWork();
                    }}
                    onError={setError}
                  />
                ))}
              </div>
            </section>
          </div>

          <section className="card">
            <h2>Hồ sơ</h2>
            <p className="muted">Mỗi thẻ là một lần chạy quy trình.</p>
            {!loading && cases.length === 0 ? <p className="empty">Chưa có hồ sơ.</p> : null}
            <div className="dossiers">
              {cases.map((item) => (
                <article className="dossier" key={item.id}>
                  <header>
                    <strong>{item.businessKey || item.processDefinitionName}</strong>
                    <span className="row">
                      <MinutesButton item={item} />
                      <span className={item.endTime ? "badge paid" : "badge waiting"}>{item.status}</span>
                    </span>
                  </header>
                  <ul className="facts">
                    <li>Quy trình <strong>{item.processDefinitionName}</strong></li>
                    <li>Deployment <strong>{shortName(item.deploymentName) || "—"}</strong></li>
                    {item.variables.map((variable) => (
                      <li key={variable.name}>{variable.name} <strong>{variable.value}</strong></li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function StartPanel({
  deployment,
  process,
  onProcess,
  onDone,
  onError,
}: {
  deployment: Deployment | null;
  process: ProcessDefinition | null;
  onProcess: (id: string) => void;
  onDone: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  if (!deployment) {
    return (
      <section className="card">
        <h2>Mở hồ sơ</h2>
        <p className="empty">Chọn một deployment để mở hồ sơ mới.</p>
      </section>
    );
  }
  if (deployment.processes.length === 0) {
    return (
      <section className="card">
        <h2 title={deployment.name}>{shortName(deployment.name)}</h2>
        <p className="empty">Deployment này không chứa quy trình BPMN để chạy.</p>
      </section>
    );
  }
  return (
    <section className="card stack">
      <div>
        <h2 title={deployment.name}>{shortName(deployment.name)}</h2>
        <p className="muted">Deployment có {deployment.processes.length} quy trình.</p>
      </div>
      {deployment.processes.length > 1 ? (
        <label>
          Quy trình
          <select value={process?.id ?? ""} onChange={(event) => onProcess(event.target.value)}>
            <option value="">Chọn quy trình</option>
            {deployment.processes.map((item) => (
              <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>
            ))}
          </select>
        </label>
      ) : null}
      {process ? (
        <StartForm
          key={process.id}
          process={process}
          onDone={onDone}
          onError={onError}
        />
      ) : (
        <p className="empty">Chọn quy trình trong deployment này.</p>
      )}
    </section>
  );
}

function StartForm({
  process,
  onDone,
  onError,
}: {
  process: ProcessDefinition;
  onDone: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [businessKey, setBusinessKey] = useState("");
  const [values, setValues] = useState<Record<string, string | boolean>>(() => initialValues(process.startFields));
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await api.start({
        processDefinitionId: process.id,
        businessKey,
        values: submittedValues(process.startFields, values),
      });
      setBusinessKey("");
      setValues(initialValues(process.startFields));
      await onDone(`Đã mở hồ sơ ${businessKey || process.name}.`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Không mở được hồ sơ");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <p className="muted">{process.name} · v{process.version}{process.resource ? ` · ${process.resource}` : ""}</p>
      <label>
        Mã hồ sơ
        <input value={businessKey} onChange={(event) => setBusinessKey(event.target.value)} />
      </label>
      {process.startFields.length === 0 ? (
        <p className="empty">Quy trình này không có form bắt đầu. Operaton đi thẳng tới bước đầu tiên.</p>
      ) : (
        process.startFields.map((field) => (
          <FieldInput
            key={field.id}
            field={field}
            value={values[field.id]}
            onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
          />
        ))
      )}
      <button className="primary" type="submit" disabled={pending || process.suspended}>
        {process.suspended ? "Quy trình đang tạm dừng" : "Mở hồ sơ"}
      </button>
    </form>
  );
}

function TaskCard({
  task,
  onDone,
  onError,
}: {
  task: WorkTask;
  onDone: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const writable = task.fields.filter((field) => !field.readonly);
  const readonly = task.fields.filter((field) => field.readonly);
  const [values, setValues] = useState<Record<string, string | boolean>>(() => initialValues(writable, true));
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await api.complete(task.id, submittedValues(writable, values));
      await onDone(`Đã hoàn thành "${task.name}".`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "Không hoàn thành được việc");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="task stack" onSubmit={submit}>
      <header>
        <div>
          <strong>{task.name}</strong>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {task.processDefinitionName}
            {task.businessKey ? ` · ${task.businessKey}` : ""}
            {task.assignee ? ` · ${task.assignee}` : " · chưa giao"}
          </p>
        </div>
      </header>
      {task.description ? <p className="muted">{task.description}</p> : null}
      {readonly.length > 0 ? (
        <ul className="facts">
          {readonly.map((field) => (
            <li key={field.id}>{field.label} <strong>{display(field.value)}</strong></li>
          ))}
        </ul>
      ) : null}
      {writable.map((field) => (
        <FieldInput
          key={field.id}
          field={field}
          value={values[field.id]}
          onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
        />
      ))}
      <button className="primary" type="submit" disabled={pending}>Hoàn thành</button>
    </form>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
}) {
  if (field.readonly) {
    return (
      <p className="muted">{field.label}: <strong>{display(field.value)}</strong></p>
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="check">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.label}
      </label>
    );
  }
  if (field.type === "enum") {
    return (
      <label>
        {field.label}
        <select
          value={typeof value === "string" ? value : ""}
          required={field.required}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Chọn</option>
          {field.options.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label>
      {field.label}
      <input
        value={typeof value === "string" ? value : ""}
        required={field.required}
        inputMode={field.type === "long" ? "numeric" : undefined}
        type={field.type === "date" ? "date" : "text"}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function initialValues(fields: FormField[], preferCurrent = false) {
  const values: Record<string, string | boolean> = {};
  for (const field of fields) {
    if (field.readonly) continue;
    if (field.type === "boolean") {
      const current = preferCurrent ? field.value : undefined;
      values[field.id] = typeof current === "boolean" ? current : field.defaultValue === "true";
      continue;
    }
    const current = preferCurrent && field.value != null ? String(field.value) : "";
    values[field.id] = current || field.defaultValue || "";
  }
  return values;
}

function submittedValues(fields: FormField[], values: Record<string, string | boolean>) {
  const body: Record<string, string | boolean> = {};
  for (const field of fields) {
    if (field.readonly) continue;
    body[field.id] = values[field.id] ?? (field.type === "boolean" ? false : "");
  }
  return body;
}

function shortName(name: string) {
  const piece = name.split("/").filter(Boolean).pop() ?? name;
  return piece.replace(/\.(bpmn20\.xml|bpmn)$/i, "");
}

function deploymentSummary(deployment: Deployment) {
  if (deployment.processes.length === 0) return "Không có quy trình";
  if (deployment.processes.length === 1) return deployment.processes[0].name;
  return `${deployment.processes.length} quy trình`;
}

function display(value: unknown) {
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN").format(value);
  if (value == null || value === "") return "—";
  return String(value);
}
