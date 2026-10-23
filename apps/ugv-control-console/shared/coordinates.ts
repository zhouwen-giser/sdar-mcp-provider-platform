export interface Point {
  longitude: number;
  latitude: number;
}
export function parseCoordinates(input: string): Point[] {
  const lines = input
    .trim()
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("请输入 WGS84 经纬度");
  return lines.map((line, i) => {
    const number = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[-+]?\\d+)?";
    const namedPattern = new RegExp(
      "(longitude|latitude|lon|lat|经度|纬度)\\s*[:：]\\s*(" + number + ")",
      "gi",
    );
    const named = [...line.matchAll(namedPattern)];
    let longitude: number, latitude: number;
    if (named.length) {
      const lon = named.filter((m) => /^(longitude|lon|经度)$/i.test(m[1]));
      const lat = named.filter((m) => /^(latitude|lat|纬度)$/i.test(m[1]));
      if (
        named.length !== 2 ||
        lon.length !== 1 ||
        lat.length !== 1 ||
        line.replace(namedPattern, "").replace(/[，,;\s]/g, "")
      )
        throw new Error(`第 ${i + 1} 行需要各一个经度和纬度`);
      longitude = Number(lon[0][2]);
      latitude = Number(lat[0][2]);
    } else {
      const parts = line
        .replace(/[，,;]/g, " ")
        .trim()
        .split(/\s+/);
      const numeric = new RegExp("^" + number + "$", "i");
      if (parts.length !== 2 || parts.some((value) => !numeric.test(value)))
        throw new Error(`第 ${i + 1} 行应为“经度, 纬度”`);
      longitude = Number(parts[0]);
      latitude = Number(parts[1]);
    }
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      Math.abs(longitude) > 180 ||
      Math.abs(latitude) > 90
    )
      throw new Error(`第 ${i + 1} 行超出 WGS84 范围`);
    return { longitude, latitude };
  });
}
export function validatePolygon(raw: Point[]): Point[] {
  const points = [...raw];
  const equal = (a: Point, b: Point) => a.longitude === b.longitude && a.latitude === b.latitude;
  if (points.length > 1 && equal(points[0], points[points.length - 1])) points.pop();
  if (points.length < 3 || points.length > 256) throw new Error("区域需要 3–256 个不同顶点");
  const keys = points.map((p) => `${p.longitude},${p.latitude}`);
  if (new Set(keys).size !== points.length) throw new Error("区域包含重复顶点");
  if (
    Math.max(...points.map((p) => p.longitude)) - Math.min(...points.map((p) => p.longitude)) >
    180
  )
    throw new Error("当前区域表单不支持跨越日期变更线");
  const origin = points[0];
  const cross = (a: Point, b: Point, c: Point) =>
    (b.longitude - a.longitude) * (c.latitude - a.latitude) -
    (b.latitude - a.latitude) * (c.longitude - a.longitude);
  const on = (a: Point, b: Point, c: Point) =>
    Math.abs(cross(a, b, c)) < 1e-14 &&
    c.longitude >= Math.min(a.longitude, b.longitude) - 1e-12 &&
    c.longitude <= Math.max(a.longitude, b.longitude) + 1e-12 &&
    c.latitude >= Math.min(a.latitude, b.latitude) - 1e-12 &&
    c.latitude <= Math.max(a.latitude, b.latitude) + 1e-12;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const a = points[i],
        b = points[(i + 1) % points.length],
        c = points[j],
        d = points[(j + 1) % points.length];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b)
      )
        throw new Error("区域边界自交或重叠");
    }
  let twiceArea = 0;
  for (let i = 1; i < points.length - 1; i++) twiceArea += cross(origin, points[i], points[i + 1]);
  if (Math.abs(twiceArea) < 1e-12) throw new Error("区域面积为零或过小");
  return points;
}
export function regionArguments(resourceId: string, input: string, inspect: boolean) {
  const points = validatePolygon(parseCoordinates(input));
  return inspect
    ? {
        resourceId,
        area: { frame: "WGS84", boundary: points.map((p) => ({ x: p.longitude, y: p.latitude })) },
      }
    : {
        resourceId,
        area: { polygon: points },
        scanMode: "area",
        scanCount: 1,
        reconType: "adaptive",
      };
}
