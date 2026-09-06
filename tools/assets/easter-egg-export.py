"""Run on repository copy with Blender --background --python tools/assets/easter-egg-export.py."""
import bpy, math, json, os, hashlib, struct
from mathutils import Vector, Matrix

def strip_preview_metadata(path):
 raw=open(path,'rb').read();chunks=[];offset=8
 while offset<len(raw):
  length=struct.unpack_from('>I',raw,offset)[0];kind=raw[offset+4:offset+8]
  if kind not in (b'tEXt',b'zTXt',b'iTXt',b'eXIf'):chunks.append(raw[offset:offset+length+12])
  offset+=length+12
 open(path,'wb').write(raw[:8]+b''.join(chunks))

ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../..'))
OUT=os.path.join(ROOT,'output/easter-egg-assets'); PUB=os.path.join(ROOT,'public/assets/models')
SOURCE_PATH=bpy.data.filepath
os.makedirs(OUT,exist_ok=True);os.makedirs(PUB,exist_ok=True)
# Identify the left office geometrically, without storing a company/collection name.
candidates=[]
for collection in bpy.data.collections:
 objects=[o for o in collection.objects if o.type=='MESH']
 if not objects:continue
 points=[o.matrix_world @ Vector(corner) for o in objects for corner in o.bound_box]
 low=Vector([min(v[i] for v in points) for i in range(3)])
 high=Vector([max(v[i] for v in points) for i in range(3)])
 span=high-low
 if 15<span.x<25 and 50<span.y<75 and 15<span.z<25 and (low.x+high.x)/2<0:candidates.append((objects,low,high))
if not candidates:raise RuntimeError('No left office source collection matched the spatial profile')
camera_position=bpy.context.scene.camera.location
# If a rear block also matches, retain the foreground office nearest the reference camera.
keep=min(candidates,key=lambda item:sum((((item[1][axis]+item[2][axis])/2)-camera_position[axis])**2 for axis in (0,1)))[0]
keep=[o for o in bpy.data.objects if o in keep]
# Lock the established envelope before replacing rear surfaces or roof equipment.
reference_objects=[o for o in keep if not any(part in o.name for part in ['Fangstangen','Außenjalousien','Klingel','Edelstahlgriff','Einwurf','Briefkasten','Innenräume','Querriegel','Fensterbänke','Fensterlaibungen'])]
reference_points=[o.matrix_world @ v.co for o in reference_objects for v in o.data.vertices]
reference_bounds=(Vector([min(v[i] for v in reference_points) for i in range(3)]),Vector([max(v[i] for v in reference_points) for i in range(3)]))
# Omit subpixel accessories and repeated slats, retain main facade and terrace.
keep=[o for o in keep if not any(s in o.name for s in ['Fangstangen','Außenjalousien','Klingel','Edelstahlgriff','Einwurf','Briefkasten','Innenräume','Querriegel','Fensterbänke','Fensterlaibungen','Dach · Lüftung','Dach · Technikaufbau','westliche Außenwand','rückwärtiger Abschluss','Rückseite ·'])]
logos=[o for o in bpy.data.objects if o.name.startswith('Straßenlogo ·') and o.type=='CURVE']
for o in list(bpy.data.objects):
 if o not in keep+logos:bpy.data.objects.remove(o,do_unlink=True)
for o in keep+logos:
 o.hide_set(False);o.hide_viewport=False;o.hide_render=False
 for m in list(o.modifiers):o.modifiers.remove(m)
 if o.type=='CURVE':o.data.bevel_depth=0;o.data.resolution_u=2;o.data.bevel_resolution=0
 bpy.context.view_layer.objects.active=o;o.select_set(True)
 if o.type=='CURVE':bpy.ops.object.convert(target='MESH')
 o.data.transform(o.matrix_world);o.matrix_world=Matrix.Identity(4);o.parent=None;o.select_set(False)
# Normalize original architecture, rotate its long Y axis into game X.
def bounds(objects):
 pts=[o.matrix_world @ v.co for o in objects for v in o.data.vertices]
 return Vector([min(v[i] for v in pts) for i in range(3)]),Vector([max(v[i] for v in pts) for i in range(3)])
lo,hi=reference_bounds;center=(lo+hi)/2;s=4.4/(hi.y-lo.y)
for o in keep:
 for v in o.data.vertices:
  p=v.co.copy();v.co=((p.y-center.y)*s,-(p.x-center.x)*s,(p.z-lo.z)*s)
# Original source logo is world oriented. Reorient from its smallest depth axis and
# place high on the street-facing facade, preserving original contours.
loL,hiL=bounds(logos); print('LOGO_BOUNDS',list(loL),list(hiL))
# Determine the source contour plane rather than assuming scene placement.
# Determine narrow axis and use remaining horizontal axis for logo width.
span=hiL-loL; depth=min(range(3),key=lambda i:span[i]); horizontal=next(i for i in (0,1) if i!=depth); vertical=next(i for i in range(3) if i not in (depth,horizontal))
ls=.64/span[horizontal]
for o in logos:
 for v in o.data.vertices:
  p=v.co.copy();u=(p[horizontal]-(loL[horizontal]+hiL[horizontal])/2)*ls
  z=(p[vertical]-loL[vertical])*ls
  d=(p[depth]-loL[depth])*ls
  v.co=(u,-.737-d,1.005+z)
# A ten-material texture-free palette includes clear roof glass, decking and solar cells.
colors={'white':(.76,.79,.75,1),'dark':(.14,.18,.20,1),'glass':(.035,.14,.22,1),'metal':(.35,.42,.43,1),'amber':(.822,.337,0,1),'logo-gray':(.168,.181,.181,1),'roof-glass':(.23,.43,.51,.24),'deck':(.31,.19,.11,1),'solar':(.012,.029,.065,1),'furniture-wood':(.075,.030,.011,1)}
logo_materials={slot.material for o in logos for slot in o.material_slots if slot.material}
for key, color_tag in [('amber','#F59D00'),('logo-gray','#727676')]:
 original=next(m for m in logo_materials if color_tag in m.name)
 colors[key]=tuple(original.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value)
mats={}
for k,c in colors.items():
 m=bpy.data.materials.new('Easter Egg '+k);m.diffuse_color=c;m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=c;p.inputs['Roughness'].default_value=.29 if k=='glass' else .8;p.inputs['Metallic'].default_value=.18 if k in ('glass','metal') else 0;mats[k]=m
 if k=='roof-glass':
  p.inputs['Alpha'].default_value=.24;p.inputs['Roughness'].default_value=.12;p.inputs['Metallic'].default_value=.08;m.surface_render_method='DITHERED';m.use_backface_culling=False
 if k=='solar':p.inputs['Roughness'].default_value=.42;p.inputs['Metallic'].default_value=.04
buckets={k:([],[]) for k in mats}
for o in keep+logos:
 for poly in o.data.polygons:
  orig=o.material_slots[poly.material_index].material if poly.material_index<len(o.material_slots) else None;n=orig.name if orig else ''
  key='white'
  if any(w in n for w in ['Anthrazit','Klinker','Lamellen']):key='dark'
  if 'Metall' in n:key='metal'
  if 'Glas' in n:key='glass'
  if 'Innenraum' in n:key='dark'
  if '#F59D00' in n:key='amber'
  if '#727676' in n:key='logo-gray'
  vs,fs=buckets[key];idx=len(vs);vs.extend(tuple(o.data.vertices[i].co) for i in poly.vertices);fs.append(tuple(range(idx,idx+len(poly.vertices))))
# Finish the previously schematic rear and far end in the existing facade vocabulary.
# All new solids join the same ten material batches; no textures or draw-call sprawl.
def box(key, center, size):
 vs,fs=buckets[key];n=len(vs);x,y,z=center;a,b,c=[v/2 for v in size]
 vs.extend([(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x-a,y+b,z-c),(x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)])
 fs.extend(tuple(n+i for i in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
# Build actual wall openings, thin inset frames and recessed glazing on the completed sides.
# Rear outer face y=.675; window faces y=.653: no glass boxes pasted outside a wall.
def facade_box(side,key,u,height,width,depth,thickness):
 if side=='rear':box(key,(u,depth,height),(width,thickness[0],thickness[1]))
 else:box(key,(depth,u,height),(thickness[0],width,thickness[1]))
def facade_surface(side,key,u,height,width,depth,vertical):
 vs,fs=buckets[key];n=len(vs);a,b=u-width/2,u+width/2;lo,hi=height-vertical/2,height+vertical/2
 if side=='rear':vs.extend([(a,depth,lo),(a,depth,hi),(b,depth,hi),(b,depth,lo)])
 else:vs.extend([(depth,a,lo),(depth,b,lo),(depth,b,hi),(depth,a,hi)])
 fs.append((n,n+1,n+2,n+3))
def complete_facade(side,half_width,centers):
 rear=side=='rear';wall_depth=.664 if rear else 2.187
 glass_depth=.652 if rear else 2.174
 frame_depth=.658 if rear else 2.180
 for floor in range(5):
  z0=floor*.253;z1=z0+.253;key='dark' if floor in (0,4) else 'white'
  openings=[(u,.083,z0+.036,z0+.216,False) for u in centers]
  if rear and floor==0:
   openings=[o for o in openings if abs(o[0]-.18)>.09]
   openings.append((.18,.20,.006,.21,True))
  openings.sort()
  cursor=-half_width
  for u,w,low,high,is_door in openings:
   left,right=u-w/2,u+w/2
   if left>cursor:facade_box(side,key,(cursor+left)/2,(z0+z1)/2,left-cursor,wall_depth,(.022,z1-z0))
   if low>z0:facade_box(side,key,u,(z0+low)/2,w,wall_depth,(.022,low-z0))
   if high<z1:facade_box(side,key,u,(high+z1)/2,w,wall_depth,(.022,z1-high))
   # The glazing sits behind both the outer wall plane and the narrow aluminum reveal.
   facade_surface(side,'glass',u,(low+high)/2,w-.010,glass_depth+.001,high-low-.010)
   for edge in (left+.0025,right-.0025):facade_surface(side,'dark',edge,(low+high)/2,.005,frame_depth+.003,high-low)
   for edge in (low+.0025,high-.0025):facade_surface(side,'dark',u,edge,w,frame_depth+.003,.005)
   if not is_door:facade_box(side,'metal',u,low-.002,w+.010,wall_depth+.003,(.022,.004))
   cursor=right
  if cursor<half_width:facade_box(side,key,(cursor+half_width)/2,(z0+z1)/2,half_width-cursor,wall_depth,(.022,z1-z0))
 # Match the continuous white roof fascia and ensure a closed rear/side perimeter.
 facade_box(side,'white',0,1.2845,half_width*2,wall_depth,(.022,.039))
complete_facade('rear',2.1775,[-1.98+bay*.36+dx for bay in range(12) for dx in (-.056,.056)])
complete_facade('end',.65,[-.49+bay*.327+dy for bay in range(4) for dy in (-.053,.053)])
box('metal',(.245,.675,.105),(.004,.008,.040))
# Rear drainage and continuous parapet cap.
for x in (-2.13,2.13):box('metal',(x,.715,.646),(.018,.025,1.292))
box('metal',(0,.701,1.327),(4.43,.053,.026))
box('metal',(2.23,0,1.327),(.053,1.42,.026))
# Single high facade sign; no duplicate sign above the entrance.
box('dark',(0,-.711,1.142),(.79,.040,.324))
box('white',(0,-.735,1.142),(.766,.018,.300))
box('metal',(0,-.81,.252),(.82,.31,.032))
# A thin closed plinth/apron gives every elevation a finished ground connection.
# Deliberately narrower than the six-tile lot so no neighboring road is obstructed.
box('metal',(0,0,-.027),(4.64,1.76,.054))
# Rooftop zoning from the street (+Z in glTF): plant left, covered center, terrace right.
roof=1.313
# Decking on the social half remains below railings and full-height glazing.
box('deck',(1.18,-.015,roof+.015),(1.83,1.21,.030))
for n in range(18):box('dark',(.31+n*.101,-.015,roof+.031),(.002,1.21,.001))
# Central covered separator with four aluminum columns and a continuous flat canopy.
for x in (-.52,.28):
 for y in (.04,.53):box('metal',(x,y,roof+.111),(.025,.025,.222))
box('white',(-.12,.29,roof+.235),(.94,.58,.040))
box('metal',(-.12,.29,roof+.258),(.96,.60,.007))
# Full-height L-shaped rear glazing and its aluminum mullions, adjoining the cover.
box('roof-glass',(1.18,.572,roof+.108),(1.90,.012,.216))
box('roof-glass',(2.128,.285,roof+.108),(.012,.586,.216))
for x in (.23,.70,1.18,1.65,2.128):box('metal',(x,.577,roof+.111),(.014,.024,.222))
for y in (.0,.29,.572):box('metal',(2.13,y,roof+.111),(.024,.014,.222))
for h in (.008,.222):
 box('metal',(1.18,.577,roof+h),(1.925,.026,.014))
 box('metal',(2.13,.286,roof+h),(.026,.60,.014))
# Glass balcony railing on all remaining perimeter edges, capped by aluminum handrails.
def railing_x(x0,x1,y):
 box('roof-glass',((x0+x1)/2,y,roof+.056),(x1-x0,.010,.102))
 for h in (.008,.112):box('metal',((x0+x1)/2,y,roof+h),(x1-x0+.01,.017,.011))
 steps=max(1,math.ceil((x1-x0)/.40))
 for j in range(steps+1):box('metal',(x0+(x1-x0)*j/steps,y,roof+.056),(.012,.018,.112))
def railing_y(y0,y1,x):
 box('roof-glass',(x,(y0+y1)/2,roof+.056),(.010,y1-y0,.102))
 for h in (.008,.112):box('metal',(x,(y0+y1)/2,roof+h),(.017,y1-y0+.01,.011))
 steps=max(1,math.ceil((y1-y0)/.40))
 for j in range(steps+1):box('metal',(x,y0+(y1-y0)*j/steps,roof+.056),(.018,.012,.112))
railing_x(-2.13,2.13,-.60)
railing_x(-2.13,.23,.60)
railing_y(-.60,.60,-2.13)
railing_y(-.60,0,2.13)
# Solar racks use actual sloping panel geometry rather than a flat painted roof.
def tilted_box(key,center,size,angle):
 vs=buckets[key][0];start=len(vs);box(key,center,size);cx,cy,cz=center
 for i in range(start,len(vs)):
  x,y,z=vs[i];dy,dz=y-cy,z-cz;vs[i]=(x,cy+dy*math.cos(angle)-dz*math.sin(angle),cz+dy*math.sin(angle)+dz*math.cos(angle))
for x in (-1.82,-1.36,-.90):
 for y in (-.40,.0):
  tilt=math.radians(16)
  for dx in (-.14,.14):box('metal',(x+dx,y,roof+.055),(.018,.26,.055))
  tilted_box('metal',(x,y,roof+.090),(.388,.316,.018),tilt)
  tilted_box('solar',(x,y-.003,roof+.102),(.367,.293,.013),tilt)
  for dx in (-.09,0,.09):tilted_box('metal',(x+dx,y-.004,roof+.110),(.0015,.29,.002),tilt)
# Left rear plant: raised air-handling units, vent grilles and fan housings.
for x in (-1.70,-1.03):
 box('metal',(x,.37,roof+.083),(.45,.27,.166))
 box('dark',(x,.37,roof+.170),(.36,.22,.010))
 for j in range(7):box('metal',(x-.16+j*.053,.37,roof+.179),(.013,.205,.008))
 for j in range(6):box('dark',(x,.232,roof+.030+j*.021),(.36,.008,.008))
# Dark rustic wooden furniture rests ON the decking, with two opposing pairs of chairs.
terrace_floor=roof+.031
def table(x,y,standing=False):
 h=.077 if standing else .055;w=.135 if standing else .230;d=.135
 # Separate planks and square timber legs make this read as rustic wood, not cafe plastic.
 for plank in range(3):box('furniture-wood',(x,y+(plank-1)*d/3,terrace_floor+h),(w,d/3-.002,.012))
 for dx in (-w*.36,w*.36):
  for dy in (-d*.32,d*.32):box('furniture-wood',(x+dx,y+dy,terrace_floor+h/2),(.012,.012,h))
 box('furniture-wood',(x,y,terrace_floor+.025),(w*.80,.010,.012))
def chair(x,y,angle):
 before={k:len(v[0]) for k,v in buckets.items()}
 box('furniture-wood',(x,y,terrace_floor+.033),(.048,.048,.009))
 box('furniture-wood',(x,y+.021,terrace_floor+.067),(.048,.008,.058))
 for dx in (-.018,.018):
  for dy in (-.018,.018):box('furniture-wood',(x+dx,y+dy,terrace_floor+.016),(.006,.006,.032))
 for key,(vs,faces) in buckets.items():
  for i in range(before[key],len(vs)):
   px,py,pz=vs[i];dx,dy=px-x,py-y;vs[i]=(x+dx*math.cos(angle)-dy*math.sin(angle),y+dx*math.sin(angle)+dy*math.cos(angle),pz)
for x,y in ((.75,-.20),(1.50,-.20)):
 table(x,y)
 for dx in (-.064,.064):
  chair(x+dx,y+.105,0)
  chair(x+dx,y-.105,math.pi)
for x in (.87,1.62):table(x,.33,True)

# Uniform 3x2 plot scaling preserves the original long slab proportions.
for key,(vs,fs) in buckets.items():
 buckets[key]=([(x*.59,y*.59,(z+.054)*.59) for x,y,z in vs],fs)
for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
for k,(vs,fs) in buckets.items():
 if not fs:continue
 mesh=bpy.data.meshes.new('Easter Egg '+k);mesh.from_pydata(vs,[],fs);mesh.update();o=bpy.data.objects.new('Easter Egg '+k,mesh);bpy.context.collection.objects.link(o);mesh.materials.append(mats[k]);o.select_set(True)
 # Weld coplanar faces but do not collapse facade window holes.
 bpy.context.view_layer.objects.active=o
 mod=o.modifiers.new('Coplanar reduction','DECIMATE');mod.decimate_type='DISSOLVE';mod.angle_limit=.005;bpy.ops.object.modifier_apply(modifier=mod.name)
for i,source_scene in enumerate(bpy.data.scenes):source_scene.name='Easter Egg scene '+str(i+1)
bpy.ops.export_scene.gltf(filepath=os.path.join(PUB,'easter-egg-office.glb'),export_format='GLB',use_selection=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
objs=[o for o in bpy.data.objects if o.type=='MESH'];lo,hi=bounds(objs)
tris=0
for o in objs:o.data.calc_loop_triangles();tris+=len(o.data.loop_triangles)
report={'source':'Provided Blender scene','sourceSHA256':hashlib.sha256(open(SOURCE_PATH,'rb').read()).hexdigest(),'retainedSourceObjects':len(keep),'originalLogoContours':len(logos),'triangles':tris,'meshCount':len(objs),'materials':len(objs),'bytes':os.path.getsize(os.path.join(PUB,'easter-egg-office.glb')),'gltfBounds':{'min':[lo.x,lo.z,-hi.y],'max':[hi.x,hi.z,-lo.y]},'note':'Left source building, commercial 3x2 adaptation. Original six contour wordmark mounted high on street-facing facade (+Z), below the roofline, with no entrance duplicate. Rooftop has left solar and ventilation, central rear-half covered separator, furnished right terrace, full-height L-shaped rear glass and perimeter glass railing with aluminum handrail. Rear and far end finished with matching white/dark facade, actual window openings with recessed glazing, thin frames and sills, rear exit, drainage, parapet continuity and closed ground apron. No render entourage.', 'frontDirection':[0,0,1], 'anchorOffset':[1,0,.5], 'alterations':['Rebuilt rear and far-end walls around actual openings with recessed glazing and thin frames','Original contour logo moved high on street-facing facade below roofline; lower copy removed','Left roof solar and ventilation; central cover only over rear half','Right terrace: dark rustic wooden seated tables with opposing chair pairs and standing tables','L-shaped rear glass enclosure and remaining perimeter glass balcony railing with aluminum handrail','Continuous plinth, rear exit, rainwater drainage and roof cap','Uniform scale 0.59 from initial normalized architecture']}
report['rooftop']={'solarPanels':6,'ventilationUnits':2,'seatedTables':2,'chairs':8,'standingTables':2,'seating':'Two opposing chair pairs per seated table','furniture':'Dark rustic wood','canopy':'Rear half only; front half uncovered','canopySafePatch':{'x':[-.22,.10],'z':[-.28,-.07],'height':(roof+.258+.0035+.054)*.59},'glazing':'L-shaped full-height rear and side enclosure; remaining perimeter balcony railing with aluminum cap'}
asset_bytes=open(os.path.join(PUB,'easter-egg-office.glb'),'rb').read()
report['assetSHA256']=hashlib.sha256(asset_bytes).hexdigest()
json_length=struct.unpack_from('<I',asset_bytes,12)[0];binary_offset=20+json_length
binary_length=struct.unpack_from('<I',asset_bytes,binary_offset)[0]
report['binaryGeometrySHA256']=hashlib.sha256(asset_bytes[binary_offset+8:binary_offset+8+binary_length]).hexdigest()
json.dump(report,open(os.path.join(PUB,'easter-egg-office-provenance.json'),'w'),indent=2);print(json.dumps(report))
# Four isolated studio previews are review outputs only, not part of published GLB.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=1400;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Easter Egg preview world');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.65,.72,.80,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.7
bpy.ops.object.camera_add(location=(-3,-4,2.1));cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=3.85;scene.camera=cam
bpy.ops.object.light_add(type='AREA',location=(-3,-4,7));key=bpy.context.object;key.data.energy=450;key.data.shape='DISK';key.data.size=5
bpy.ops.object.light_add(type='AREA',location=(3,4,5));bpy.context.object.data.energy=380;bpy.context.object.data.size=4
scene.render.film_transparent=True
views={'front':(-2.3,-4,2.7),'back':(2.3,4,2.7),'left':(-4,-1.2,2.7),'right':(4,1.2,2.7)}
views.update({'rear-detail':(1.2,3,.95),'front-detail':(-1.2,-3,.95),'roof':(0,-2,3.5)})
for label,pos in views.items():
 cam.location=pos
 target=(0,0,.43);cam.data.ortho_scale=3.85
 if label=='rear-detail':target=(.35,.30,.45);cam.data.ortho_scale=1.5
 if label=='front-detail':target=(-.35,-.30,.45);cam.data.ortho_scale=1.5
 if label=='roof':target=(0,0,.83);cam.data.ortho_scale=3.25
 cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
 scene.render.filepath=os.path.join(OUT,label+'.png');bpy.ops.render.render(write_still=True);strip_preview_metadata(scene.render.filepath)
cam.location=views['front'];cam.rotation_euler=(Vector((0,0,.43))-cam.location).to_track_quat('-Z','Y').to_euler()
# Save a clean derived edit file, with no source names or unused source data.
collection=bpy.data.collections.new('Easter Egg');scene.collection.children.link(collection)
for obj in list(scene.objects):
 if obj.name not in collection.objects:collection.objects.link(obj)
 for old_collection in list(obj.users_collection):
  if old_collection!=collection:old_collection.objects.unlink(obj)
for old_collection in list(bpy.data.collections):
 if old_collection!=collection:bpy.data.collections.remove(old_collection)
for text_block in list(bpy.data.texts):bpy.data.texts.remove(text_block)
bpy.data.orphans_purge(do_recursive=True)
for category in ['objects','meshes','curves','cameras','lights','worlds','scenes','images','actions']:
 for i,block in enumerate(getattr(bpy.data,category)):
  block.name='Easter Egg '+category+' '+str(i+1)
  for custom_key in list(block.keys()):del block[custom_key]
scene.render.filepath=os.path.join(OUT,'front.png')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'easter-egg-office.blend'))
