import { useEffect, useRef, useState } from "react";
import { api, describe, ApiError } from "./api.js";
import { array, record, text, type Json } from "../shared/model.js";
import { FRAME_TOOL } from "../shared/zmq-native.js";
export function FrameViewer({
  resourceId,
  frames = [],
  unavailableReason,
}: {
  resourceId: string;
  frames?: Json[];
  unavailableReason?: string;
}) {
  const [camera, setCamera] = useState(""),
    [frame, setFrame] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [result, setResult] = useState<Json>();
  const [href, setHref] = useState("");
  const inFlight = useRef(false);
  useEffect(
    () => () => {
      if (href) URL.revokeObjectURL(href);
    },
    [href],
  );
  async function open(cameraId = camera, frameId = frame) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setHref("");
    setCamera(cameraId);
    setFrame(frameId);
    try {
      const r = await api<Json>("/read", {
        tool: FRAME_TOOL,
        arguments: { resourceId, cameraId, frameId },
      });
      const response = await fetch("/api/frames/image", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceId, retrievalId: r.retrievalId }),
      });
      if (!response.ok) {
        const e = record(await response.json());
        throw new ApiError(text(e.reasonCode), e, response.status);
      }
      if (
        response.headers.get("content-type")?.split(";")[0] !== "image/jpeg" ||
        response.headers.get("x-content-sha256") !== r.sha256
      )
        throw Error("ZMQ_FRAME_CHUNK_INTEGRITY_FAILED");
      const blob = await response.blob();
      if (blob.size !== r.byteLength) throw Error("ZMQ_FRAME_CHUNK_INTEGRITY_FAILED");
      const { dataBase64: _data, ...metadata } = r;
      void _data;
      setResult(metadata);
      setHref(URL.createObjectURL(blob));
    } catch (e) {
      setError(e);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const metadata = record(result?.metadata),
    overlays = array(result?.overlays).map(record);
  return (
    <section className="panel frame-viewer">
      <h2>光电原图与同帧检测</h2>
      <p className="field-help">
        按相机和帧编号精确读取。原图缓存最多保留 5 分钟，容量不足时会提前淘汰。
      </p>
      {unavailableReason && (
        <div className="notice warning">{describe(Error(unavailableReason))}</div>
      )}
      {frames.map((f) => (
        <button
          key={`${text(f.camera_id)}/${text(f.frame_id)}`}
          disabled={busy || !!unavailableReason}
          onClick={() => void open(text(f.camera_id), text(f.frame_id))}
        >
          查看原图 · {text(f.camera_id)} · {text(f.frame_id)}
        </button>
      ))}
      <label>
        相机 ID
        <input value={camera} onChange={(e) => setCamera(e.target.value)} />
      </label>
      <label>
        帧编号
        <input value={frame} onChange={(e) => setFrame(e.target.value)} />
      </label>
      <button
        disabled={busy || !!unavailableReason || !camera || !frame}
        onClick={() => void open()}
      >
        {busy ? "正在读取指定帧…" : "查看指定帧原图"}
      </button>
      {error !== undefined && (
        <div className="notice warning" role="alert">
          {describe(error)}
        </div>
      )}
      {result && href && (
        <>
          <p>
            {text(metadata.camera_id)} · {text(metadata.frame_id)} · {text(metadata.width_px)}×
            {text(metadata.height_px)} · {text(result.byteLength)} 字节
          </p>
          <p>
            曝光 UTC：
            {metadata.exposure_utc_ms === null
              ? "未知（上游未提供）"
              : new Date(Number(metadata.exposure_utc_ms)).toISOString()}
          </p>
          <div
            className="frame-canvas"
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: `${Number(metadata.width_px)}/${Number(metadata.height_px)}`,
            }}
          >
            <img
              src={href}
              alt={`光电原图 ${text(metadata.frame_id)}`}
              style={{ display: "block", width: "100%", height: "100%" }}
            />
            <svg
              aria-label="同帧检测框与像素位置"
              viewBox={`0 0 ${Number(metadata.width_px)} ${Number(metadata.height_px)}`}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            >
              {overlays.map((o, i) => {
                const b = record(o.bbox),
                  p = record(o.pixel);
                return (
                  <g key={i} stroke="#38ff99" fill="none" strokeWidth="2">
                    {o.bbox != null && (
                      <rect
                        x={Number(b.x_px)}
                        y={Number(b.y_px)}
                        width={Number(b.width_px)}
                        height={Number(b.height_px)}
                      />
                    )}
                    {o.pixel != null && <circle cx={Number(p.x_px)} cy={Number(p.y_px)} r="4" />}
                  </g>
                );
              })}
            </svg>
          </div>
          {!overlays.length && <p>未收到可关联到此帧的检测结果。</p>}
          {overlays.some((o) => !o.bbox) && <p>部分目标未提供检测框，仅显示已知像素位置。</p>}
          {result.overlaysTruncated === true && <p>同帧检测内联已截断。</p>}
          <ul>
            {overlays.map((o, i) => {
              const p = record(o.pixel);
              return (
                <li key={i}>
                  {text(o.target_id) || `目标 ${i + 1}`} · 像素 ({text(p.x_px)}, {text(p.y_px)}) ·{" "}
                  {o.bbox ? "有检测框" : "检测框缺失"}
                </li>
              );
            })}
          </ul>
          <p className="field-help">
            SHA256：{text(result.sha256)}。本次图像已校验；历史记录不承诺永久提供原图。
          </p>
          <a href={href} download={`${text(metadata.frame_id)}.jpg`}>
            下载本次原图
          </a>
        </>
      )}
    </section>
  );
}
