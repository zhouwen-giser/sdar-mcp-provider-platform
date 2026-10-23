export function range(cidr) {
  const [address, bits] = cidr.split("/");
  const octets = address.split(".");
  const prefix = bits === undefined ? 32 : Number(bits);
  if (
    octets.length !== 4 ||
    octets.some((s) => !/^\d{1,3}$/.test(s) || Number(s) > 255) ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  )
    throw Error("EDGE_SUBNET_INVALID");
  const value = octets.reduce((n, s) => (n << 8n) | BigInt(s), 0n),
    size = 1n << BigInt(32 - prefix),
    lo = (value / size) * size;
  return { lo, hi: lo + size - 1n, prefix };
}
export function overlaps(a, b) {
  const x = range(a),
    y = range(b);
  return x.lo <= y.hi && y.lo <= x.hi;
}
export function validateEdgeSubnet(subnet, occupied, protectedAddresses = []) {
  const target = range(subnet);
  if (
    target.prefix < 24 ||
    target.prefix > 29 ||
    !["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].some((block) => {
      const b = range(block);
      return target.lo >= b.lo && target.hi <= b.hi;
    })
  )
    throw Error("EDGE_SUBNET_MUST_BE_PRIVATE_24_TO_29");
  for (const existing of [...occupied, ...protectedAddresses])
    if (
      existing &&
      existing !== "default" &&
      existing !== "0.0.0.0/0" &&
      overlaps(subnet, existing)
    )
      throw Error(`EDGE_SUBNET_CONFLICT:${existing}`);
  return subnet;
}
