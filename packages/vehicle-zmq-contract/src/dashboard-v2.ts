import { z } from "zod";
export const DashboardContext = z
  .object({
    entity_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
    simulation_epoch: z
      .string()
      .regex(/^[1-9][0-9]{0,19}$/)
      .refine((s) => BigInt(s) <= 0xffffffffffffffffn),
    controller_instance_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
    mission_id: z.number().int().min(-1).max(0xffffffff),
    mission_request_id: z.string().max(384),
  })
  .strict();
export type DashboardContext = z.infer<typeof DashboardContext>;
