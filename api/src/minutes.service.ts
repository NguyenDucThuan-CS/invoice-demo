import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { readFileSync } from "fs";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { WorkService } from "./work.service";

export type SignatureRequest = {
  signers?: { name?: string; email?: string }[];
  fields?: { signer?: number; x?: number; y?: number; width?: number; height?: number }[];
};

type Signer = { name: string; email: string };
type Field = { signer: number; x: number; y: number; width: number; height: number };

const FONT_PATH = process.env.MINUTES_FONT ?? "/System/Library/Fonts/Supplemental/Arial Unicode.ttf";
const DOCUMENSO_URL = (process.env.DOCUMENSO_URL ?? "http://localhost:3005").replace(/\/$/, "");

@Injectable()
export class MinutesService {
  constructor(@Inject(WorkService) private readonly workService: WorkService) {}

  async create(processInstanceId: string, body: SignatureRequest, token: string | undefined) {
    const apiToken = (token || process.env.DOCUMENSO_API_TOKEN || "").trim();
    if (!apiToken) {
      throw new BadRequestException(
        "Cần API token của Documenso. Tạo token trong Documenso rồi dán vào ô trên hộp thoại.",
      );
    }
    const signers = normalizeSigners(body.signers ?? []);
    const fields = normalizeFields(body.fields ?? [], signers.length);
    const sheet = await this.workService.caseSheet(processInstanceId);
    const pdf = await renderMinutes(sheet);
    const title = `Biên bản ${sheet.businessKey || sheet.processDefinitionName}`;
    const payload = JSON.stringify({
      type: "DOCUMENT",
      title,
      externalId: sheet.id,
      recipients: signers.map((signer, index) => ({
        email: signer.email,
        name: signer.name,
        role: "SIGNER",
        signingOrder: index + 1,
        fields: fields
          .filter((field) => field.signer === index)
          .map((field) => ({
            identifier: 0,
            type: "SIGNATURE",
            page: 1,
            positionX: field.x,
            positionY: field.y,
            width: field.width,
            height: field.height,
          })),
      })),
    });
    const file = multipartBody([
      { name: "payload", type: "application/json", body: payload },
      { name: "files", filename: "bien-ban.pdf", type: "application/pdf", body: pdf },
    ]);
    const created = await documenso(apiToken, "/envelope/create", file.body, file.contentType);
    const envelopeId = stringField(created, "id");
    if (!envelopeId) throw new Error("Documenso không trả về mã biên bản.");
    const sent = await documenso(
      apiToken,
      "/envelope/distribute",
      JSON.stringify({ envelopeId }),
      "application/json",
    );
    const recipients = Array.isArray(sent.recipients) ? sent.recipients : [];
    return {
      envelopeId,
      signers: recipients.map((recipient) => ({
        name: stringField(asRecord(recipient), "name"),
        email: stringField(asRecord(recipient), "email"),
        signingUrl: stringField(asRecord(recipient), "signingUrl"),
      })),
    };
  }
}

async function renderMinutes(sheet: {
  businessKey: string | null;
  processDefinitionName: string;
  deploymentName: string;
  status: string;
  variables: { name: string; value: string }[];
}) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(readFileSync(FONT_PATH), { subset: true });
  const page = pdf.addPage([595.28, 841.89]);
  const green = rgb(0, 0.34, 0.16);
  const ink = rgb(0.06, 0.09, 0.16);
  const muted = rgb(0.39, 0.45, 0.55);
  let y = 790;
  page.drawText("Biên bản hồ sơ", { x: 48, y, size: 22, font, color: green });
  y -= 28;
  page.drawText(sheet.businessKey || sheet.processDefinitionName, { x: 48, y, size: 14, font, color: ink });
  y -= 22;
  for (const line of [
    `Quy trình: ${sheet.processDefinitionName}`,
    `Deployment: ${sheet.deploymentName || "—"}`,
    `Trạng thái: ${sheet.status}`,
  ]) {
    page.drawText(line, { x: 48, y, size: 11, font, color: muted });
    y -= 16;
  }
  y -= 8;
  page.drawLine({ start: { x: 48, y }, end: { x: 547, y }, thickness: 1, color: rgb(0.89, 0.91, 0.94) });
  y -= 24;
  for (const variable of sheet.variables) {
    const text = `${variable.name}: ${variable.value}`;
    for (const part of wrap(text, 78)) {
      if (y < 72) break;
      page.drawText(part, { x: 48, y, size: 12, font, color: ink });
      y -= 18;
    }
  }
  return Buffer.from(await pdf.save());
}

function wrap(text: string, size: number) {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > size) {
    parts.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  parts.push(rest);
  return parts;
}

function normalizeSigners(rows: { name?: string; email?: string }[]): Signer[] {
  const signers = rows.map((row) => ({
    name: (row.name ?? "").trim(),
    email: (row.email ?? "").trim(),
  }));
  if (signers.length === 0) throw new BadRequestException("Cần ít nhất một người ký.");
  if (signers.length > 6) throw new BadRequestException("Chỉ đặt tối đa 6 người ký.");
  for (const signer of signers) {
    if (!signer.name) throw new BadRequestException("Mỗi người ký cần có tên.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signer.email)) {
      throw new BadRequestException(`Email của ${signer.name} không hợp lệ.`);
    }
  }
  return signers;
}

function normalizeFields(rows: SignatureRequest["fields"], signerCount: number): Field[] {
  const fields = (rows ?? []).map((row) => ({
    signer: Number(row.signer),
    x: clamp(row.x, 0, 90),
    y: clamp(row.y, 0, 92),
    width: clamp(row.width ?? 28, 12, 50),
    height: clamp(row.height ?? 7, 4, 16),
  }));
  if (fields.length === 0) throw new BadRequestException("Bấm lên trang biên bản để đặt ô chữ ký.");
  for (const field of fields) {
    if (!Number.isInteger(field.signer) || field.signer < 0 || field.signer >= signerCount) {
      throw new BadRequestException("Ô chữ ký chưa gắn với người ký.");
    }
  }
  for (let index = 0; index < signerCount; index += 1) {
    if (!fields.some((field) => field.signer === index)) {
      throw new BadRequestException("Mỗi người ký cần một ô trên biên bản.");
    }
  }
  return fields;
}

function clamp(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new BadRequestException("Vị trí chữ ký không hợp lệ.");
  return Math.min(max, Math.max(min, number));
}

function multipartBody(
  parts: { name: string; filename?: string; type: string; body: Buffer | string }[],
) {
  const boundary = `----gafood${Date.now().toString(16)}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = part.filename
      ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"`
      : `Content-Disposition: form-data; name="${part.name}"`;
    chunks.push(Buffer.from(`--${boundary}\r\n${disposition}\r\nContent-Type: ${part.type}\r\n\r\n`));
    chunks.push(typeof part.body === "string" ? Buffer.from(part.body) : part.body);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: new Uint8Array(Buffer.concat(chunks)),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function documenso(
  token: string,
  path: string,
  body: BodyInit,
  contentType: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${DOCUMENSO_URL}/api/v2${path}`, {
      method: "POST",
      headers: { Authorization: token, Accept: "application/json", "Content-Type": contentType },
      body,
    });
  } catch {
    throw new ServiceUnavailableException(
      "Documenso chưa chạy. Hãy chạy docker compose trong invoice-demo/documenso rồi mở http://localhost:3005.",
    );
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = data && typeof data.message === "string" ? data.message : `Documenso trả về lỗi ${response.status}`;
    throw new Error(message);
  }
  return data ?? {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
