"""Render a provided scene and print generic spatial source references."""
import bpy,os,struct
from mathutils import Vector

def strip_preview_metadata(path):
 raw=open(path,'rb').read();chunks=[];offset=8
 while offset<len(raw):
  length=struct.unpack_from('>I',raw,offset)[0];kind=raw[offset+4:offset+8]
  if kind not in (b'tEXt',b'zTXt',b'iTXt',b'eXIf'):chunks.append(raw[offset:offset+length+12])
  offset+=length+12
 open(path,'wb').write(raw[:8]+b''.join(chunks))

root=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
scene=bpy.context.scene
for collection in bpy.data.collections:
 points=[o.matrix_world @ Vector(corner) for o in collection.objects if o.type=='MESH' for corner in o.bound_box]
 if not points:continue
 low=Vector([min(v[i] for v in points) for i in range(3)]);high=Vector([max(v[i] for v in points) for i in range(3)]);span=high-low
 if 15<span.x<25 and 50<span.y<75 and 15<span.z<25:
  print('SOURCE_BUILDING','left' if (low.x+high.x)/2<0 else 'right',[list(low),list(high)])
scene.render.engine='CYCLES';scene.cycles.samples=8
scene.render.resolution_x=1280;scene.render.resolution_y=720;scene.render.resolution_percentage=100
scene.render.filepath=os.path.join(root,'output/easter-egg-assets/source-reference.png')
bpy.ops.render.render(write_still=True)
strip_preview_metadata(scene.render.filepath)
