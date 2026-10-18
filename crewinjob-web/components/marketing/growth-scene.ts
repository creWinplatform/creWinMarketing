import * as T from 'three';

export function createGrowthScene(host: HTMLElement, initialPaused: boolean, onSelect: (index:number) => void) {
  const renderer = new T.WebGLRenderer({ antialias:true, alpha:false, preserveDrawingBuffer:true, powerPreference:'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  host.append(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0xedf1ee);
  const camera = new T.PerspectiveCamera(34, 1, .1, 100);
  scene.add(new T.HemisphereLight(0xffffff, 0xa8bca5, 2.9));
  const key = new T.DirectionalLight(0xffffff, 3.9);
  key.position.set(-4, 11, 8); key.castShadow = true; key.shadow.mapSize.set(1024,1024);
  Object.assign(key.shadow.camera, { left:-12, right:12, top:12, bottom:-12 });
  key.shadow.normalBias = .045; key.shadow.bias = -.0004; scene.add(key);
  const fill = new T.DirectionalLight(0xdbebdf, 1.8); fill.position.set(8,5,-6); scene.add(fill);
  const mat = (color:number) => new T.MeshStandardMaterial({ color, roughness:.36, metalness:.06 });
  const white = mat(0xf8faf6), lime = mat(0xbaf331), ink = mat(0x20291c), coral = mat(0xef8c70), sage = mat(0xd2ddcb);
  const ground = new T.Mesh(new T.PlaneGeometry(100,100), mat(0xedf1ee));
  ground.rotation.x = -Math.PI/2; ground.position.y = -.03; ground.receiveShadow = true; scene.add(ground);
  const studio = new T.Group(); scene.add(studio);
  function geometry(w:number,h:number,d:number,r=.1) {
    const shape = new T.Shape(), x=-w/2, y=-h/2;
    shape.moveTo(x+r,y); shape.lineTo(x+w-r,y); shape.quadraticCurveTo(x+w,y,x+w,y+r);
    shape.lineTo(x+w,y+h-r); shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    shape.lineTo(x+r,y+h); shape.quadraticCurveTo(x,y+h,x,y+h-r);
    shape.lineTo(x,y+r); shape.quadraticCurveTo(x,y,x+r,y);
    const g = new T.ExtrudeGeometry(shape,{ depth:d, bevelEnabled:true, bevelSegments:3, steps:1, bevelSize:.025, bevelThickness:.025, curveSegments:8 });
    g.translate(0,0,-d/2); return g;
  }
  function box(w:number,h:number,d:number,material:T.Material,x:number,y:number,z:number,parent:T.Object3D=studio) {
    const mesh = new T.Mesh(geometry(w,h,d),material); mesh.position.set(x,y,z);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function platform(w:number,d:number,x:number,z:number) { const p=box(w,d,.18,white,x,.09,z); p.rotation.x=-Math.PI/2; }
  function text(ctx:CanvasRenderingContext2D,value:string,x:number,y:number,size=26,color='#294634',weight=600) {
    ctx.fillStyle=color; ctx.font=`${weight} ${size}px 'Manrope Variable',Manrope,Arial,sans-serif`; ctx.fillText(value,x,y);
  }
  function rect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,color:string) { ctx.fillStyle=color; ctx.beginPath(); ctx.roundRect(x,y,w,h,12); ctx.fill(); }
  function texture(draw:(ctx:CanvasRenderingContext2D)=>void) {
    const canvas=document.createElement('canvas'); canvas.width=1024; canvas.height=700;
    const ctx=canvas.getContext('2d'); if(!ctx) throw new Error('Canvas unavailable'); draw(ctx);
    const value=new T.CanvasTexture(canvas); value.colorSpace=T.SRGBColorSpace; value.anisotropy=4; return value;
  }
  function panel(w:number,h:number,map:T.Texture,parent:T.Group,y:number) {
    const base=box(w,h,.16,white,0,y,0,parent);
    const face=new T.Mesh(new T.PlaneGeometry(w-.06,h-.06),new T.MeshBasicMaterial({map})); face.position.z=.12;
    base.add(face); base.rotation.x=-.13; return base;
  }
  const input=new T.Group(); input.position.set(-2.9,0,.1); input.rotation.y=.13; studio.add(input); platform(2.7,2.35,-2.9,.1);
  const research=texture(ctx => {
    ctx.fillStyle='#fafcf6'; ctx.fillRect(0,0,1024,700); text(ctx,'01 / ARAŞTIR',65,90,21,'#73816a'); text(ctx,'Doğru yerden başla.',65,165,43);
    [['HK','Hedef hesaplar','#dbe8bd'],['KS','Kaynaklı sinyaller','#f2d8c9'],['İF','İçerik fırsatları','#e1ddeb']].forEach((row,i)=>{
      const y=230+i*133; rect(ctx,60,y,904,105,'#f0f4e9'); rect(ctx,84,y+23,58,58,row[2]); text(ctx,row[0],91,y+60,19); text(ctx,row[1],169,y+47,25); text(ctx,'Bağlamıyla, kaynaklarıyla.',169,y+78,17,'#73816a',400); text(ctx,'✓',885,y+63,29,'#5d8252');
    });
  });
  const inputCard=panel(2.55,1.84,research,input,1.72); box(2.3,.23,.8,sage,0,.47,-.2,input); box(2.1,.15,.72,lime,0,.76,-.18,input);
  const hub=new T.Group(); hub.position.set(.05,0,-.35); studio.add(hub); platform(3.15,2.7,.05,-.35);
  box(2.6,.45,1.75,ink,0,.47,0,hub); box(2.4,.12,1.58,lime,0,.82,0,hub);
  const content=texture(ctx=>{
    ctx.fillStyle='#161d13'; ctx.fillRect(0,0,1024,700); text(ctx,'ryzevo',70,105,62,'#f5fae7',750); text(ctx,'02 / ÜRET',72,162,18,'#abb89c');
    text(ctx,'İyi fikirler,',70,282,66,'#f2f5df',500); text(ctx,'birbirine bağlı.',70,363,66,'#baf331',500);
    rect(ctx,70,449,885,95,'#2d3921'); text(ctx,'✓',100,511,34,'#baf331'); text(ctx,'Markanın sesiyle hazır.',170,511,31,'#eef3da'); text(ctx,'İçerik  /  Görsel  /  Son kontrol',70,627,22,'#b5c4a3',400);
  });
  const central=panel(3.1,2.35,content,hub,2.32);
  const output=new T.Group(); output.position.set(3.15,0,.55); output.rotation.y=-.15; studio.add(output); platform(2.6,2.45,3.15,.55);
  box(2.15,.3,1.7,coral,0,.38,0,output); box(2.03,.11,1.6,white,0,.65,0,output);
  const launch=texture(ctx=>{
    ctx.fillStyle='#f6e0d4'; ctx.fillRect(0,0,1024,700); text(ctx,'03 / BÜYÜT',65,80,20,'#a36a50'); text(ctx,'Bir sonraki',65,170,49,'#805640',500); text(ctx,'iyi adım.',65,233,49,'#805640',500);
    rect(ctx,63,288,892,217,'#fff8f2'); text(ctx,'Hedefine bağlı bir akış',99,348,26,'#805640'); [50,70,88,120,143,167].forEach((v,i)=>rect(ctx,100+i*134,468-v,83,v,i===5?'#b67d60':'#ddbea8'));
    rect(ctx,65,551,890,86,'#bc8064'); text(ctx,'Kontrol sende.  ↗',120,606,31,'#fff5e6');
  });
  const outputCard=panel(2.5,1.96,launch,output,1.79);
  function route(points:number[][],color:number) {
    const path=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p as [number,number,number])));
    const mesh=new T.Mesh(new T.TubeGeometry(path,60,.05,8,false),mat(color)); mesh.castShadow=true; studio.add(mesh); return path;
  }
  const paths=[route([[-1.6,.3,.25],[-1.35,.3,1.5],[-.9,.3,1.8],[.05,.3,1.55],[.05,.3,.8]],0x20291c),route([[1.35,.3,-.25],[1.85,.3,-.45],[2,.3,-1.25],[3.2,.3,-1.4],[3.2,.3,-.52]],0xcb9474)];
  const parcels=[box(.22,.14,.3,lime,0,0,0),box(.22,.14,.3,coral,0,0,0)];
  const targets=[input,hub,output], cards=[inputCard,central,outputCard];
  const raycaster=new T.Raycaster(), pointer=new T.Vector2(2,2);
  let selected=0,paused=initialPaused,visible=!document.hidden,last=0,time=0,raf=0,disposed=false,px=0,py=0,hovered=-1,frame=0;
  function draw(){ renderer.render(scene,camera); renderer.domElement.dataset.frame=String(++frame); }
  function animate(now:number) {
    raf=0; if(disposed || !visible) return;
    const dt=last ? Math.min((now-last)/1000,.05) : 0; last=now;
    if(!paused) {
      time+=dt; cards.forEach((card,i)=>{card.position.y=[1.72,2.32,1.79][i]+Math.sin(time*.85+i)*.055;});
      parcels.forEach((parcel,i)=>{parcel.position.copy(paths[i].getPointAt((time*.12+i*.38)%1));parcel.position.y+=.08;});
      studio.rotation.y+=(px*.035-studio.rotation.y)*.035; studio.rotation.x+=(py*.012-studio.rotation.x)*.035;
    }
    draw(); if(!paused) raf=requestAnimationFrame(animate);
  }
  function restart(){if(!raf && visible && !disposed){last=0;raf=requestAnimationFrame(animate);}}
  function select(index:number){ selected=index; targets.forEach((group,i)=>group.scale.setScalar(i===selected?1.025:1)); restart(); }
  function resize(){
    const w=host.clientWidth,h=host.clientHeight; if(!w || !h) return;
    renderer.setSize(w,h,false); camera.aspect=w/h; const mobile=w<761;
    camera.fov=mobile?40:34; camera.position.set(mobile?8.5:9,mobile?7.7:7.8,mobile?14.7:13);
    camera.lookAt(mobile?new T.Vector3(0,1.2,0):new T.Vector3(-3.6,.35,0)); studio.position.x=mobile?0:1.05; studio.scale.setScalar(mobile?.71:1);
    camera.setViewOffset(w,h,0,mobile?-h*.2:0,w,h); camera.updateProjectionMatrix(); draw();
  }
  const move=(event:PointerEvent)=>{
    const bounds=host.getBoundingClientRect(); pointer.set((event.clientX-bounds.left)/bounds.width*2-1,-(event.clientY-bounds.top)/bounds.height*2+1); px=pointer.x;py=pointer.y;
    raycaster.setFromCamera(pointer,camera); const hit=raycaster.intersectObjects(cards,true)[0]; hovered=hit?cards.findIndex(card=>card===hit.object || card.children.includes(hit.object)):-1;
    host.style.cursor=hovered<0?'default':'pointer'; restart();
  };
  const leave=()=>{px=py=0;hovered=-1;restart();};
  const click=()=>{if(hovered>=0){select(hovered);onSelect(hovered);}};
  const visibility=()=>{visible=!document.hidden;if(visible)restart();else{cancelAnimationFrame(raf);raf=0;}};
  host.addEventListener('pointermove',move); host.addEventListener('pointerleave',leave); host.addEventListener('click',click); document.addEventListener('visibilitychange',visibility);
  const image=new Image(); image.onload=()=>{
    if(disposed) return; const ctx=(content.image as HTMLCanvasElement).getContext('2d'); if(!ctx) return;
    ctx.fillStyle='#161d13';ctx.fillRect(55,25,440,105);ctx.save();ctx.globalCompositeOperation='lighten';ctx.drawImage(image,76,735,710,185,65,35,320,83);ctx.restore();content.needsUpdate=true;restart();
  }; image.src='/brand/ryzevo-brand-board.png';
  const observer=new ResizeObserver(resize); observer.observe(host); resize(); select(0);
  host.dataset.renderer='three-webgl';
  return {
    select,
    pause(value:boolean){paused=value;restart();},
    dispose(){
      disposed=true;cancelAnimationFrame(raf);observer.disconnect();image.onload=null;
      host.removeEventListener('pointermove',move);host.removeEventListener('pointerleave',leave);host.removeEventListener('click',click);document.removeEventListener('visibilitychange',visibility);
      const textures=new Set<T.Texture>(), materials=new Set<T.Material>(), geometries=new Set<T.BufferGeometry>();
      scene.traverse(node=>{if(node instanceof T.Mesh){geometries.add(node.geometry);(Array.isArray(node.material)?node.material:[node.material]).forEach(material=>{materials.add(material);const map=(material as T.MeshBasicMaterial).map;if(map)textures.add(map);});}});
      textures.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());geometries.forEach(value=>value.dispose());key.shadow.dispose();renderer.dispose();renderer.domElement.remove();delete host.dataset.renderer;
    },
  };
}
