ALTER TABLE npc_tank_device_tool_call
  DROP CONSTRAINT IF EXISTS npc_tank_device_tool_call_tool_name_check;

ALTER TABLE npc_tank_device_tool_call
  ADD CONSTRAINT npc_tank_device_tool_call_tool_name_check
  CHECK (tool_name = 'get_status' OR tool_name LIKE 'npc_tank_%');
