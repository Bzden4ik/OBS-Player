const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),net=require('net'),tls=require('tls'),zlib=require('zlib'),crypto=require('crypto'),{spawn,spawnSync,execFile,execFileSync}=require('child_process');
const VER=crypto.createHash('sha1').update(fs.readFileSync(__filename)).digest('hex').slice(0,10);
const PORT=+process.env.PORT||8000,FILE=path.join(__dirname,'redeem-player.html');
const DATA=path.join(__dirname,'data.json'),BAK=path.join(__dirname,'data.backup.json');
const PLAYS_F=path.join(__dirname,'plays.json'),STATE_F=path.join(__dirname,'state.json');
const MAXDATA=64e6;
let seq=0;const log=[],IDLE=+process.env.IDLE_MS||120000;let last=Date.now(),lastBak=0;
const AUTO=process.argv.includes('--auto');
const HOSTS=['localhost:'+PORT,'127.0.0.1:'+PORT],ORIGINS=HOSTS.map(h=>'http://'+h);
const route=(host,port,cb)=>direct(host,port,cb);
function direct(host,port,cb){
  const s=net.connect(port,host);let done=false;
  const fin=e=>{if(done)return;done=true;s.setTimeout(0);if(e){s.destroy();cb(e)}else cb(null,s)};
  s.setTimeout(20000,()=>fin(new Error('нет ответа')));
  s.on('connect',()=>fin());s.on('error',fin);
}

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
function fetchVia(url,o){
  o=o||{};const u=new URL(url);
  return new Promise((res,rej)=>{
    let r=null;const t=setTimeout(()=>{rej(new Error('нет ответа'));if(r)r.destroy()},o.timeout||15000);
    r=http.request({host:u.hostname,port:443,method:o.method||'GET',path:u.pathname+u.search,setHost:false,
      headers:{Host:u.hostname,'Accept-Encoding':'gzip','Accept-Language':'en','User-Agent':o.ua||UA,...(o.headers||{})},
      createConnection:(x,cb)=>route(u.hostname,443,(e,s)=>e?cb(e):cb(null,tls.connect({socket:s,servername:u.hostname})),o.yt)},
      resp=>{
        const st=resp.headers['content-encoding']==='gzip'?resp.pipe(zlib.createGunzip()):resp,ch=[];let n=0;
        st.on('data',d=>{n+=d.length;if(n>4e6)r.destroy();else ch.push(d)});
        st.on('end',()=>{clearTimeout(t);res({status:resp.statusCode,body:Buffer.concat(ch).toString('utf8')})});
        st.on('error',e=>{clearTimeout(t);rej(e)});
      });
    r.on('error',e=>{clearTimeout(t);rej(e)});
    r.end(o.body);
  });
}
function jsonAt(h,mark){
  const i=h.indexOf(mark);if(i<0)return null;
  const s=h.indexOf('{',i);let d=0,q=false;
  for(let k=s;k<h.length;k++){const c=h[k];
    if(q){if(c==='\\')k++;else if(c==='"')q=false}
    else if(c==='"')q=true;else if(c==='{')d++;
    else if(c==='}'&&--d===0){try{return JSON.parse(h.slice(s,k+1))}catch(e){return null}}}
  return null;
}
let GEO={cc:'',at:0};
async function geo(){
  try{const r=await fetchVia('https://www.cloudflare.com/cdn-cgi/trace',{yt:true});const m=/^loc=(\w+)/m.exec(r.body);GEO={cc:m?m[1]:'',at:Date.now()}}
  catch(e){GEO.at=Date.now()-5e5}
  return GEO.cc;
}
const INFO=new Map();
async function ytInfo(id){
  const c=INFO.get(id);if(c&&Date.now()-c.at<6e5)return c.v;
  const r=await fetchVia('https://www.youtube.com/watch?v='+id+'&hl=en&bpctr=9999999999&has_verified=1');
  const p=jsonAt(r.body,'ytInitialPlayerResponse = ');
  if(!p)throw new Error('YouTube не отдал данные (HTTP '+r.status+')');
  const ps=p.playabilityStatus||{},v=p.videoDetails||{},mf=(p.microformat||{}).playerMicroformatRenderer||{};
  const sub=((ps.errorScreen||{}).playerErrorMessageRenderer||{}).subreason||{};
  const why=[ps.reason||'',sub.simpleText||(sub.runs||[]).map(x=>x.text).join('')].join(' ').trim();
  const o={status:ps.status||'',why,embed:ps.playableInEmbed!==false,
    bot:/not a bot/i.test(why),age:/confirm your age|age.restricted|inappropriate for some users/i.test(why),
    region:/country|region/i.test(why),priv:/private/i.test(why),live:!!(v.isLive||v.isUpcoming),
    title:v.title||'',author:v.author||'',desc:v.shortDescription||'',kw:v.keywords||[],
    len:+v.lengthSeconds||0,views:v.viewCount==null?null:+v.viewCount,countries:mf.availableCountries||null};
  if(!o.bot)INFO.set(id,{v:o,at:Date.now()});
  if(INFO.size>300)INFO.delete(INFO.keys().next().value);
  return o;
}
const VR={ver:'1.62.27',ua:'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip'};
async function captions(id){
  const r=await fetchVia('https://www.youtube.com/youtubei/v1/player?prettyPrint=false',{method:'POST',ua:VR.ua,
    headers:{'Content-Type':'application/json','X-YouTube-Client-Name':'28','X-YouTube-Client-Version':VR.ver},
    body:JSON.stringify({context:{client:{clientName:'ANDROID_VR',clientVersion:VR.ver,deviceMake:'Oculus',deviceModel:'Quest 3',androidSdkVersion:32,osName:'Android',osVersion:'12L',hl:'en'}},videoId:id,contentCheckOk:true,racyCheckOk:true})});
  const ct=((JSON.parse(r.body).captions||{}).playerCaptionsTracklistRenderer||{}).captionTracks||[];
  const t=ct.find(c=>c.kind==='asr')||ct[0];if(!t)return '';
  const x=await fetchVia(t.baseUrl,{ua:VR.ua});
  return x.body.replace(/<[^>]+>/g,' ').replace(/&#(\d+);/g,(m,n)=>String.fromCharCode(n)).replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim().slice(0,30000);
}
function songOf(title,author){
  let t=title.replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g,' ').replace(/\b(official|music|lyrics?|video|audio|visuali[sz]er|hd|4k|mv|m\/v)\b/gi,' ').replace(/\s+/g,' ').trim();
  let a=author.replace(/\s*-\s*Topic$/i,'').replace(/VEVO$/i,'').trim(),s=t;
  const d=t.match(/^(.+?)\s+[-–—|]\s+(.+)$/);if(d){a=d[1];s=d[2]}
  s=s.replace(/\s+(ft|feat|featuring)\.?\s.*$/i,'').replace(/["“”«»]/g,'').trim();
  a=a.replace(/\s+(ft|feat|featuring|x)\.?\s.*$/i,'').replace(/\s*[,&].*$/,'').trim();
  return{a,s,t};
}
async function lyrics(title,author,len){
  const {a,s,t}=songOf(title,author),get=async q=>{const r=await fetchVia('https://lrclib.net/api/search?'+q,{yt:true,ua:'redeem-player/1.0 (stream overlay)'});return r.status===200?JSON.parse(r.body):[]};
  const pick=l=>(l||[]).filter(x=>x.plainLyrics&&(!len||Math.abs((x.duration||0)-len)<=15))[0];
  let x=a&&s?pick(await get('track_name='+encodeURIComponent(s)+'&artist_name='+encodeURIComponent(a))):null;
  if(!x)x=pick(await get('q='+encodeURIComponent(t)));
  return x?{text:x.plainLyrics.slice(0,30000),src:x.artistName+' — '+x.trackName}:null;
}
const ID=/^[\w-]{11}$/;
const json=(res,o)=>{head(res,200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(o))};

let PLAYS={};try{PLAYS=JSON.parse(fs.readFileSync(PLAYS_F,'utf8'))||{}}catch(e){}
let playsDirty=false;
function playSeen(m){
  if(!m||typeof m!=='object')return;
  if(m.t==='done'&&typeof m.k==='string'){PLAYS[m.k]={p:1,t:Date.now()};playsDirty=true;return}
  if(m.t!=='st'||typeof m.ck!=='string')return;
  const end=m.cut>0&&(!m.du||m.cut<m.du)?m.cut:m.du;if(!(end>0))return;
  const p=Math.min(1,Math.max(0,(+m.tm||0)/end)),o=PLAYS[m.ck];
  if(!o||p>o.p+0.005){PLAYS[m.ck]={p:+p.toFixed(3),t:Date.now()};playsDirty=true}
}
function savePlays(){
  if(!playsDirty)return;playsDirty=false;
  const ks=Object.keys(PLAYS);
  if(ks.length>2000)ks.sort((a,b)=>PLAYS[a].t-PLAYS[b].t).slice(0,ks.length-2000).forEach(k=>delete PLAYS[k]);
  try{fs.writeFileSync(PLAYS_F+'.tmp',JSON.stringify(PLAYS));fs.renameSync(PLAYS_F+'.tmp',PLAYS_F)}catch(e){}
}

let TW=null,STATE={autoClosed:false,ids:[]};
try{STATE={...STATE,...JSON.parse(fs.readFileSync(STATE_F,'utf8'))}}catch(e){}
const saveState=()=>{try{fs.writeFileSync(STATE_F,JSON.stringify(STATE))}catch(e){}};
async function closeOrders(){
  const t=TW;TW=null;
  if(!t||!t.auto||!t.ids.length)return;
  const done=[];
  for(const id of t.ids)try{
    const r=await fetchVia('https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id='+encodeURIComponent(t.uid)+'&id='+encodeURIComponent(id),
      {method:'PATCH',timeout:8000,headers:{Authorization:'Bearer '+t.tok,'Client-Id':t.cid,'Content-Type':'application/json'},body:JSON.stringify({is_enabled:false})});
    if(r.status===200)done.push(id);
  }catch(e){}
  if(done.length){STATE={autoClosed:true,ids:done};saveState()}
  console.log('Заказы закрыты: '+done.length);
}
let leaving=null;
const bye=()=>leaving||(leaving=Promise.race([closeOrders(),new Promise(r=>setTimeout(r,10000))]).then(savePlays));
const shutdown=why=>{console.log("Выключаюсь: "+why);bye().then(()=>setTimeout(()=>process.exit(0),150))};
const body=(req,max,cb)=>{let b='';req.on('data',d=>{b+=d;if(b.length>max)req.destroy()});req.on('end',()=>{let j=null;try{j=JSON.parse(b)}catch(e){}cb(j)})};
process.on('exit',savePlays);
process.on('SIGINT',()=>process.exit(0));

const SEC={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"frame-ancestors 'none'"};
const head=(res,code,h)=>res.writeHead(code,{...SEC,...(h||{})});
const srv=http.createServer((req,res)=>{
  if(!HOSTS.includes(req.headers.host)){head(res,403);res.end();return}
  const u=new URL(req.url,'http://x');
  if(req.method==='POST'){
    const o=req.headers.origin;
    if((o&&!ORIGINS.includes(o))||req.headers['x-radio']!=='1'){head(res,403);res.end();return}
  }
  if(u.pathname==='/quit'&&req.method==='POST'){head(res,204);res.end();setTimeout(()=>process.exit(0),100);return}
  if(u.pathname==='/ver'&&req.method==='GET'){json(res,{ver:VER,leaving:!!leaving});return}
  if(u.pathname==='/yt/info'&&req.method==='GET'){
    const id=u.searchParams.get('id');if(!ID.test(id||'')){head(res,400);res.end();return}
    Promise.all([ytInfo(id),GEO.cc&&Date.now()-GEO.at<6e5?GEO.cc:geo()]).then(([v,cc])=>json(res,{ok:true,cc,...v}),e=>json(res,{ok:false,err:e.message}));return;
  }
  if(u.pathname==='/yt/text'&&req.method==='GET'){
    const q=u.searchParams,id=q.get('id');if(!ID.test(id||'')){head(res,400);res.end();return}
    const o={cap:'',lyr:'',lyrSrc:''};
    Promise.all([
      q.get('cap')==='1'?captions(id).then(t=>{o.cap=t},e=>{o.capErr=e.message}):0,
      lyrics(q.get('t')||'',q.get('a')||'',+q.get('len')||0).then(l=>{if(l){o.lyr=l.text;o.lyrSrc=l.src}},e=>{o.lyrErr=e.message})
    ]).then(()=>json(res,o));return;
  }
  if(u.pathname==='/open'&&req.method==='POST'){
    body(req,200,j=>{const id=j&&j.id;
      if(!ID.test(id||'')){head(res,400);res.end();return}
      try{spawn('rundll32',['url.dll,FileProtocolHandler','https://www.youtube.com/watch?v='+id],{detached:true,stdio:'ignore',windowsHide:true}).unref();head(res,204)}catch(e){head(res,500)}
      res.end()});
    return;
  }
  if(u.pathname==='/banned-words.json'&&req.method==='GET'){
    fs.readFile(path.join(__dirname,'banned-words.json'),(e,d)=>{head(res,e?404:200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(e?'':d)});return;
  }
  if(u.pathname==='/plays'&&req.method==='GET'){json(res,PLAYS);return}
  if(u.pathname==='/twitch'&&req.method==='POST'){
    body(req,5e3,j=>{
      const ok=j&&typeof j.cid==='string'&&typeof j.tok==='string'&&typeof j.uid==='string'&&Array.isArray(j.ids)&&j.ids.length<=50&&j.ids.every(x=>typeof x==='string');
      if(!ok){head(res,400);res.end();return}
      TW={cid:j.cid,tok:j.tok,uid:j.uid,ids:j.ids,auto:j.auto!==false};leaving=null;
      head(res,204);res.end();
    });
    return;
  }
  if(u.pathname==='/bye'&&req.method==='POST'){bye().then(()=>{head(res,204);res.end();if(AUTO)shutdown('OBS закрыли')});return}
  if(u.pathname==='/orders'){
    if(req.method==='POST'){body(req,200,j=>{if(j&&j.autoClosed===false){STATE={autoClosed:false,ids:[]};saveState()}head(res,204);res.end()});return}
    json(res,{autoClosed:!!STATE.autoClosed,ids:STATE.ids||[]});return;
  }
  if(u.pathname==='/data'){
    if(req.method==='POST'){
      let b='',big=false;req.on('data',d=>{b+=d;if(b.length>MAXDATA){big=true;req.destroy()}});
      req.on('end',()=>{
        if(big)return;
        let j;try{j=JSON.parse(b)}catch(e){head(res,400);res.end();return}
        if(!j||typeof j!=='object'||!Array.isArray(j.hist)||!j.pl||typeof j.pl!=='object'){head(res,400);res.end();return}
        const write=()=>fs.writeFile(DATA+'.tmp',b,e=>{if(e){head(res,500);res.end();return}fs.rename(DATA+'.tmp',DATA,()=>{head(res,204);res.end()})});
        if(Date.now()-lastBak>36e5&&fs.existsSync(DATA)){lastBak=Date.now();fs.copyFile(DATA,BAK,write)}else write();
      });
      return;
    }
    if(req.method!=='GET'){head(res,405);res.end();return}
    fs.readFile(DATA,(e,d)=>{head(res,200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(e?'{}':d)});return;
  }
  if(u.pathname==='/poll'){
    last=Date.now();
    const a=u.searchParams.get('after');
    const from=a===null?seq:(+a>seq?0:+a);
    const msgs=log.filter(x=>x.id>from).map(x=>x.m);
    head(res,200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({last:seq,msgs}));return;
  }
  if(u.pathname==='/send'&&req.method==='POST'){
    let b='';
    req.on('data',d=>{b+=d;if(b.length>3e5)req.destroy()});
    req.on('end',()=>{try{const m=JSON.parse(b);log.push({id:++seq,m});if(log.length>300)log.shift();playSeen(m)}catch(e){}head(res,204);res.end()});
    return;
  }
  if(u.pathname==='/redeem-player.html'||u.pathname==='/'){
    fs.readFile(FILE,(e,d)=>{
      if(e){head(res,500,{'Content-Type':'text/plain; charset=utf-8'});res.end('Рядом с server.js нет redeem-player.html');return}
      head(res,200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(d);
    });
    return;
  }
  head(res,404);res.end();
});
function peer(p,method,body){
  return new Promise(res=>{
    const r=http.request({host:'127.0.0.1',port:PORT,path:p,method:method||'GET',headers:{'X-Radio':'1','Content-Type':'application/json'}},s=>{
      let b='';s.on('data',d=>b+=d);s.on('end',()=>{let j=null;try{j=JSON.parse(b)}catch(e){}res(j)})});
    r.setTimeout(3000,()=>{r.destroy();res(null)});r.on('error',()=>res(null));r.end(body);
  });
}
function killOld(){
  try{
    const c=execFileSync('netstat',['-ano','-p','tcp'],{encoding:'utf8',windowsHide:true}).split(/\r?\n/).map(l=>l.trim().split(/\s+/)).find(c=>c[1]==='127.0.0.1:'+PORT&&c[3]==='LISTENING');
    const pid=c&&+c[4];if(!pid)return;
    if(/^"node\.exe"/i.test(execFileSync('tasklist',['/FI','PID eq '+pid,'/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true}).trim()))
      execFileSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  }catch(e){}
}
let lTry=0,waitT=0;
const relisten=ms=>setTimeout(()=>srv.listen(PORT,'127.0.0.1'),ms);
srv.on('error',async e=>{
  if(e.code!=='EADDRINUSE'||++lTry>45){console.log(e.message);process.exit(0)}
  let t=await peer('/ver');
  if(t&&t.leaving){relisten(1000);return}
  if(t&&t.ver===VER){
    if(!waitT){
      waitT=Date.now();console.log('Сервер уже запущен на порту '+PORT);
    }
    if(Date.now()-waitT<20000){relisten(1000);return}
    process.exit(0);
  }
  const p=await peer('/poll');
  if(!p||!('last' in p)){
    if(waitT||lTry<4){relisten(1000);return}
    console.log('Порт '+PORT+' занят другой программой');process.exit(0);
  }
  console.log('Заменяю старую версию сервера');
  if(t&&t.ver)await peer('/quit','POST');else killOld();
  relisten(1500);
});
srv.listen(PORT,'127.0.0.1');
srv.once('listening',()=>{
  console.log('Готово: http://localhost:'+PORT+'/redeem-player.html');
  setInterval(()=>{
    if(Date.now()-GEO.at>6e5){GEO.at=Date.now();geo()}
  },2000);
  setInterval(savePlays,5000);
});
if(AUTO){
  let obsSeen=false,obsGone=0;
  setInterval(()=>execFile('tasklist',['/FO','CSV','/NH'],{windowsHide:true},(e,out)=>{
    if(e||leaving)return;
    if(/^"obs(64|32)?\.exe"/mi.test(out)){obsSeen=true;obsGone=0}
    else if(obsSeen&&++obsGone>=2)shutdown('OBS больше не запущен');
  }),5000);
  setInterval(()=>{if(Date.now()-last>IDLE)shutdown('плеер и панель молчат')},Math.min(10000,IDLE/2));
}
