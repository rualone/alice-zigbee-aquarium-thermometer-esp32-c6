"""Package an ESP-IDF build for the browser installer."""
import argparse, hashlib, json, pathlib, shutil
p=argparse.ArgumentParser();p.add_argument('--build',default='build');p.add_argument('--output',default='web/firmware');a=p.parse_args()
b=pathlib.Path(a.build);out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
args=json.loads((b/'flasher_args.json').read_text());desc=json.loads((b/'project_description.json').read_text())
assert args['extra_esptool_args']['chip']=='esp32c6'
parts=[]
for address,name in args['flash_files'].items():
 data=(b/name).read_bytes();target=pathlib.Path(name).name;(out/target).write_bytes(data)
 parts.append(dict(path=target,offset=int(address,0),size=len(data),sha256=hashlib.sha256(data).hexdigest(),md5=hashlib.md5(data+b'\xff'*((-len(data))%4)).hexdigest()))
app=next(x for x in parts if x['offset']==int(args['app']['offset'],0))
partition=next(x for x in parts if x['offset']==int(args['partition-table']['offset'],0))
assert app['offset']==0x20000 and partition['offset']==0x8000
assert app['size']<=940*1024
manifest=dict(version=desc['project_version'],project=desc['project_name'],chip='ESP32-C6',layout=1,app=app,partition=partition,parts=parts)
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Packaged firmware '+manifest['version'])
