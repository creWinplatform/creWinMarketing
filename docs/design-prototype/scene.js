(() => {
  'use strict';
  const host=document.getElementById('growth-scene');
  if(!window.THREE){host.classList.add('scene-error');return;}
  const T=window.THREE;
  let renderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'low-power'});}catch{host.classList.add('scene-error');return;}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.8));
  renderer.setClearColor(0xedf1ee,1);renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
  renderer.domElement.setAttribute('aria-label','Üç aşamalı büyüme stüdyosu');renderer.domElement.setAttribute('role','img');host.append(renderer.domElement);
  const scene=new T.Scene();scene.background=new T.Color(0xedf1ee);
  const camera=new T.PerspectiveCamera(34,1,.1,100);camera.position.set(9,7.8,13);
  const ambient=new T.HemisphereLight(0xffffff,0xa8bca5,2.9);scene.add(ambient);
  const key=new T.DirectionalLight(0xffffff,3.9);key.position.set(-4,11,8);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-12;key.shadow.camera.right=12;key.shadow.camera.top=12;key.shadow.camera.bottom=-12;key.shadow.normalBias=.045;key.shadow.bias=-.0004;key.shadow.radius=5;scene.add(key);
  const fill=new T.DirectionalLight(0xdbebdf,1.8);fill.position.set(8,5,-6);scene.add(fill);
  const ground=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshStandardMaterial({color:0xedf1ee,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.03;ground.receiveShadow=true;scene.add(ground);
  const studio=new T.Group();scene.add(studio);
  const colors={green:0x20291c,lime:0xbaf331,coral:0xef8c70,white:0xf8faf6,ink:0x182115,sage:0xd2ddcb};
  const material=color=>new T.MeshStandardMaterial({color,roughness:.32,metalness:.08});
  const green=material(colors.green),lime=material(colors.lime),coral=material(colors.coral),white=material(colors.white),sage=material(colors.sage),ink=material(colors.ink);
  function roundedGeometry(w,h,d,r=.1){const s=new T.Shape(),x=-w/2,y=-h/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);const g=new T.ExtrudeGeometry(s,{depth:d,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.025,bevelThickness:.025,curveSegments:8});g.translate(0,0,-d/2);return g;}
  function box(w,h,d,mat,x,y,z,parent=studio,r=.1){const m=new T.Mesh(roundedGeometry(w,h,d,r),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function platform(w,d,x,z,mat=white,height=.18){const p=box(w,d,height,mat,x,height/2,z);p.rotation.x=-Math.PI/2;return p;}
  function texture(draw,w=1024,h=700){const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');draw(ctx,w,h);const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=4;return tex;}
  function rr(ctx,x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
  function line(ctx,txt,x,y,size=24,color='#294f3f',weight=600){ctx.fillStyle=color;ctx.font=`${weight} ${size}px Manrope,Arial,sans-serif`;ctx.fillText(txt,x,y);}
  function panel(w,h,tex,x,y,z,parent=studio){const base=box(w,h,.16,white,x,y,z,parent,.12);const face=new T.Mesh(new T.PlaneGeometry(w-.06,h-.06),new T.MeshBasicMaterial({map:tex}));face.position.z=.12;base.add(face);return base;}
  const input=new T.Group();studio.add(input);input.position.set(-2.9,0,.1);input.rotation.y=.13;
  platform(2.7,2.35,-2.9,.1,white);
  const researchTexture=texture((ctx,w,h)=>{ctx.fillStyle='#fafcf6';ctx.fillRect(0,0,w,h);line(ctx,'01 / ARAŞTIR',65,90,21,'#8c9b81');line(ctx,'Doğru insanları bul.',65,164,43);[['MD','Maritime business','#dbe8bd'],['CM','Crew management','#f2d8c9'],['SO','Ship owner','#e1ddeb']].forEach((row,i)=>{const y=230+i*133;rr(ctx,60,y,w-120,105,12,'#f0f4e9');rr(ctx,84,y+23,58,58,10,row[2]);line(ctx,row[0],94,y+60,19);line(ctx,row[1],169,y+47,25);line(ctx,'Kaynaklarıyla, bağlamıyla.',169,y+78,16,'#98a38b',400);line(ctx,'✓',885,y+63,29,'#5d8252');});});
  const inputCard=panel(2.55,1.84,researchTexture,0,1.72,0,input);inputCard.rotation.x=-.13;
  box(2.3,.23,.8,sage,0,.47,-.2,input);box(2.1,.15,.72,lime,0,.76,-.18,input);
  const hub=new T.Group();hub.position.set(.05,0,-.35);studio.add(hub);
  platform(3.15,2.7,.05,-.35,white);
  box(2.6,.45,1.75,green,0,.47,0,hub);box(2.4,.12,1.58,lime,0,.82,0,hub);
  const contentTexture=texture((ctx,w,h)=>{ctx.fillStyle='#161d13';ctx.fillRect(0,0,w,h);line(ctx,'ryzevo',70,100,62,'#f5fae7',750);line(ctx,'02 / ÜRET',72,162,18,'#abb89c');line(ctx,'İyi fikirler,',70,282,66,'#f2f5df',500);line(ctx,'birbirine bağlı.',70,363,66,'#baf331',500);rr(ctx,70,449,885,95,14,'#2d3921');rr(ctx,95,474,47,47,10,'#baf331');line(ctx,'✓',108,509,27,'#304319');line(ctx,'Markanın sesiyle hazır.',171,511,31,'#eef3da');line(ctx,'İçerik  /  Görsel  /  Son kontrol',70,627,22,'#b5c4a3',400);});
  const central=panel(3.1,2.35,contentTexture,0,2.32,-.22,hub);central.rotation.x=-.13;
  const seal=box(.68,.68,.15,lime,1.34,1.55,.19,hub,.12);seal.rotation.z=.16;
  const tickTexture=texture((ctx,w,h)=>{ctx.fillStyle='#dce993';ctx.fillRect(0,0,w,h);line(ctx,'✓',120,335,270,'#246347',550);},500,500);const tick=new T.Mesh(new T.PlaneGeometry(.58,.58),new T.MeshBasicMaterial({map:tickTexture}));tick.position.z=.13;seal.add(tick);
  const output=new T.Group();output.position.set(3.15,0,.55);output.rotation.y=-.15;studio.add(output);
  platform(2.6,2.45,3.15,.55,white);
  box(2.15,.3,1.7,coral,0,.38,0,output);box(2.03,.11,1.6,white,0,.65,0,output);
  const launchTexture=texture((ctx,w,h)=>{ctx.fillStyle='#f6e0d4';ctx.fillRect(0,0,w,h);line(ctx,'03 / BÜYÜT',65,80,20,'#b37a60');line(ctx,'Bir sonraki',65,170,49,'#805640',500);line(ctx,'iyi adım.',65,233,49,'#805640',500);rr(ctx,63,288,892,217,12,'#fff8f2');line(ctx,'Kampanya hazır',99,348,26,'#805640');const vals=[50,70,88,120,143,167];vals.forEach((v,i)=>rr(ctx,100+i*134,468-v,83,v,5,i===5?'#b67d60':'#ddbea8'));rr(ctx,65,551,890,86,12,'#bc8064');line(ctx,'Kontrol sende.  ↗',120,606,31,'#fff5e6');});
  const outputCard=panel(2.5,1.96,launchTexture,0,1.79,0,output);outputCard.rotation.x=-.14;
  function route(points,color,radius=.037){const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));const tube=new T.Mesh(new T.TubeGeometry(curve,60,radius,8,false),material(color));tube.castShadow=true;studio.add(tube);return curve;}
  const path1=route([[-1.6,.3,.25],[-1.35,.3,1.5],[-.9,.3,1.8],[.05,.3,1.55],[.05,.3,.8]],colors.green,.05);
  const path2=route([[1.35,.3,-.25],[1.85,.3,-.45],[2,.3,-1.25],[3.2,.3,-1.4],[3.2,.3,-.52]],0xcb9474,.05);
  const parcels=[{mesh:box(.22,.14,.3,lime,0,0,0),path:path1,offset:0},{mesh:box(.22,.14,.3,coral,0,0,0),path:path2,offset:.38}];
  for(let i=0;i<4;i++){const slat=box(.08,.08,.42,sage,-4.5+i*.2,.08,2.1);slat.rotation.y=.18;}
  const targets=[input,hub,output],raycaster=new T.Raycaster(),pointer=new T.Vector2(2,2);let hovered=-1,selected=0,visible=!document.getElementById('landing-view').hidden,paused=matchMedia('(prefers-reduced-motion: reduce)').matches,last=0,time=0,raf=0,px=0,py=0,frame=0;
  function size(){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;const mobile=w<761;camera.fov=mobile?40:34;camera.position.set(mobile?8.5:9,mobile?7.7:7.8,mobile?14.7:13);camera.lookAt(mobile?new T.Vector3(0,1.2,0):new T.Vector3(-3.6,.35,0));studio.position.set(mobile?0:1.05,0,0);studio.scale.setScalar(mobile?.71:1);camera.setViewOffset(w,h,0,mobile?-h*.2:0,w,h);camera.updateProjectionMatrix();draw();}
  function draw(){renderer.render(scene,camera);renderer.domElement.dataset.frame=String(++frame);}
  function animate(now){raf=0;if(!visible)return;const dt=last?Math.min((now-last)/1000,.05):0;last=now;if(!paused){time+=dt;inputCard.position.y=1.72+Math.sin(time*.85)*.055;central.position.y=2.32+Math.sin(time*.85+.8)*.065;outputCard.position.y=1.79+Math.sin(time*.85+1.8)*.05;parcels.forEach(p=>{p.mesh.position.copy(p.path.getPointAt((time*.12+p.offset)%1));p.mesh.position.y+=.08;});studio.rotation.y+=(px*.035-studio.rotation.y)*.035;studio.rotation.x+=(py*.012-studio.rotation.x)*.035;}
    targets.forEach((g,i)=>{const target=hovered===i||selected===i?1.025:1;g.scale.lerp(new T.Vector3(target,target,target),.08);});draw();if(!paused||hovered>=0)raf=requestAnimationFrame(animate);}
  function restart(){if(!raf&&visible){last=0;raf=requestAnimationFrame(animate);}}
  function select(value){selected=value;document.querySelectorAll('[data-scene]').forEach(b=>b.setAttribute('aria-selected',String(Number(b.dataset.scene)===selected)));restart();}
  document.querySelectorAll('[data-scene]').forEach(button=>button.addEventListener('click',()=>select(Number(button.dataset.scene))));
  host.addEventListener('pointermove',event=>{const r=host.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);px=pointer.x;py=pointer.y;raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects([inputCard,central,outputCard],true)[0];hovered=hit?[inputCard,central,outputCard].findIndex(o=>o===hit.object||o.children.includes(hit.object)):-1;host.style.cursor=hovered<0?'default':'pointer';restart();});
  host.addEventListener('pointerleave',()=>{px=0;py=0;hovered=-1;restart();});host.addEventListener('click',()=>{if(hovered>=0)select(hovered);});
  const pause=document.getElementById('scene-pause');function pauseIcon(){pause.innerHTML=`<i data-lucide="${paused?'play':'pause'}"></i>`;pause.setAttribute('aria-label',paused?'Animasyonu başlat':'Animasyonu duraklat');pause.title=pause.getAttribute('aria-label');window.lucide?.createIcons({attrs:{'aria-hidden':'true'}});}
  pause.addEventListener('click',()=>{paused=!paused;pauseIcon();restart();});pauseIcon();
  window.addEventListener('studio-visibility',event=>{visible=event.detail;visible?restart():cancelAnimationFrame(raf);if(!visible)raf=0;});
  document.addEventListener('visibilitychange',()=>{visible=!document.hidden&&!document.getElementById('landing-view').hidden;if(visible)restart();else{cancelAnimationFrame(raf);raf=0;}});
  const brandImage=new Image();
  brandImage.onload=()=>{const ctx=contentTexture.image.getContext('2d');ctx.fillStyle='#161d13';ctx.fillRect(55,25,440,105);ctx.save();ctx.globalCompositeOperation='lighten';ctx.drawImage(brandImage,76,735,710,185,65,35,320,83);ctx.restore();contentTexture.needsUpdate=true;restart();};
  brandImage.src='./assets/ryzevo-brand-board.png';
  const observer=new ResizeObserver(size);observer.observe(host);size();restart();
  host.dataset.renderer='three-webgl';
})();
