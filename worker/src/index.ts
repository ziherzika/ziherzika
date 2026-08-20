import { DurableObject } from "cloudflare:workers";

type Env = Cloudflare.Env;
type User = { id:string; email:string; display_name:string };
type Message = { id:string; userId:string; author:string; body:string; createdAt:number };

const encoder = new TextEncoder();

export class ChatRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, author TEXT NOT NULL,
        body TEXT NOT NULL, created_at INTEGER NOT NULL
      ); CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);`);
    });
  }

  getMessages(limit = 100): Message[] {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    return this.ctx.storage.sql.exec<{id:string;user_id:string;author:string;body:string;created_at:number}>(
      "SELECT id,user_id,author,body,created_at FROM messages ORDER BY created_at DESC LIMIT ?", safeLimit
    ).toArray().reverse().map(row => ({ id:row.id, userId:row.user_id, author:row.author, body:row.body, createdAt:row.created_at }));
  }

  sendMessage(userId:string, author:string, body:string): Message {
    const message = { id:crypto.randomUUID(), userId, author, body:body.trim().slice(0,2000), createdAt:Date.now() };
    if (!message.body) throw new Error("Poruka je prazna");
    this.ctx.storage.sql.exec("INSERT INTO messages (id,user_id,author,body,created_at) VALUES (?,?,?,?,?)", message.id,message.userId,message.author,message.body,message.createdAt);
    const payload = JSON.stringify({ type:"message", message });
    for (const socket of this.ctx.getWebSockets()) { try { socket.send(payload); } catch { socket.close(1011,"Send failed"); } }
    return message;
  }

  async fetch(request:Request):Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket upgrade required",{status:426});
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId:request.headers.get("X-Ziherzika-User")||"unknown" });
    return new Response(null,{status:101,webSocket:client});
  }

  webSocketMessage(socket:WebSocket, raw:string|ArrayBuffer):void {
    try {
      const data = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as {type?:string};
      if (data.type === "ping") socket.send(JSON.stringify({type:"pong"}));
    } catch { socket.send(JSON.stringify({type:"error",message:"Neispravna poruka"})); }
  }
  webSocketClose(socket:WebSocket, code:number, reason:string):void { socket.close(code,reason); }
}

export default {
  async fetch(request:Request, env:Env):Promise<Response> {
    const origin=request.headers.get("Origin");
    const cors=corsHeaders(origin,env.ALLOWED_ORIGINS);
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
    try {
      const response=await route(request,env);
      const headers=new Headers(response.headers);Object.entries(cors).forEach(([k,v])=>headers.set(k,v));
      headers.set("X-Content-Type-Options","nosniff");headers.set("Referrer-Policy","strict-origin-when-cross-origin");
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    } catch(error) {
      if (error instanceof HttpError) return json({error:error.message},error.status,cors);
      console.error(JSON.stringify({level:"error",message:"request_failed",error:String(error),path:new URL(request.url).pathname}));
      return json({error:"Dogodila se greška."},500,cors);
    }
  }
} satisfies ExportedHandler<Env>;

async function route(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url), path=url.pathname.replace(/\/$/,"")||"/";
  if(path==="/") return json({name:"Ziherzika API",status:"ok"});
  if(path==="/api/auth/register"&&request.method==="POST") return register(request,env);
  if(path==="/api/auth/login"&&request.method==="POST") return login(request,env);
  if(path==="/api/me"&&request.method==="GET") { const user=await requireUser(request,env);return json({user}); }
  if(path==="/api/youtube/metadata"&&request.method==="GET") return youtubeMetadata(url);
  const user=await requireUser(request,env);
  if(path==="/api/tracks"&&request.method==="GET") return listPersonalTracks(user,env);
  if(path==="/api/tracks"&&request.method==="POST") return createPersonalTrack(request,user,env);
  const personalTrackMatch=path.match(/^\/api\/tracks\/([^/]+)$/);
  if(personalTrackMatch&&request.method==="PATCH") return updatePersonalTrack(request,personalTrackMatch[1],user,env);
  if(path==="/api/projects"&&request.method==="GET") return listProjects(user,env);
  if(path==="/api/projects"&&request.method==="POST") return createProject(request,user,env);
  const projectMatch=path.match(/^\/api\/projects\/([^/]+)$/);
  if(projectMatch&&request.method==="GET") return getProject(projectMatch[1],user,env);
  const tracksMatch=path.match(/^\/api\/projects\/([^/]+)\/tracks$/);
  if(tracksMatch&&request.method==="GET") return listTracks(tracksMatch[1],user,env);
  if(tracksMatch&&request.method==="POST") return createTrack(request,tracksMatch[1],user,env);
  const trackMatch=path.match(/^\/api\/projects\/([^/]+)\/tracks\/([^/]+)$/);
  if(trackMatch&&request.method==="PATCH") return updateTrack(request,trackMatch[1],trackMatch[2],user,env);
  const chatMatch=path.match(/^\/api\/projects\/([^/]+)\/chat$/);
  if(chatMatch) return chat(request,chatMatch[1],user,env);
  return json({error:"Ruta ne postoji."},404);
}

async function register(request:Request,env:Env):Promise<Response>{
  const body=await readJson<{email?:string;password?:string;displayName?:string}>(request);
  const email=(body.email||"").trim().toLowerCase(), displayName=(body.displayName||"").trim(), password=body.password||"";
  if(!/^\S+@\S+\.\S+$/.test(email)||displayName.length<2||password.length<8) return json({error:"Provjeri ime, email i lozinku (najmanje 8 znakova)."},400);
  const exists=await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();if(exists)return json({error:"Račun s tim emailom već postoji."},409);
  const id=crypto.randomUUID(),salt=randomToken(16),hash=await hashPassword(password,salt),now=Date.now();
  await env.DB.prepare("INSERT INTO users(id,email,display_name,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?)").bind(id,email,displayName,hash,salt,now).run();
  return issueSession({id,email,display_name:displayName},env,201);
}

async function login(request:Request,env:Env):Promise<Response>{
  const body=await readJson<{email?:string;password?:string}>(request),email=(body.email||"").trim().toLowerCase();
  const row=await env.DB.prepare("SELECT id,email,display_name,password_hash,password_salt FROM users WHERE email=?").bind(email).first<User&{password_hash:string;password_salt:string}>();
  if(!row||!await verifyPassword(body.password||"",row.password_salt,row.password_hash))return json({error:"Pogrešan email ili lozinka."},401);
  return issueSession({id:row.id,email:row.email,display_name:row.display_name},env);
}

async function issueSession(user:User,env:Env,status=200):Promise<Response>{const token=randomToken(32),tokenHash=await sha256(token),now=Date.now();await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(tokenHash,user.id,now+30*86400000,now).run();return json({token,user:{id:user.id,email:user.email,displayName:user.display_name}},status)}
async function requireUser(request:Request,env:Env):Promise<User>{const value=request.headers.get("Authorization")||"";if(!value.startsWith("Bearer "))throw new HttpError(401,"Prijava je potrebna.");const hash=await sha256(value.slice(7));const user=await env.DB.prepare("SELECT u.id,u.email,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").bind(hash,Date.now()).first<User>();if(!user)throw new HttpError(401,"Sesija je istekla.");return user}
async function membership(projectId:string,userId:string,env:Env){const row=await env.DB.prepare("SELECT role FROM project_members WHERE project_id=? AND user_id=?").bind(projectId,userId).first<{role:string}>();if(!row)throw new HttpError(403,"Nemaš pristup projektu.");return row.role}
async function listPersonalTracks(user:User,env:Env){const rows=await env.DB.prepare("SELECT id,youtube_id,youtube_url,title,channel,thumbnail_url,bpm,musical_key,notes,tags_json,is_favorite,created_at,updated_at FROM personal_tracks WHERE owner_id=? ORDER BY updated_at DESC").bind(user.id).all();return json({tracks:rows.results})}
async function createPersonalTrack(request:Request,user:User,env:Env){const b=await readJson<{youtubeUrl?:string;title?:string;channel?:string;bpm?:number;musicalKey?:string;notes?:string;tags?:string[]}>(request),videoId=parseYouTubeId(b.youtubeUrl||"");if(!videoId||!(b.title||"").trim())throw new HttpError(400,"YouTube link i naziv su obavezni.");if(b.bpm!=null&&(b.bpm<20||b.bpm>300))throw new HttpError(400,"BPM mora biti između 20 i 300.");const id=crypto.randomUUID(),now=Date.now(),thumbnail=`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;await env.DB.prepare("INSERT INTO personal_tracks(id,owner_id,youtube_id,youtube_url,title,channel,thumbnail_url,bpm,musical_key,notes,tags_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,user.id,videoId,b.youtubeUrl,(b.title||"").trim().slice(0,140),(b.channel||"").slice(0,120),thumbnail,b.bpm||null,(b.musicalKey||"").slice(0,30),(b.notes||"").slice(0,10000),JSON.stringify((b.tags||[]).slice(0,20)),now,now).run();return json({track:{id,youtubeId:videoId,thumbnail}},201)}
async function updatePersonalTrack(request:Request,trackId:string,user:User,env:Env){const body=await readJson<{notes?:unknown}>(request);if(typeof body.notes!=="string")throw new HttpError(400,"Tekst pjesme nije ispravan.");const notes=body.notes.slice(0,10000),result=await env.DB.prepare("UPDATE personal_tracks SET notes=?,updated_at=? WHERE id=? AND owner_id=?").bind(notes,Date.now(),trackId,user.id).run();if(!result.meta.changes)throw new HttpError(404,"Traka ne postoji.");return json({track:{id:trackId,notes}})}
async function listProjects(user:User,env:Env){const rows=await env.DB.prepare("SELECT p.id,p.name,pm.role,p.created_at,(SELECT COUNT(*) FROM project_members x WHERE x.project_id=p.id) members FROM projects p JOIN project_members pm ON pm.project_id=p.id WHERE pm.user_id=? ORDER BY p.created_at DESC").bind(user.id).all();return json({projects:rows.results})}
async function createProject(request:Request,user:User,env:Env){const body=await readJson<{name?:string}>(request),name=(body.name||"").trim().slice(0,80);if(!name)throw new HttpError(400,"Naziv je obavezan.");const id=crypto.randomUUID(),now=Date.now();await env.DB.batch([env.DB.prepare("INSERT INTO projects(id,name,owner_id,created_at) VALUES(?,?,?,?)").bind(id,name,user.id,now),env.DB.prepare("INSERT INTO project_members(project_id,user_id,role,joined_at) VALUES(?,?,?,?)").bind(id,user.id,"owner",now)]);return json({project:{id,name,role:"owner",members:1}},201)}
async function getProject(id:string,user:User,env:Env){await membership(id,user.id,env);const project=await env.DB.prepare("SELECT id,name,owner_id,created_at FROM projects WHERE id=?").bind(id).first();if(!project)throw new HttpError(404,"Projekt ne postoji.");return json({project})}
async function listTracks(projectId:string,user:User,env:Env){await membership(projectId,user.id,env);const rows=await env.DB.prepare("SELECT id,youtube_id,youtube_url,title,channel,thumbnail_url,bpm,musical_key,notes,tags_json,is_favorite,created_at,updated_at FROM tracks WHERE project_id=? ORDER BY updated_at DESC").bind(projectId).all();return json({tracks:rows.results})}
async function createTrack(request:Request,projectId:string,user:User,env:Env){const role=await membership(projectId,user.id,env);if(role==="viewer")throw new HttpError(403,"Nemaš dopuštenje za dodavanje traka.");const b=await readJson<{youtubeUrl?:string;title?:string;channel?:string;bpm?:number;musicalKey?:string;notes?:string;tags?:string[]}>(request),videoId=parseYouTubeId(b.youtubeUrl||"");if(!videoId||!(b.title||"").trim())throw new HttpError(400,"YouTube link i naziv su obavezni.");if(b.bpm!=null&&(b.bpm<20||b.bpm>300))throw new HttpError(400,"BPM mora biti između 20 i 300.");const id=crypto.randomUUID(),now=Date.now(),thumbnail=`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;await env.DB.prepare("INSERT INTO tracks(id,project_id,created_by,youtube_id,youtube_url,title,channel,thumbnail_url,bpm,musical_key,notes,tags_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,projectId,user.id,videoId,b.youtubeUrl,(b.title||"").trim().slice(0,140),(b.channel||"").slice(0,120),thumbnail,b.bpm||null,(b.musicalKey||"").slice(0,30),(b.notes||"").slice(0,10000),JSON.stringify((b.tags||[]).slice(0,20)),now,now).run();return json({track:{id,youtubeId:videoId,thumbnail}},201)}
async function updateTrack(request:Request,projectId:string,trackId:string,user:User,env:Env){const role=await membership(projectId,user.id,env);if(role==="viewer")throw new HttpError(403,"Nemaš dopuštenje za uređivanje trake.");const body=await readJson<{notes?:unknown}>(request);if(typeof body.notes!=="string")throw new HttpError(400,"Tekst pjesme nije ispravan.");const notes=body.notes.slice(0,10000),result=await env.DB.prepare("UPDATE tracks SET notes=?,updated_at=? WHERE id=? AND project_id=?").bind(notes,Date.now(),trackId,projectId).run();if(!result.meta.changes)throw new HttpError(404,"Traka ne postoji.");return json({track:{id:trackId,notes}})}
async function chat(request:Request,projectId:string,user:User,env:Env){await membership(projectId,user.id,env);const stub=env.CHAT_ROOMS.getByName(projectId);if(request.headers.get("Upgrade")?.toLowerCase()==="websocket"){const headers=new Headers(request.headers);headers.set("X-Ziherzika-User",user.id);return stub.fetch(new Request(request,{headers}))}if(request.method==="GET")return json({messages:await stub.getMessages()});if(request.method==="POST"){const b=await readJson<{body?:string}>(request);return json({message:await stub.sendMessage(user.id,user.display_name,b.body||"")},201)}return json({error:"Method not allowed"},405)}
async function youtubeMetadata(url:URL){const target=url.searchParams.get("url")||"";if(!parseYouTubeId(target))throw new HttpError(400,"Neispravan YouTube link.");const response=await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`);if(!response.ok)throw new HttpError(404,"Video nije pronađen.");const data=await response.json<{title:string;author_name:string;thumbnail_url:string}>();return json({title:data.title,channel:data.author_name,thumbnailUrl:data.thumbnail_url})}

class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
async function readJson<T>(request:Request):Promise<T>{const length=Number(request.headers.get("Content-Length")||0);if(length>100_000)throw new HttpError(413,"Zahtjev je prevelik.");try{return await request.json<T>()}catch{throw new HttpError(400,"Neispravan JSON.")}}
function json(data:unknown,status=200,headers?:HeadersInit){return Response.json(data,{status,headers})}
function corsHeaders(origin:string|null,allowed:string){const list=allowed.split(",").map(x=>x.trim());const value=origin&&list.includes(origin)?origin:list[0]||"";return {"Access-Control-Allow-Origin":value,"Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Allow-Methods":"GET,POST,PATCH,DELETE,OPTIONS","Vary":"Origin"}}
function parseYouTubeId(value:string){try{const u=new URL(value);const id=u.hostname.includes("youtu.be")?u.pathname.slice(1):u.searchParams.get("v")||"";return /^[\w-]{11}$/.test(id)?id:""}catch{return ""}}
function randomToken(bytes:number){const a=new Uint8Array(bytes);crypto.getRandomValues(a);return btoa(String.fromCharCode(...a)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","")}
async function sha256(value:string){const digest=await crypto.subtle.digest("SHA-256",encoder.encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")}
async function hashPassword(password:string,salt:string){const key=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:encoder.encode(salt),iterations:100_000},key,256);return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,"0")).join("")}
async function verifyPassword(password:string,salt:string,expected:string){const actual=await hashPassword(password,salt);if(actual.length!==expected.length)return false;let mismatch=0;for(let i=0;i<actual.length;i++)mismatch|=actual.charCodeAt(i)^expected.charCodeAt(i);return mismatch===0}
