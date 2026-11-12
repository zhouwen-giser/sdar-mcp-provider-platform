import { EoRequestV23, EoResponseV23, EoPublicationV23 } from "./schema-v23.js";
import { requireContract } from "./error.js";
import { parseWireJson } from "./json.js";
import {
  EoPublication,
  EoRequest,
  EoResponse,
  SimulationEffectPublication,
  SimulationEffectRequest,
  SimulationEffectResponse,
  WireId,
} from "./schema.js";

export type JsonComponent = "eo" | "simulationEffect";

export function parsePublication(
  component: JsonComponent,
  frames: readonly Buffer[],
  deviceId: string,
  eoVersion: "2.2" | "2.3" = "2.2",
) {
  WireId.parse(deviceId);
  requireContract(frames.length === 2, "ZMQ_MULTIPART_COUNT_INVALID");
  const topic = frames[0],
    body = frames[1];
  requireContract(
    topic && topic.length > 0 && topic.length <= 128 && body,
    "ZMQ_PUBLICATION_FRAME_INVALID",
  );
  const parsed =
    component === "eo"
      ? (eoVersion === "2.3" ? EoPublicationV23 : EoPublication).parse(parseWireJson(body))
      : SimulationEffectPublication.parse(parseWireJson(body));
  requireContract(parsed.device_id === deviceId, "ZMQ_JSON_FOREIGN_DEVICE");
  const expectedTopic = `${component === "eo" ? "isr" : "artillery"}/${deviceId}/${parsed.topic}`;
  requireContract(topic.equals(Buffer.from(expectedTopic, "utf8")), "ZMQ_JSON_TOPIC_MISMATCH");
  return parsed;
}

export function parseResponse(
  component: JsonComponent,
  frames: readonly Buffer[],
  expected: {
    deviceId: string;
    requestId: string;
    method: string;
    protocolVersion?: "2.2" | "2.3";
  },
) {
  requireContract(frames.length === 1 && frames[0], "ZMQ_RESPONSE_FRAME_INVALID");
  const parsed =
    component === "eo"
      ? (expected.protocolVersion === "2.3" ? EoResponseV23 : EoResponse).parse(
          parseWireJson(frames[0]),
        )
      : SimulationEffectResponse.parse(parseWireJson(frames[0]));
  requireContract(parsed.device_id === expected.deviceId, "ZMQ_JSON_FOREIGN_DEVICE");
  requireContract(
    parsed.response_id === expected.requestId && parsed.method === expected.method,
    "ZMQ_RESPONSE_REQUEST_MISMATCH",
  );
  return parsed;
}

export function parseRequest(
  component: JsonComponent,
  bytes: Buffer,
  eoVersion: "2.2" | "2.3" = "2.2",
) {
  return component === "eo"
    ? (eoVersion === "2.3" ? EoRequestV23 : EoRequest).parse(parseWireJson(bytes))
    : SimulationEffectRequest.parse(parseWireJson(bytes));
}
