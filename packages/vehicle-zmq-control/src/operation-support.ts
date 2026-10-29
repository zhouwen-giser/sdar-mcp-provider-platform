import { z } from "zod";
import type { ControlSettings, Operation } from "./model.js";

export const OPERATION_ADMISSION_KEYS = [
  "navigation.point",
  "navigation.route",
  "navigation.returnHome",
  "camera.position",
  "camera.velocity",
  "camera.zoom",
  "recon.area",
  "recon.sector",
  "recon.circular",
  "inspection.area",
  "simulation.applyEffect.observation",
  "simulation.applyEffect.manual",
] as const;
export type OperationAdmissionKey = (typeof OPERATION_ADMISSION_KEYS)[number];
export const OperationSupport = z
  .object({
    status: z.enum(["supported", "unsupported", "unverified"]),
    reasonCode: z
      .string()
      .regex(/^ZMQ_[A-Z0-9_]{1,100}$/)
      .optional(),
    description: z.string().trim().min(1).max(512),
    evidenceRef: z.string().trim().min(1).max(512).optional(),
  })
  .strict()
  .refine((value) => value.status !== "supported" || !!value.evidenceRef, {
    message: "ZMQ_OPERATION_SUPPORT_EVIDENCE_REQUIRED",
  });
export const OperationSupportMap = z.partialRecord(
  z.enum(OPERATION_ADMISSION_KEYS),
  OperationSupport,
);

export function operationAdmissionKey(operation: Operation): OperationAdmissionKey {
  if (operation.name === "recon.circular")
    return (operation.params as { scan_mode: string }).scan_mode === "sector"
      ? "recon.sector"
      : "recon.circular";
  if (operation.name === "simulation.applyEffect")
    return operation.params.targetSource === "manual"
      ? "simulation.applyEffect.manual"
      : "simulation.applyEffect.observation";
  return operation.name;
}

export function operationSupport(settings: ControlSettings, key: OperationAdmissionKey) {
  const configured = settings.operationSupport?.[key];
  const isolated = settings.mode === "isolated_simulator";
  const status = configured?.status ?? (isolated ? "supported" : "unverified");
  return {
    operation: key,
    status,
    available: status === "supported",
    reasonCode:
      configured?.reasonCode ??
      (status === "supported"
        ? "ZMQ_OPERATION_SUPPORTED"
        : status === "unsupported"
          ? "ZMQ_OPERATION_UNSUPPORTED"
          : "ZMQ_OPERATION_UNVERIFIED"),
    description:
      configured?.description ??
      (isolated ? "仅通过隔离仿真合同验证，现场资格另行验收。" : "该动作尚无已核实的部署支持。"),
    evidenceRef: configured?.evidenceRef ?? null,
    qualification: isolated ? "isolated_simulator_only" : "deployment_configured",
  };
}

export const operationSupportCatalog = (settings: ControlSettings) =>
  OPERATION_ADMISSION_KEYS.map((key) => operationSupport(settings, key));
