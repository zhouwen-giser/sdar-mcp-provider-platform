import { record, text, type Json } from "../shared/model.js";
export function SimulationViewResult({ result }: { result: Json }) {
  const evidence = record(result.evidence),
    frame = record(evidence.frame),
    image = record(frame.thumbnail);
  const base64 = text(image.base64);
  return (
    <section className="evidence-summary" aria-label="仿真视场结果">
      <h3>本项目专属仿真视图</h3>
      <p>
        应用状态：{text(result.application)} · 相机：{text(evidence.cameraActorId) || "待确认"} ·
        视图版本：{text(evidence.cameraRevision) || "待确认"}
      </p>
      <p>
        实际水平视场角：{text(evidence.actualHorizontalFovDeg) || "待确认"}° · 新帧：
        {text(frame.frameId) || "待确认"}
      </p>
      <p className="field-help">该结果取自本项目相机；内参由仿真属性推导，不包含地理定位标定。</p>
      {image.mediaType === "image/png" &&
        base64.length <= 65536 &&
        /^iVBORw0KGgo[A-Za-z0-9+/=\r\n]*$/.test(base64) && (
          <figure>
            <img
              alt="仿真新视场取证帧"
              src={`data:image/png;base64,${base64}`}
              width={512}
              style={{ maxWidth: "100%" }}
            />
            <figcaption>新视场取证帧（缩略图） · {text(frame.receivedAt)}</figcaption>
          </figure>
        )}
    </section>
  );
}
