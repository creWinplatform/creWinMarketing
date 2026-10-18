import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer(async(req,res)=>{
  try{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const path=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
    if(!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    const info=await stat(path);
    if(!info.isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    if(req.method==='HEAD'){res.end();return;}
    createReadStream(path).pipe(res);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.PORT||3034),'127.0.0.1',()=>console.log(`Prototype: http://127.0.0.1:${server.address().port}`));
