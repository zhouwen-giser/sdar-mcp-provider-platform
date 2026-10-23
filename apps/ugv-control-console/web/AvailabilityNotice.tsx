import { useEffect, useState } from "react";
import { record, text, type Json } from "../shared/model.js";
import { describe } from "./api.js";

export function AvailabilityNotice({
  result,
  pending,
  snapshot,
}: {
  result: Json;
  pending: boolean;
  snapshot: Json;
}) {
  const validUntil = Date.parse(text(result.validUntil));
  const [expiredAt, setExpiredAt] = useState<number>();
  useEffect(() => {
    if (!Number.isFinite(validUntil)) return;
    const timer = setTimeout(
      () => setExpiredAt(validUntil),
      Math.max(0, validUntil - Date.now()) + 1,
    );
    return () => clearTimeout(timer);
  }, [validUntil]);
  const expired =
    !Number.isFinite(validUntil) || Date.now() >= validUntil || expiredAt === validUntil;
  const payload = record(snapshot.payload),
    eo = record(payload.eoTask),
    recon = record(payload.reconnaissance);
  const externalEo = result.reasonCode === "UGV_EXTERNAL_EO_TRACK_BUSY";
  const eoState =
    (
      { 0: "未开始", 1: "执行中", 2: "已暂停", 3: "已终止", 4: "已结束", 5: "已失败" } as Record<
        string,
        string
      >
    )[String(eo.state)] ?? "未知";
  return (
    <div
      className={`notice ${!expired && result.availability === "available" ? "success" : "warning"}`}
    >
      <strong>
        {expired
          ? pending
            ? "检查已过期，正在复核…"
            : "检查已过期，等待自动复核"
          : result.availability === "available"
            ? "当前可用"
            : "当前不可执行"}
      </strong>
      <div>
        {expired ? "上次判定：" : ""}
        {describe(
          Error(text(result.reasonCode) || text(result.description) || text(result.availability)),
        )}
      </div>
      {externalEo && (
        <p className="field-help">
          设备光电任务 {text(eo.id) || "未标识"} · {eoState}。
          {[1, 9, 10, 11].includes(Number(recon.motionStatus))
            ? "侦察子模块已停止或空闲，但综合光电任务仍未释放。"
            : "需要设备确认该光电任务结束后才能恢复使用。"}
        </p>
      )}
      <small>
        检查有效至{" "}
        {Number.isFinite(validUntil)
          ? new Date(validUntil).toLocaleString("zh-CN", { hour12: false })
          : "未知"}
        ；自动更新，提交时再次核实。
      </small>
    </div>
  );
}
