import { Injectable, ServiceUnavailableException } from "@nestjs/common";

@Injectable()
export class OperatonService {
  readonly baseUrl = process.env.OPERATON_URL ?? "http://localhost:8080/engine-rest";

  private readonly auth =
    "Basic " +
    Buffer.from(
      `${process.env.OPERATON_USER ?? "demo"}:${process.env.OPERATON_PASSWORD ?? "demo"}`,
    ).toString("base64");

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: this.auth,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new ServiceUnavailableException(
        "Operaton chưa chạy tại http://localhost:8080.",
      );
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const data = text ? safeJson(text) : null;
    if (!response.ok) {
      const message =
        data && typeof data === "object" && "message" in data && typeof data.message === "string"
          ? data.message
          : `Operaton trả về lỗi ${response.status}`;
      throw new Error(message);
    }
    return data as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
