"""Independent struct/CRC reference vectors; never provider-confirmed samples."""
from pathlib import Path
import binascii
import hashlib
import json
import struct

vectors = []
def frame(name, topic, message_id, payload, expected, system_id=1, target_id=0):
    checksum = binascii.crc_hqx(payload, 0xffff)
    data = topic.encode('ascii') + b':' + struct.pack('<IQQHH', message_id, system_id, target_id, len(payload), checksum) + payload
    vectors.append({'name': name, 'hex': data.hex(), 'sha256': hashlib.sha256(data).hexdigest(), 'expected': {'topic': topic, 'messageId': message_id, 'systemId': str(system_id), 'targetSystemId': str(target_id), 'body': expected}})

frame('mode-target-point', 'ad_remote_command', 1, struct.pack('<i',3), {'type':'mode','value':3}, 9007199254740993, 18446744073709551615)
points = [(29.7205,106.8128,0.0,1,58),(29.7207,106.8131,0.0,2,0)]
frame('two-point-path', 'call_task', 0x0b, struct.pack('<II',41,len(points))+b''.join(struct.pack('<dddBI',*p) for p in points), {'type':'pathFollow','missionId':41,'taskPoints':[{'latitude':p[0],'longitude':p[1],'headingAngle':p[2],'property':p[3],'reserved':p[4]} for p in points]})
frame('turnaround-feedback-v421', 'ipc_message', 0x10000028, struct.pack('<BIBiiBii',1,2,0,106812800,29720500,0,181000000,181000000), {'type':'missionFeedback','status':1,'missionCorrelation':'not_provided','turnaroundPoints':[{'type':0,'longitudeRaw':106812800,'latitudeRaw':29720500,'position':{'longitude':106.8128,'latitude':29.7205}},{'type':0,'longitudeRaw':181000000,'latitudeRaw':181000000,'position':None}]})
frame('two-failsafe-items', 'ipc_message', 0x10000021, struct.pack('<IBiIBiI',2,0,3,50,2,1,7), {'type':'failsafe','faults':[{'faultType':0,'faultLevel':3,'errorCode':50},{'faultType':2,'faultLevel':1,'errorCode':7}]})
values=[106.8128,29.7205,5.0,1.25,0.5,0.0,0.1,0.2,0.3,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,100.0,200.0,3.0,0.01]
frame('localization-uint64-and-order', 'ipc_message', 0x10000002, struct.pack('<QQQB',18446744073709551615,9007199254740993,1792756800000000,1)+struct.pack('<'+'d'*len(values),*values)+struct.pack('<BBB',1,4,3), {'type':'localization','timeUs':'18446744073709551615','systemTimeUs':'9007199254740993','utcTimeUs':'1792756800000000','timebase':'unconfirmed','longitude':106.8128,'latitude':29.7205,'velocityEnu':[1.25,0.5,0.0]})
out={'schemaVersion':'ugv.zmq-reference-fixtures/1','provenance':'constructed_reference_not_provider_confirmed','builder':'Python struct little-endian and binascii.crc_hqx; independent of TypeScript implementation','crcCheckVector':{'ascii':'123456789','expected':10673},'vectors':vectors}
path=Path('contracts/ugv-zmq/v1/fixtures/chassis-reference.json')
path.parent.mkdir(parents=True,exist_ok=True)
path.write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'vectors':len(vectors),'provenance':out['provenance']}))
