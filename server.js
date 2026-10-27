const http=require('http'),https=require('https'),fs=require('fs'),path=require('path'),os=require('os'),net=require('net'),tls=require('tls'),zlib=require('zlib'),crypto=require('crypto'),{spawn,spawnSync,execFile,execFileSync}=require('child_process');
const APP={name:'Bzden4ik Player',version:'1.2.2',repo:'Bzden4ik/OBS-Player'};
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
    len:+v.lengthSeconds||0,views:v.viewCount==null?null:+v.viewCount,countries:mf.availableCountries||null,
    cat:String(mf.category||''),mvt:String(v.musicVideoType||'')};
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
const OPEN_OK=/^https:\/\/(t\.me\/vtuberstand|github\.com\/Bzden4ik\/OBS-Player)([\/?#][^\s"<>]*)?$/;
const bus=m=>{m.n='s'+(++seq)+'-'+Date.now();log.push({id:seq,m});if(log.length>300)log.shift()};
let panelSeen=0;
const ADV_F=path.join(__dirname,'adv.json');
const CMDS=['skip','ban','skipback','banu','unban','stop','vol','off','help'];
const LOGIN=/^[a-z0-9_]{1,25}$/,UID=/^\d{1,20}$/;
let ADV={rev:0,play:{on:false,mod:true,vip:true,sub:true,fol:true,days:14,per:2},ask:true,closed:null,rights:{},bans:[],ctx:null};
try{const j=JSON.parse(fs.readFileSync(ADV_F,'utf8'));
  if(j&&typeof j==='object')ADV={...ADV,...j,play:{...ADV.play,...(j.play&&typeof j.play==='object'?j.play:{})}};
  if(!ADV.rights||typeof ADV.rights!=='object'||Array.isArray(ADV.rights))ADV.rights={};
  if(!Array.isArray(ADV.bans))ADV.bans=[];
}catch(e){}
const saveAdv=()=>{try{fs.writeFileSync(ADV_F+'.tmp',JSON.stringify(ADV));fs.renameSync(ADV_F+'.tmp',ADV_F)}catch(e){console.log('adv.json не сохранился: '+e.message)}};
const str=(v,n)=>String(v==null?'':v).slice(0,n);
const nick=v=>String(v||'').trim().replace(/^@/,'').toLowerCase();
function advOp(j){
  const P=ADV.play;
  switch(j&&j.op){
    case 'play':
      for(const k of ['on','mod','vip','sub','fol'])if(typeof j[k]==='boolean')P[k]=j[k];
      if(j.days!=null){const d=Math.round(+j.days);if(!(d>=0&&d<=3650))return false;P.days=d}
      if(j.per!=null){const d=Math.round(+j.per);if(!(d>=1&&d<=50))return false;P.per=d}
      return true;
    case 'ask':if(typeof j.v!=='boolean')return false;ADV.ask=j.v;return true;
    case 'closed':ADV.closed=j.v?{by:str(j.by,40),at:Date.now()}:null;return true;
    case 'right':{
      if(!UID.test(j.id||'')||!j.cmds||typeof j.cmds!=='object')return false;
      const r={...(ADV.rights[j.id]||{})};
      for(const c of CMDS)if(typeof j.cmds[c]==='boolean'){if(j.cmds[c])r[c]=1;else delete r[c]}
      if(Object.keys(r).length)ADV.rights[j.id]=r;else delete ADV.rights[j.id];
      return true}
    case 'ban':{
      const l=nick(j.login);if(!LOGIN.test(l)||(j.id&&!UID.test(j.id)))return false;
      ADV.bans=[{login:l,id:j.id||'',name:str(j.name||l,40),by:str(j.by,40),at:Date.now()},...ADV.bans.filter(b=>b.login!==l&&!(j.id&&b.id===j.id))].slice(0,1000);
      return true}
    case 'unban':{const l=nick(j.login),n=ADV.bans.length;ADV.bans=ADV.bans.filter(b=>b.login!==l);return ADV.bans.length!==n||'same'}
    case 'ctx':{
      const c=j.ctx;if(!c||typeof c!=='object')return false;
      const ch=c.chan||{},x={chan:{id:str(ch.id,20),login:str(ch.login,25),name:str(ch.name,40),type:str(ch.type,12)},
        mods:(Array.isArray(c.mods)?c.mods:[]).filter(m=>m&&UID.test(m.id)).slice(0,500).map(m=>({id:m.id,login:str(m.login,25),name:str(m.name,40)})),
        need:(Array.isArray(c.need)?c.need:[]).slice(0,10).map(s=>str(s,80)),chat:str(c.chat,200),write:!!c.write,reward:str(c.reward,200),
        av:Object.fromEntries(Object.entries(c.av&&typeof c.av==='object'?c.av:{}).filter(([k,v])=>UID.test(k)&&typeof v==='string'&&v.length<300&&/^https:\/\/static-cdn\.jtvnw\.net\/[\w\-\/.]+$/.test(v)).slice(0,600))};
      const old=ADV.ctx?{...ADV.ctx}:null;if(old)delete old.at;
      if(JSON.stringify(old)===JSON.stringify(x))return 'same';
      ADV.ctx={...x,at:Date.now()};return true}
  }
  return false;
}
const DBG_DIR=path.join(__dirname,'debug'),DBG_RE=/^debug-[\d_-]+\.txt$/;
const SLOG=[],log0=console.log;
console.log=(...a)=>{SLOG.push(new Date().toLocaleTimeString('ru-RU')+' '+a.join(' '));if(SLOG.length>300)SLOG.shift();log0(...a)};
function dbgFiles(){
  try{return fs.readdirSync(DBG_DIR).filter(f=>DBG_RE.test(f)).sort().reverse().map(f=>{
    const p=path.join(DBG_DIR,f),s=fs.statSync(p);let why='';
    try{const fd=fs.openSync(p,'r'),b=Buffer.alloc(400);fs.readSync(fd,b,0,400,0);fs.closeSync(fd);why=(/Причина: ([^\r\n]*)/.exec(b.toString('utf8'))||[])[1]||''}catch(e){}
    return{name:f,size:s.size,at:s.mtimeMs,why}})}catch(e){return[]}
}
function saveDebug(text,why){
  fs.mkdirSync(DBG_DIR,{recursive:true});
  const d=new Date(),p=n=>String(n).padStart(2,'0');
  let name='debug-'+d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'_'+p(d.getHours())+'-'+p(d.getMinutes())+'-'+p(d.getSeconds())+'.txt';
  if(fs.existsSync(path.join(DBG_DIR,name)))name=name.replace('.txt','-'+Date.now()%1000+'.txt');
  const out=['Bzden4ik Player — файл отладки','Причина: '+str(why,120),'Создан: '+d.toLocaleString('ru-RU'),'',
    '== Сервер',
    APP.name+' '+APP.version+(APP.edition?' · '+APP.edition:'')+' · отпечаток server.js '+VER,
    'Node '+process.version+' · '+os.type()+' '+os.release()+' '+os.arch()+' · память '+Math.round(os.freemem()/1048576)+' свободно из '+Math.round(os.totalmem()/1048576)+' МБ',
    'Работает '+Math.round(process.uptime()/60)+' мин · '+(AUTO?'запущен скриптом OBS':'запущен вручную')+' · папка '+__dirname,
    'Панель в OBS: '+(Date.now()-panelSeen<5000?'на связи':'не на связи')+' · плеер опрашивал '+Math.round((Date.now()-last)/1000)+' с назад',
    'Обновления: '+JSON.stringify({...appInfo(),latest:UPD.latest&&{version:UPD.latest.version,zip:UPD.latest.zip,date:UPD.latest.date}}),
    'Страна для YouTube: '+(GEO.cc||'неизвестно')+' · Twitch для закрытия заказов: '+(TW?'есть, наград '+TW.ids.length:'нет'),
    'Расширенные: '+JSON.stringify({play:ADV.play,ask:ADV.ask,closed:ADV.closed,rights:Object.keys(ADV.rights).length,bans:ADV.bans.length,ctx:ADV.ctx&&{chan:ADV.ctx.chan,mods:ADV.ctx.mods.length,need:ADV.ctx.need,chat:ADV.ctx.chat}}),
    '',str(text,2e6),'','== Лог сервера',...SLOG];
  fs.writeFileSync(path.join(DBG_DIR,name),'﻿'+out.join('\r\n'));
  dbgFiles().slice(10).forEach(f=>{try{fs.unlinkSync(path.join(DBG_DIR,f.name))}catch(e){}});
  console.log('Файл отладки: '+name+' ('+str(why,60)+')');
  return name;
}
const UPD={latest:null,checked:0,err:'',stage:'',msg:''},UPD_BUSY=['download','extract','install','restart'];
const KEEP=new Set(['data.json','data.backup.json','plays.json','state.json','adv.json']);
const vnum=v=>String(v||'').replace(/^v/i,'').split(/[.-]/).map(n=>parseInt(n,10)||0);
const vcmp=(a,b)=>{const x=vnum(a),y=vnum(b);for(let i=0;i<Math.max(x.length,y.length);i++)if((x[i]||0)!==(y[i]||0))return(x[i]||0)>(y[i]||0)?1:-1;return 0};
const appInfo=()=>({name:APP.name,version:APP.version,edition:APP.edition||'',latest:UPD.latest,
  newer:!!(UPD.latest&&vcmp(UPD.latest.version,APP.version)>0),err:UPD.err,stage:UPD.stage,msg:UPD.msg,checked:UPD.checked});
const stage=(s,m)=>{UPD.stage=s;UPD.msg=m;console.log('Обновление: '+m)};
async function checkUpdate(force){
  if(!force&&Date.now()-UPD.checked<55*6e4)return;
  UPD.checked=Date.now();
  try{
    const r=await fetchVia('https://api.github.com/repos/'+APP.repo+'/releases/latest',{ua:APP.name+'/'+APP.version,headers:{Accept:'application/vnd.github+json'}});
    if(r.status===404)throw new Error('на GitHub ещё нет релизов');
    if(r.status!==200)throw new Error('GitHub ответил '+r.status);
    const j=JSON.parse(r.body),a=(j.assets||[]).find(x=>/\.zip$/i.test(x.name));
    UPD.latest={version:String(j.tag_name||'').replace(/^v/i,''),url:j.html_url||'',notes:String(j.body||'').slice(0,4000),zip:a?a.browser_download_url:'',date:j.published_at||''};
    UPD.err='';
  }catch(e){UPD.err=e.message}
}
function download(url){
  return new Promise((res,rej)=>{
    let hops=0;
    const go=href=>{
      const x=new URL(href);
      const r=https.get({host:x.hostname,path:x.pathname+x.search,headers:{'User-Agent':APP.name+'/'+APP.version}},resp=>{
        if([301,302,303,307,308].includes(resp.statusCode)&&resp.headers.location){resp.resume();if(++hops>5)return rej(new Error('слишком много перенаправлений'));return go(new URL(resp.headers.location,href).href)}
        if(resp.statusCode!==200){resp.resume();return rej(new Error('архив не скачался (HTTP '+resp.statusCode+')'))}
        const ch=[];let n=0;
        resp.on('data',d=>{n+=d.length;if(n>50e6){r.destroy();rej(new Error('архив слишком большой'))}else ch.push(d)});
        resp.on('end',()=>res(Buffer.concat(ch)));resp.on('error',rej);
      });
      r.setTimeout(30000,()=>r.destroy(new Error('нет ответа от GitHub')));r.on('error',rej);
    };
    go(url);
  });
}
const RELEASE_KEY='MCowBQYDK2VwAyEApq9urB4+WT+kbD47M6tJ1nlprBW60Mmwuc4IVFYxAtQ=';
function unzip(buf){
  let e=-1;
  for(let i=buf.length-22;i>=Math.max(0,buf.length-22-65535);i--)if(buf.readUInt32LE(i)===0x06054b50){e=i;break}
  if(e<0)throw new Error('архив повреждён');
  const n=buf.readUInt16LE(e+10),out=new Map();let p=buf.readUInt32LE(e+16);
  if(n>500)throw new Error('в архиве слишком много файлов');
  for(let k=0;k<n;k++){
    if(p+46>buf.length||buf.readUInt32LE(p)!==0x02014b50)throw new Error('архив повреждён');
    const fl=buf.readUInt16LE(p+8),meth=buf.readUInt16LE(p+10),csize=buf.readUInt32LE(p+20),nl=buf.readUInt16LE(p+28),
      xl=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32),lh=buf.readUInt32LE(p+42),name=buf.toString('utf8',p+46,p+46+nl);
    p+=46+nl+xl+cl;
    if(name.endsWith('/'))continue;
    out.set(name,()=>{
      if(fl&1)throw new Error('архив зашифрован');
      if(lh+30>buf.length||buf.readUInt32LE(lh)!==0x04034b50)throw new Error('архив повреждён');
      const d=lh+30+buf.readUInt16LE(lh+26)+buf.readUInt16LE(lh+28);
      if(d+csize>buf.length)throw new Error('архив повреждён');
      const raw=buf.subarray(d,d+csize);
      if(meth===0)return raw;
      if(meth===8)try{return zlib.inflateRawSync(raw,{maxOutputLength:20e6})}catch(x){throw new Error('файл '+name+' в архиве повреждён или слишком большой')}
      throw new Error('неизвестное сжатие в архиве');
    });
  }
  return out;
}
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
function signedFiles(zip,ver){
  if(!RELEASE_KEY)throw new Error('в этой сборке нет ключа подписи — обнови вручную со страницы релизов');
  const all=unzip(zip),mk=[...all.keys()].find(k=>/^([^/]+\/)?release\.json$/.test(k));
  if(!mk)throw new Error('в архиве нет подписи — такой архив не ставлю');
  const pre=mk.slice(0,-'release.json'.length),get=f=>{const x=all.get(pre+f);return x?x():null};
  const mf=get('release.json'),sig=get('release.sig');let ok=false;
  try{ok=!!sig&&crypto.verify(null,mf,crypto.createPublicKey({key:Buffer.from(RELEASE_KEY,'base64'),format:'der',type:'spki'}),Buffer.from(sig.toString('utf8').trim(),'base64'))}catch(e){}
  if(!ok)throw new Error('подпись не сходится: архив выпустил не автор или он повреждён. Обновление отменено, ничего не тронуто');
  let m=null;try{m=JSON.parse(mf.toString('utf8'))}catch(e){}
  if(!m||m.version!==ver)throw new Error('в архиве версия '+(m&&m.version)+', а не '+ver+' — обновление отменено');
  if((m.edition||'')!==(APP.edition||''))throw new Error('архив для другой сборки ('+(m.edition||'публичная')+') — обновление отменено, ничего не тронуто');
  const out=new Map();
  for(const [f,h] of Object.entries(m.files||{})){
    if(!/^[A-Za-z0-9][\w.-]*$/.test(f)||KEEP.has(f))throw new Error('в подписи недопустимое имя файла: '+f);
    const d=get(f);
    if(!d||sha256(d)!==h)throw new Error('файл '+f+' не совпадает с подписью — обновление отменено, ничего не тронуто');
    out.set(f,d);
  }
  if(!out.has('server.js')||!out.has('redeem-player.html'))throw new Error('в архиве нет server.js и redeem-player.html');
  return out;
}
async function runUpdate(){
  if(fs.existsSync(path.join(__dirname,'.git')))
    throw new Error('это папка с исходниками — её не обновляют из релиза, чтобы не затереть правки');
  const L=UPD.latest;
  if(!L||vcmp(L.version,APP.version)<=0)throw new Error('новой версии нет');
  if(!L.zip)throw new Error('в релизе '+L.version+' нет архива .zip');
  stage('download','Скачиваю версию '+L.version+'…');
  const zip=await download(L.zip);
  stage('extract','Проверяю подпись…');
  const files=signedFiles(zip,L.version);
  const tmp=path.join(os.tmpdir(),'bzden4ik-player-update');
  fs.rmSync(tmp,{recursive:true,force:true});fs.mkdirSync(tmp,{recursive:true});
  fs.writeFileSync(path.join(tmp,'server.js'),files.get('server.js'));
  try{execFileSync(process.execPath,['--check',path.join(tmp,'server.js')],{stdio:'pipe',windowsHide:true})}
  catch(e){throw new Error('в новой версии ошибка в server.js — обновление отменено, ничего не тронуто')}
  finally{fs.rmSync(tmp,{recursive:true,force:true})}
  stage('install','Устанавливаю…');
  const bak=path.join(__dirname,'backup');fs.rmSync(bak,{recursive:true,force:true});fs.mkdirSync(bak);
  for(const [f,d] of files){
    const dst=path.join(__dirname,f);
    if(fs.existsSync(dst))fs.copyFileSync(dst,path.join(bak,f));
    fs.writeFileSync(dst,d);
  }
  restartObs(L.version);
}
function splitArgs(s){
  const out=[];let cur='',q=false,has=false;
  for(const c of String(s||'')){
    if(c==='"'){q=!q;has=true;continue}
    if(!q&&/\s/.test(c)){if(cur||has){out.push(cur);cur='';has=false}continue}
    cur+=c;
  }
  if(cur||has)out.push(cur);
  return out;
}
const RESTARTER="const {execFileSync,spawn}=require('child_process');const o=JSON.parse(process.argv[1]);"+
  "const alive=()=>{try{return execFileSync('tasklist',['/FI','PID eq '+o.pid,'/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true}).includes('\"'+o.pid+'\"')}catch(e){return false}};"+
  "try{execFileSync('taskkill',['/PID',String(o.pid)],{windowsHide:true,stdio:'ignore'})}catch(e){}"+
  "let n=0;const t=setInterval(()=>{if(!alive()){clearInterval(t);setTimeout(()=>{spawn(o.exe,o.args,{cwd:o.cwd,detached:true,stdio:'ignore'}).unref();setTimeout(()=>process.exit(0),500)},3000)}"+
  "else if(++n>180){clearInterval(t);process.exit(0)}},1000);";
function restartObs(ver){
  const ps='[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Where-Object { $_.Name -match "^obs(64|32)?\\.exe$" } | Select-Object -First 1 ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress';
  execFile('powershell',['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true},(e,out)=>{
    let o=null;try{o=JSON.parse(out)}catch(x){}
    if(!o||!o.ExecutablePath){stage('done','Версия '+ver+' установлена. Перезапусти OBS, чтобы она заработала');return}
    const arg={pid:o.ProcessId,exe:o.ExecutablePath,args:splitArgs(o.CommandLine).slice(1),cwd:path.dirname(o.ExecutablePath)};
    spawn(process.execPath,['-e',RESTARTER,JSON.stringify(arg)],{detached:true,stdio:'ignore',windowsHide:true}).unref();
    stage('restart','Версия '+ver+' установлена, OBS перезапускается. Если OBS спросит подтверждение (идёт стрим или запись) — ответь в его окне');
  });
}
process.on('exit',savePlays);
process.on('SIGINT',()=>process.exit(0));
const SEC={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"frame-ancestors 'none'"};
const head=(res,code,h)=>res.writeHead(code,{...SEC,...(h||{})});
const CSP=n=>["default-src 'self'","script-src 'nonce-"+n+"' https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://db.onlinewebfonts.com","font-src 'self' data: https://fonts.gstatic.com https://db.onlinewebfonts.com",
  "img-src 'self' data: https://i.ytimg.com https://static-cdn.jtvnw.net","frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "connect-src 'self' https://api.twitch.tv https://id.twitch.tv wss://eventsub.wss.twitch.tv https://www.googleapis.com https://www.youtube.com",
  "object-src 'none'","base-uri 'none'","form-action 'none'","frame-ancestors 'none'"].join('; ');
let obsArgs=null;
function obsPx(){
  if(!obsArgs)obsArgs=new Promise(done=>execFile('powershell',['-NoProfile','-NonInteractive','-Command',
    "(Get-CimInstance Win32_Process -Filter \"Name='obs64.exe' OR Name='obs32.exe' OR Name='obs.exe'\" | Select-Object -First 1).CommandLine"],
    {windowsHide:true,timeout:20000},(e,out)=>{
      const a=/(--proxy-(?:server|[a-z]+-url))=("[^"]*"|\S+)/.exec(String(out||''));if(!a)return done(null);
      let v=a[2].replace(/^"|"$/g,''),to='';
      if(/^data:/i.test(v)){
        const c=v.indexOf(',');let pac='';
        try{pac=/;base64$/i.test(v.slice(0,c))?Buffer.from(v.slice(c+1),'base64').toString():decodeURIComponent(v.slice(c+1))}catch(er){}
        const p=/\b[A-Z]+5?\s+([\w.-]+):(\d{1,5})\b/.exec(pac);if(p)to=p[1]+':'+p[2];
      }else if(a[1]==='--proxy-server'){const p=/([\w.-]+):(\d{1,5})(?=[\/;]|$)/.exec(v.replace(/^(\w+=)?\w+:\/\//,''));if(p)to=p[1]+':'+p[2]}
      done(to?{arg:a[1],to}:null);
    }));
  return obsArgs.then(o=>!o?{}:new Promise(done=>{
    const i=o.to.lastIndexOf(':'),s=net.connect({host:o.to.slice(0,i),port:+o.to.slice(i+1),timeout:2000});
    const fin=dead=>{s.destroy();done({...o,dead})};
    s.on('connect',()=>fin(false));s.on('timeout',()=>fin(true));s.on('error',()=>fin(true));
  }));
}
const srv=http.createServer((req,res)=>{
  if(!HOSTS.includes(req.headers.host)){head(res,403);res.end();return}
  const u=new URL(req.url,'http://x');
  const page=u.pathname==='/'||u.pathname==='/redeem-player.html',sfs=req.headers['sec-fetch-site'];
  if(!page&&u.pathname!=='/proxy.pac'&&sfs&&sfs!=='same-origin'&&sfs!=='none'){head(res,403);res.end();return}
  if(req.method==='POST'){
    const o=req.headers.origin;
    if((o&&!ORIGINS.includes(o))||req.headers['x-radio']!=='1'){head(res,403);res.end();return}
  }
  if(u.pathname==='/quit'&&req.method==='POST'){head(res,204);res.end();setTimeout(()=>process.exit(0),100);return}
  if(u.pathname==='/ver'&&req.method==='GET'){json(res,{ver:VER,leaving:!!leaving});return}
  if(u.pathname==='/obs/px'&&req.method==='GET'){obsPx().then(r=>json(res,r));return}
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
    body(req,500,j=>{
      const id=j&&j.id,url=j&&j.url;
      const to=ID.test(id||'')?'https://www.youtube.com/watch?v='+id:typeof url==='string'&&OPEN_OK.test(url)?url
        :j&&j.page==='settings'?'http://localhost:'+PORT+'/redeem-player.html?view=settings':'';
      if(!to){head(res,400);res.end();return}
      try{spawn('rundll32',['url.dll,FileProtocolHandler',to],{detached:true,stdio:'ignore',windowsHide:true}).unref();head(res,204)}catch(e){head(res,500)}
      res.end()});
    return;
  }
  if(u.pathname==='/adv'){
    if(req.method==='POST'){body(req,2e5,j=>{
      const r=advOp(j);if(!r){head(res,400);res.end();return}
      if(r!=='same'){ADV.rev++;saveAdv();bus({t:'adv',rev:ADV.rev})}
      json(res,{ok:true,rev:ADV.rev})});return}
    if(req.method!=='GET'){head(res,405);res.end();return}
    json(res,{...ADV,cmds:CMDS,panel:Date.now()-panelSeen<5000});return;
  }
  if(u.pathname==='/debug'){
    if(req.method==='POST'){body(req,3e6,j=>{
      if(!j||typeof j.text!=='string'){head(res,400);res.end();return}
      try{const name=saveDebug(j.text,j.why);bus({t:'dbg',name});json(res,{name,path:path.join(DBG_DIR,name)})}
      catch(e){head(res,500,{'Content-Type':'application/json'});res.end(JSON.stringify({err:e.message}))}});return}
    json(res,{dir:DBG_DIR,files:dbgFiles()});return;
  }
  if(u.pathname==='/debug/show'&&req.method==='POST'){
    body(req,300,j=>{
      const f=j&&typeof j.name==='string'&&DBG_RE.test(j.name)?path.join(DBG_DIR,j.name):'';
      if(!f||!fs.existsSync(f)){head(res,404);res.end();return}
      try{spawn('explorer',['/select,',f],{detached:true,stdio:'ignore',windowsHide:false}).unref();head(res,204)}catch(e){head(res,500)}
      res.end()});
    return;
  }
  if(u.pathname==='/app'&&req.method==='GET'){json(res,appInfo());return}
  if(u.pathname==='/app/check'&&req.method==='POST'){checkUpdate(true).then(()=>json(res,appInfo()));return}
  if(u.pathname==='/app/update'&&req.method==='POST'){
    if(UPD_BUSY.includes(UPD.stage)){head(res,409);res.end();return}
    runUpdate().catch(e=>{UPD.stage='error';UPD.msg=e.message;console.log('Обновление: '+e.message)});
    json(res,appInfo());return;
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
    last=Date.now();if(u.searchParams.get('p')==='1')panelSeen=last;
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
  if(page){
    fs.readFile(FILE,'utf8',(e,d)=>{
      if(e){head(res,500,{'Content-Type':'text/plain; charset=utf-8'});res.end('Рядом с server.js нет redeem-player.html');return}
      const n=crypto.randomBytes(16).toString('base64');
      head(res,200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':CSP(n)});
      res.end(d.replace(/<script>/g,'<script nonce="'+n+'">'));
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
  setTimeout(()=>checkUpdate(),8000);setInterval(()=>checkUpdate(),36e5);
});
if(AUTO){
  let obsPid=0,obsGone=0,tries=0;
  const alive=pid=>{try{process.kill(pid,0);return true}catch(e){return e.code==='EPERM'}};
  setInterval(()=>{
    if(leaving)return;
    if(!obsPid){
      if(++tries<=12)execFile('tasklist',['/FI','IMAGENAME eq obs*','/FO','CSV','/NH'],{windowsHide:true},(e,out)=>{
        const m=/^"obs(64|32)?\.exe","(\d+)"/mi.exec(out||'');if(m)obsPid=+m[2];
      });
      return;
    }
    if(alive(obsPid)){obsGone=0;return}
    if(++obsGone>=2)shutdown('OBS больше не запущен');
  },5000);
  setInterval(()=>{if(Date.now()-last>IDLE)shutdown('плеер и панель молчат')},Math.min(10000,IDLE/2));
}
