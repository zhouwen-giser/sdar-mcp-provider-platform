import { useState } from "react";
import type { Point } from "../shared/coordinates.js";
import { array, record, text, type Json } from "../shared/model.js";
interface Layer {
  name: string;
  color: string;
  points: Point[];
  closed?: boolean;
}
export function visibleGeometryObjects(objects: Json[], context: Json): Json[] {
  const refs = [...array(context.artifactRefs), ...Object.values(record(context.activeRefs))].map(
    record,
  );
  return objects.filter((object) => {
    const value = record(object.value);
    if (object.kind !== "artifact") return false;
    const type = text(value.artifactType),
      active = record(context.activeRefs);
    const expected = type.includes("route")
      ? record(active.route)
      : type.includes("trajectory")
        ? record(active.trajectory)
        : undefined;
    const matches = (ref: Json) => ref.id === value.artifactId && ref.revision === value.revision;
    return expected ? matches(expected) : refs.some(matches);
  });
}
export function geometryLayers(objects: Json[]): Layer[] {
  const layers: Layer[] = [];
  for (const object of objects) {
    if (object.kind !== "artifact") continue;
    const value = record(object.value),
      content = record(value.content);
    if (content.kind !== "geojson" || content.crs !== "OGC:CRS84") continue;
    const geometry = record(content.geometry),
      type = text(geometry.type);
    let paths: unknown[][] = [];
    if (type === "Point") paths = [[geometry.coordinates]];
    if (type === "LineString" || type === "MultiPoint") paths = [array(geometry.coordinates)];
    if (type === "Polygon" || type === "MultiLineString")
      paths = array(geometry.coordinates).map(array);
    if (type === "MultiPolygon")
      paths = array(geometry.coordinates).flatMap((p) => array(p).map(array));
    const category = text(value.artifactType);
    const color = category.includes("trajectory")
      ? "#63ddbb"
      : category.includes("route")
        ? "#739eff"
        : category.includes("coverage")
          ? "#e4b971"
          : "#d79cff";
    for (const path of paths) {
      const points = path
        .map((p) => array(p))
        .filter(
          (p) =>
            typeof p[0] === "number" &&
            typeof p[1] === "number" &&
            Math.abs(p[0]) <= 180 &&
            Math.abs(p[1]) <= 90,
        )
        .map((p) => ({ longitude: Number(p[0]), latitude: Number(p[1]) }));
      if (points.length)
        layers.push({
          name:
            (
              {
                "navigation.route": "已采用路线",
                "navigation.trajectory": "实际轨迹",
                "recon.region": "侦察区域",
                "recon.coverage": "设备覆盖",
                "sensor.footprint": "当前视场",
                "target.observation": "观测目标",
              } as Record<string, string>
            )[category] ?? category,
          color,
          points,
          closed: type.includes("Polygon"),
        });
    }
  }
  return layers;
}
export function Diagram({
  position,
  draft,
  objects,
  draftClosed = false,
  previewRoute = [],
}: {
  position?: Point;
  draft: Point[];
  objects: Json[];
  draftClosed?: boolean;
  previewRoute?: Point[];
}) {
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const layers: Layer[] = [
    ...geometryLayers(objects),
    ...(previewRoute.length
      ? [{ name: "规划路线预览 · 尚未采用", color: "#739eff", points: previewRoute }]
      : []),
    ...(draft.length
      ? [
          {
            name: "表单预览",
            color: "#ecb36b",
            points: draft,
            closed: draftClosed && draft.length >= 3,
          },
        ]
      : []),
  ];
  const points = [...layers.flatMap((l) => l.points), ...(position ? [position] : [])];
  const minLon = Math.min(...points.map((p) => p.longitude)),
    maxLon = Math.max(...points.map((p) => p.longitude)),
    minLat = Math.min(...points.map((p) => p.latitude)),
    maxLat = Math.max(...points.map((p) => p.latitude));
  const cx = points.length ? (minLon + maxLon) / 2 : 0,
    cy = points.length ? (minLat + maxLat) / 2 : 0,
    cos = Math.max(0.01, Math.cos((cy * Math.PI) / 180));
  const scale =
    Math.min(
      580 / Math.max((maxLon - minLon) * cos, 0.0004),
      290 / Math.max(maxLat - minLat, 0.0004),
    ) / 1.3;
  const xy = (p: Point) => [
    340 + (p.longitude - cx) * cos * scale,
    175 - (p.latitude - cy) * scale,
  ];
  return (
    <section className="diagram-panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">SPATIAL VIEW</span>
          <h2>坐标简图</h2>
        </div>
        <div className="button-group">
          <button aria-label="缩小" onClick={() => setZoom((z) => Math.max(0.25, z / 1.3))}>
            −
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            复位
          </button>
          <button aria-label="放大" onClick={() => setZoom((z) => Math.min(16, z * 1.3))}>
            ＋
          </button>
        </div>
      </div>
      <svg
        viewBox="0 0 680 350"
        role="img"
        aria-label="WGS84 无人车位置、区域、路线与轨迹简图"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) setPan((p) => ({ x: p.x + e.movementX, y: p.y + e.movementY }));
        }}
      >
        <defs>
          <pattern id="grid" width="34" height="35" patternUnits="userSpaceOnUse">
            <path d="M 34 0 L 0 0 0 35" fill="none" stroke="#243746" strokeWidth=".7" />
          </pattern>
        </defs>
        <rect width="680" height="350" fill="url(#grid)" />
        {points.length ? (
          <g
            transform={`translate(${340 + pan.x},${175 + pan.y}) scale(${zoom}) translate(-340,-175)`}
          >
            {layers.map((layer, i) => {
              const path = layer.points.map((p) => xy(p).join(",")).join(" ");
              return (
                <g key={i}>
                  {layer.closed ? (
                    <polygon
                      points={path}
                      fill={layer.color}
                      fillOpacity=".08"
                      stroke={layer.color}
                      strokeWidth={1.8 / zoom}
                      strokeDasharray={layer.name === "表单预览" ? "6 4" : undefined}
                    />
                  ) : (
                    <polyline
                      points={path}
                      fill="none"
                      stroke={layer.color}
                      strokeWidth={2 / zoom}
                    />
                  )}{" "}
                  {layer.points.length < 50 &&
                    layer.points.map((p, j) => {
                      const [x, y] = xy(p);
                      return (
                        <g key={j}>
                          <circle cx={x} cy={y} r={3 / zoom} fill={layer.color} />
                          {layer.name === "表单预览" && (
                            <text
                              x={x + 6 / zoom}
                              y={y - 6 / zoom}
                              fontSize={11 / zoom}
                              fill={layer.color}
                            >
                              {j + 1}
                            </text>
                          )}
                        </g>
                      );
                    })}
                </g>
              );
            })}
            {position && (
              <g transform={`translate(${xy(position).join(" ")})`}>
                <circle r={11 / zoom} fill="#5fdbc0" fillOpacity=".15" />
                <circle r={5 / zoom} fill="#8df2d9" stroke="#101d2b" strokeWidth={2 / zoom} />
                <text y={-15 / zoom} textAnchor="middle" fontSize={12 / zoom} fill="#a9f8e3">
                  无人车
                </text>
              </g>
            )}
          </g>
        ) : (
          <text x="340" y="175" textAnchor="middle" fill="#7f95a8" fontSize="14">
            输入坐标或等待设备位置
          </text>
        )}
        <text x="650" y="28" fill="#9fb1c0" textAnchor="middle" fontSize="12">
          N ↑
        </text>
      </svg>
      <div className="legend">
        <span>
          <i style={{ background: "#8df2d9" }} />
          车辆位置
        </span>
        {[...new Map(layers.map((l) => [l.name, l])).values()].map((l) => (
          <span key={l.name}>
            <i style={{ background: l.color }} />
            {l.name}
          </span>
        ))}
        <small>WGS84 · 北向上 · 拖动平移 · 表单预览不代表已执行</small>
      </div>
    </section>
  );
}
