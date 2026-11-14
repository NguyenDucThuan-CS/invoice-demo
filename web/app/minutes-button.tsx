"use client";

import { FormEvent, PointerEvent, useEffect, useState } from "react";
import { api, WorkCase } from "../lib/api";

type Signer = { name: string; email: string };
type Box = { signer: number; x: number; y: number };
type Link = { name: string; email: string; signingUrl: string };

const COLORS = ["#008738", "#1d4ed8", "#b06010", "#7c3aed", "#b42318", "#0f766e"];
const BOX = { width: 28, height: 7 };
const TOKEN_KEY = "gafood-documenso-token";

export function MinutesButton({ item }: { item: WorkCase }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  useEffect(() => {
    setToken(window.localStorage.getItem(TOKEN_KEY) ?? "");
  }, []);
  const [signers, setSigners] = useState<Signer[]>([{ name: "", email: "" }]);
  const [active, setActive] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [links, setLinks] = useState<Link[]>([]);
  const [frame, setFrame] = useState(0);

  function addSigner() {
    setSigners((current) => (current.length >= 6 ? current : [...current, { name: "", email: "" }]));
  }

  function place(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".sign-box")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;
    setBoxes((current) => [
      ...current,
      {
        signer: active,
        x: Math.min(100 - BOX.width, Math.max(0, x - BOX.width / 2)),
        y: Math.min(100 - BOX.height, Math.max(0, y - BOX.height / 2)),
      },
    ]);
  }

  function move(index: number, event: PointerEvent<HTMLButtonElement>) {
    const page = event.currentTarget.parentElement;
    if (!page) return;
    const bounds = page.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = boxes[index];
    event.currentTarget.setPointerCapture(event.pointerId);
    const drag = (moveEvent: globalThis.PointerEvent) => {
      const x = origin.x + ((moveEvent.clientX - startX) / bounds.width) * 100;
      const y = origin.y + ((moveEvent.clientY - startY) / bounds.height) * 100;
      setBoxes((current) =>
        current.map((box, boxIndex) =>
          boxIndex === index
            ? {
                ...box,
                x: Math.min(100 - BOX.width, Math.max(0, x)),
                y: Math.min(100 - BOX.height, Math.max(0, y)),
              }
            : box,
        ),
      );
    };
    const stop = () => {
      event.currentTarget.removeEventListener("pointermove", drag);
      event.currentTarget.removeEventListener("pointerup", stop);
    };
    event.currentTarget.addEventListener("pointermove", drag);
    event.currentTarget.addEventListener("pointerup", stop);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      window.localStorage.setItem(TOKEN_KEY, token.trim());
      const result = await api.minutes(
        item.id,
        {
          signers,
          fields: boxes.map((box) => ({ ...box, width: BOX.width, height: BOX.height })),
        },
        token.trim(),
      );
      const next = result.signers.filter((signer) => signer.signingUrl);
      setLinks(next);
      setFrame(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không tạo được biên bản");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="ghost small" onClick={() => setOpen(true)}>
        In biên bản
      </button>
    );
  }

  return (
    <div className="minutes-backdrop" role="presentation" onClick={() => setOpen(false)}>
      <form className="minutes" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        <header>
          <div>
            <h2>Biên bản {item.businessKey || item.processDefinitionName}</h2>
            <p className="muted">Chọn người ký, rồi bấm lên trang để đặt ô chữ ký. Kéo ô để đổi vị trí.</p>
          </div>
          <button type="button" className="ghost small" onClick={() => setOpen(false)}>Đóng</button>
        </header>

        <label>
          API token Documenso
          <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="api_..." autoComplete="off" />
        </label>
        <p className="muted">
          Mở http://localhost:3005, đăng ký, vào phần API token và dán vào đây. Trang ký của Documenso cho phép vẽ tay hoặc tải ảnh chữ ký.
        </p>

        <div className="minutes-grid">
          <div className="stack">
            {signers.map((signer, index) => (
              <div key={index} className={index === active ? "signer active" : "signer"} style={{ borderColor: COLORS[index % COLORS.length] }}>
                <button type="button" className="signer-pick" onClick={() => setActive(index)}>
                  Người ký {index + 1}
                </button>
                <input
                  value={signer.name}
                  placeholder="Tên"
                  onChange={(event) => updateSigner(setSigners, index, { name: event.target.value })}
                />
                <input
                  value={signer.email}
                  placeholder="email@gafood.local"
                  onChange={(event) => updateSigner(setSigners, index, { email: event.target.value })}
                />
              </div>
            ))}
            <button type="button" className="ghost" onClick={addSigner}>Thêm người ký</button>
            {boxes.length > 0 ? (
              <button type="button" className="ghost" onClick={() => setBoxes((current) => current.slice(0, -1))}>
                Xóa ô vừa đặt
              </button>
            ) : null}
          </div>

          <div className="sheet" onPointerDown={place}>
            <p className="sheet-title">Biên bản hồ sơ</p>
            <p><strong>{item.businessKey || item.processDefinitionName}</strong></p>
            <p className="muted">Quy trình {item.processDefinitionName}</p>
            <p className="muted">Trạng thái {item.status}</p>
            <ul>
              {item.variables.map((variable) => (
                <li key={variable.name}>{variable.name}: {variable.value}</li>
              ))}
            </ul>
            {boxes.map((box, index) => (
              <button
                key={`${box.signer}-${index}`}
                type="button"
                className="sign-box"
                style={{
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${BOX.width}%`,
                  height: `${BOX.height}%`,
                  borderColor: COLORS[box.signer % COLORS.length],
                  color: COLORS[box.signer % COLORS.length],
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  move(index, event);
                }}
              >
                Ký · {signers[box.signer]?.name || `Người ${box.signer + 1}`}
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="warn">{error}</p> : null}
        {links.length > 0 ? (
          <div className="sign-frame">
            <div className="sign-tabs">
              {links.map((link, index) => (
                <button
                  key={link.signingUrl}
                  type="button"
                  className={index === frame ? "active" : ""}
                  onClick={() => setFrame(index)}
                >
                  {link.name || link.email}
                </button>
              ))}
            </div>
            <iframe title={`Trang ký của ${links[frame].name || links[frame].email}`} src={links[frame].signingUrl} />
          </div>
        ) : null}
        <button className="primary" type="submit" disabled={pending}>
          {pending ? "Đang tạo biên bản…" : "Tạo biên bản và gửi ký"}
        </button>
      </form>
    </div>
  );
}

function updateSigner(
  setSigners: (update: (current: Signer[]) => Signer[]) => void,
  index: number,
  patch: Partial<Signer>,
) {
  setSigners((current) => current.map((signer, signerIndex) => (signerIndex === index ? { ...signer, ...patch } : signer)));
}
