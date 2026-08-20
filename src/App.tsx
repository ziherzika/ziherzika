import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ChevronRight, Folder, Home, MoreHorizontal,
  LogOut, Music2, Pause, Play, Plus, Search, Send, Settings, Users, X,
} from "lucide-react";

type Track = { id:string; title:string; channel:string; youtubeId:string; bpm?:number; musicalKey?:string; notes:string; tags:string[]; duration:string; color:string; favorite?:boolean };
type ApiTrack = { id:string; youtube_id:string; title:string; channel:string|null; bpm:number|null; musical_key:string|null; notes:string; tags_json:string; is_favorite:number };
type ChatMessage = { id:string; author:string; initials:string; text:string; time:string; mine?:boolean; track?:Track };
type Project = { id:string; name:string; subtitle:string; members:number; unread:number; color:string };
type ApiProject = { id:string; name:string; members:number; role:string };

const initialTracks: Track[] = [
  { id:"t1", title:"MIDNIGHT RUN", channel:"prod. southside", youtubeId:"5qap5aO4i9A", bpm:140, musicalKey:"F# minor", notes:"Refren nakon drugog dropa. Probati kraći intro.", tags:["dark","trap"], duration:"2:48", color:"violet", favorite:true },
  { id:"t2", title:"NEON HEART", channel:"LUX beats", youtubeId:"jfKfPfyJRdk", bpm:92, musicalKey:"A minor", notes:"Melodični hook, ostaviti više zraka u strofi.", tags:["melodic"], duration:"3:12", color:"rose" },
  { id:"t3", title:"NEMA NAZIVA 03", channel:"niko archive", youtubeId:"DWcJFNfaw9c", notes:"Možda za outro projekta.", tags:["idea"], duration:"2:31", color:"amber" },
];
const demoProjects: Project[] = [
  { id:"p1", name:"Ljetni EP", subtitle:"8 traka · Bruno, Luka i Mia", members:3, unread:12, color:"orchid" },
  { id:"p2", name:"Noćna smjena", subtitle:"4 trake · 2 člana", members:2, unread:0, color:"blue" },
];
const starterMessages: ChatMessage[] = [
  { id:"m1", author:"Luka", initials:"LV", text:"Ovaj zadnji beat ima baš dobar prostor za refren.", time:"10:24" },
  { id:"m2", author:"Mia", initials:"MJ", text:"Da! Dodala sam ga u shortlist ✦", time:"10:27" },
  { id:"m3", author:"Ti", initials:"BK", text:"Večeras snimimo demo pa odlučimo.", time:"10:31", mine:true },
];
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

function youtubeId(value:string) {
  try { const url=new URL(value); return url.hostname.includes("youtu.be") ? url.pathname.slice(1) : url.searchParams.get("v") || ""; } catch { return ""; }
}

function secondsFromDuration(value:string){const parts=value.split(":").map(Number);return parts.length===2&&parts.every(Number.isFinite)?parts[0]*60+parts[1]:0}
function timeLabel(value:number){const safe=Math.max(0,Math.floor(value||0));return `${Math.floor(safe/60)}:${String(safe%60).padStart(2,"0")}`}
function trackFromApi(track:ApiTrack,index:number):Track{let tags:string[]=[];try{const parsed=JSON.parse(track.tags_json);if(Array.isArray(parsed))tags=parsed.filter((tag):tag is string=>typeof tag==="string")}catch{/* invalid legacy tags become empty */}return{id:track.id,title:track.title,channel:track.channel||"YouTube",youtubeId:track.youtube_id,bpm:track.bpm||undefined,musicalKey:track.musical_key||undefined,notes:track.notes||"",tags,duration:"—",color:["violet","rose","amber","lime"][index%4],favorite:Boolean(track.is_favorite)}}

function Cover({track, small=false}:{track:Track; small?:boolean}) {
  return <div className={`cover ${track.color} ${small?"small":""}`}><Music2 size={small?15:19}/></div>;
}

function App() {
  const [signedIn,setSignedIn]=useState(()=>!import.meta.env.VITE_API_URL||Boolean(sessionStorage.getItem("ziherzika_token")));
  const [view,setView]=useState<"home"|"track"|"projects"|"project"|"search">("home");
  const [projectTab,setProjectTab]=useState<"tracks"|"chat">("tracks");
  const productionApi=Boolean(import.meta.env.VITE_API_URL);
  const [tracks,setTracks]=useState(()=>productionApi?[]:initialTracks.map(track=>({...track,notes:localStorage.getItem(`ziherzika_lyrics_${track.id}`)||track.notes})));
  const [projects,setProjects]=useState<Project[]>(()=>productionApi?[]:demoProjects);
  const [messages,setMessages]=useState(starterMessages);
  const [message,setMessage]=useState("");
  const [query,setQuery]=useState("");
  const [newTrack,setNewTrack]=useState(false);
  const [selected,setSelected]=useState<Track|null>(()=>productionApi?null:initialTracks[0]);
  const [playing,setPlaying]=useState(false);
  const [progress,setProgress]=useState(0);
  const [duration,setDuration]=useState(()=>secondsFromDuration(initialTracks[0].duration));
  const [profileOpen,setProfileOpen]=useState(false);
  const [toast,setToast]=useState("");
  const [workspaceLoading,setWorkspaceLoading]=useState(()=>Boolean(sessionStorage.getItem("ziherzika_token")));
  const [saveState,setSaveState]=useState<"saved"|"saving"|"error">("saved");
  const [activeProjectId,setActiveProjectId]=useState<string|null>(()=>sessionStorage.getItem("ziherzika_project"));
  const videoRef=useRef<HTMLIFrameElement|null>(null);
  const saveTimer=useRef<number|null>(null);
  const filtered=useMemo(()=>tracks.filter(t=>`${t.title} ${t.tags.join(" ")} ${t.bpm||""}`.toLowerCase().includes(query.toLowerCase())),[tracks,query]);
  const activeProject=projects.find(project=>project.id===activeProjectId)||projects[0]||null;

  function playerCommand(func:string,args:unknown[]=[]){videoRef.current?.contentWindow?.postMessage(JSON.stringify({event:"command",func,args}),"*")}
  function connectPlayer(){videoRef.current?.contentWindow?.postMessage(JSON.stringify({event:"listening",id:"ziherzika-player"}),"*");playerCommand("getDuration");playerCommand("getCurrentTime")}
  function chooseTrack(track:Track){setSelected(track);setView("track");setSaveState("saved");setProgress(0);setDuration(secondsFromDuration(track.duration));setPlaying(false)}
  function togglePlayback(){if(playing)playerCommand("pauseVideo");else playerCommand("playVideo");setPlaying(value=>!value)}
  function seekTo(value:number){setProgress(value);playerCommand("seekTo",[value,true])}
  async function loadProjectTracks(projectId:string,token:string){const tracksResponse=await fetch(`${API_URL}/api/projects/${projectId}/tracks`,{headers:{Authorization:`Bearer ${token}`}});if(!tracksResponse.ok)throw new Error("Trake se ne mogu učitati.");const tracksData=await tracksResponse.json() as {tracks?:ApiTrack[]};const storedTracks=(tracksData.tracks||[]).map(trackFromApi);setTracks(storedTracks);setSelected(null)}
  async function loadWorkspace(token:string){setWorkspaceLoading(true);try{const projectsResponse=await fetch(`${API_URL}/api/projects`,{headers:{Authorization:`Bearer ${token}`}});if(projectsResponse.status===401){sessionStorage.removeItem("ziherzika_token");sessionStorage.removeItem("ziherzika_project");setSignedIn(false);return}if(!projectsResponse.ok)throw new Error("Projekti se ne mogu učitati.");const projectsData=await projectsResponse.json() as {projects?:ApiProject[]};const realProjects=(projectsData.projects||[]).map((project,index)=>({id:project.id,name:project.name,subtitle:`${project.members} ${project.members===1?"član":"člana"}`,members:project.members,unread:0,color:index%2?"blue":"orchid"}));setProjects(realProjects);const remembered=sessionStorage.getItem("ziherzika_project"),projectId=realProjects.some(project=>project.id===remembered)?remembered:realProjects[0]?.id;if(!projectId){setTracks([]);setSelected(null);return}sessionStorage.setItem("ziherzika_project",projectId);setActiveProjectId(projectId);await loadProjectTracks(projectId,token)}catch(error){flash(error instanceof Error?error.message:"Podaci se ne mogu učitati.")}finally{setWorkspaceLoading(false)}}
  function updateLyrics(value:string){if(!selected)return;const trackId=selected.id;setSelected({...selected,notes:value});setTracks(items=>items.map(track=>track.id===trackId?{...track,notes:value}:track));localStorage.setItem(`ziherzika_lyrics_${trackId}`,value);const token=sessionStorage.getItem("ziherzika_token");if(!token||!activeProjectId)return;setSaveState("saving");if(saveTimer.current!==null)window.clearTimeout(saveTimer.current);saveTimer.current=window.setTimeout(()=>{void(async()=>{try{const response=await fetch(`${API_URL}/api/projects/${activeProjectId}/tracks/${trackId}`,{method:"PATCH",headers:{"content-type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({notes:value})});if(!response.ok)throw new Error();setSaveState("saved")}catch{setSaveState("error")}})()},650)}

  useEffect(()=>{
    function receivePlayerMessage(event:MessageEvent){
      if(event.origin!=="https://www.youtube.com")return;
      try{const data=typeof event.data==="string"?JSON.parse(event.data):event.data;const info=data?.info;if(typeof info?.currentTime==="number"&&info.currentTime>=0&&info.currentTime<86_400)setProgress(info.currentTime);if(typeof info?.duration==="number"&&info.duration>0&&info.duration<86_400)setDuration(info.duration);if(typeof info?.playerState==="number")setPlaying(info.playerState===1)}catch{/* ignore unrelated player messages */}
    }
    window.addEventListener("message",receivePlayerMessage);
    const timer=window.setInterval(()=>{playerCommand("getCurrentTime");playerCommand("getDuration");playerCommand("getPlayerState")},600);
    return()=>{window.removeEventListener("message",receivePlayerMessage);window.clearInterval(timer)};
  },[]);

  useEffect(()=>{const token=sessionStorage.getItem("ziherzika_token");if(token)void loadWorkspace(token);return()=>{if(saveTimer.current!==null)window.clearTimeout(saveTimer.current)}},[]);

  function flash(text:string){setToast(text);window.setTimeout(()=>setToast(""),2200)}
  async function openProject(project:Project){setActiveProjectId(project.id);sessionStorage.setItem("ziherzika_project",project.id);setView("project");setProjectTab("tracks");const token=sessionStorage.getItem("ziherzika_token");if(!token)return;setWorkspaceLoading(true);try{await loadProjectTracks(project.id,token)}catch(error){flash(error instanceof Error?error.message:"Trake se ne mogu učitati.")}finally{setWorkspaceLoading(false)}}
  function addMessage(){if(!message.trim())return;setMessages(v=>[...v,{id:crypto.randomUUID(),author:"Ti",initials:"BK",text:message.trim(),time:new Date().toLocaleTimeString("hr-HR",{hour:"2-digit",minute:"2-digit"}),mine:true}]);setMessage("")}
  async function saveTrack(form:HTMLFormElement){
    const data=new FormData(form), id=youtubeId(String(data.get("url")));
    if(!id){flash("Unesi ispravan YouTube link");return}
    let title=String(data.get("title")||"").trim(),channel="YouTube";
    if(!title){try{const response=await fetch(`${API_URL}/api/youtube/metadata?url=${encodeURIComponent(String(data.get("url")))}`);if(response.ok){const meta=await response.json() as {title:string;channel:string};title=meta.title;channel=meta.channel}}catch{/* keep fallback */}}
    let track:Track={id:crypto.randomUUID(),title:(title||"Nova traka").toUpperCase(),channel,youtubeId:id,bpm:Number(data.get("bpm"))||undefined,musicalKey:String(data.get("key")||"")||undefined,notes:String(data.get("notes")||""),tags:String(data.get("tags")||"").split(",").map(x=>x.trim()).filter(Boolean),duration:"—",color:"lime"};
    const token=sessionStorage.getItem("ziherzika_token");
    if(token&&activeProjectId){try{const response=await fetch(`${API_URL}/api/projects/${activeProjectId}/tracks`,{method:"POST",headers:{"content-type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({youtubeUrl:data.get("url"),title:track.title,channel:track.channel,bpm:track.bpm,musicalKey:track.musicalKey,notes:track.notes,tags:track.tags})});const body=await response.json() as {track?:{id:string};error?:string};if(!response.ok||!body.track?.id)throw new Error(body.error||"Spremanje nije uspjelo.");track={...track,id:body.track.id}}catch(error){flash(error instanceof Error?error.message:"Spremanje nije uspjelo.");return}}
    setTracks(v=>[track,...v]);setSelected(track);setView("track");setNewTrack(false);flash("Traka je spremljena u bazu")
  }

  if(!signedIn)return <AuthScreen onDone={async(token)=>{sessionStorage.setItem("ziherzika_token",token);await loadWorkspace(token);setSignedIn(true)}}/>;

  return <div className="stage"><main className="app-shell">
    {view==="home"&&<><header className="home-topbar"><div><p className="eyebrow">{activeProject?.name||"ZIHERZIKA"}</p><h1>Tvoje trake</h1></div><div><button className="icon-btn" onClick={()=>setNewTrack(true)} aria-label="Dodaj traku"><Plus/></button><button className="avatar" onClick={()=>setProfileOpen(true)}>B</button></div></header><button className="searchbox" onClick={()=>setView("search")}><Search size={18}/>Pretraži trake</button>{tracks.length?<TrackList title={workspaceLoading?"Učitavam…":`${tracks.length} ${tracks.length===1?"traka":"trake"}`} tracks={tracks} onSelect={chooseTrack}/>:<section className="empty-workspace"><Music2/><h1>{workspaceLoading?"Učitavam trake…":"Još nemaš nijednu traku."}</h1>{!workspaceLoading&&<><p>Zalijepi prvi YouTube beat i kreni pisati.</p><button className="primary" onClick={()=>setNewTrack(true)}><Plus/> Nova traka</button></>}</section>}</>}
    {view==="track"&&selected&&<>
      <header className="track-topbar"><button className="icon-btn back-button" onClick={()=>setView("home")} aria-label="Natrag na trake"><ArrowLeft/></button><button className="track-title" onClick={()=>setView("home")}><p className="eyebrow">TEKST PJESME</p><strong>{selected.title}</strong></button><span/></header>
      <section className="notes-workspace">
        <div className="notes-meta"><div><p>{selected.channel}</p><div className="chips">{selected.bpm&&<span>{selected.bpm} BPM</span>}{selected.musicalKey&&<span>{selected.musicalKey}</span>}{selected.tags.map(tag=><span key={tag}>#{tag}</span>)}</div></div><div className="video-peek"><iframe id="ziherzika-player" ref={videoRef} onLoad={()=>window.setTimeout(connectPlayer,500)} src={`https://www.youtube.com/embed/${selected.youtubeId}?enablejsapi=1&playsinline=1&rel=0&origin=${encodeURIComponent(window.location.origin)}`} title={`${selected.title} video`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen/></div></div>
        <textarea className="lyrics-editor" value={selected.notes} onChange={event=>updateLyrics(event.target.value)} spellCheck placeholder="Počni pisati tekst pjesme…" aria-label="Tekst pjesme"/>
        <div className={`autosave-state ${saveState}`}><i/> {saveState==="saving"?"Spremam u bazu…":saveState==="error"?"Spremanje nije uspjelo":"Spremljeno u bazu"}</div>
      </section>
    </>}
    {view==="projects"&&<>
      <PageHeader title="Projekti" onBack={()=>setView("home")} action={<button className="icon-btn" onClick={()=>flash("Novi projekt — uskoro") }><Plus/></button>}/>
      <p className="page-intro">Folderi u kojima trake i razgovor žive zajedno.</p>
      <div className="project-grid">{projects.map(p=><button className="project-tile" key={p.id} onClick={()=>void openProject(p)}><div className={`folder-art ${p.color}`}><Folder/></div><h3>{p.name}</h3><p>{p.subtitle}</p><span>{p.id===activeProjectId?"Aktivni projekt":"Otvori projekt"}</span></button>)}</div>
    </>}
    {view==="project"&&<>
      <PageHeader title={activeProject?.name||"Projekt"} onBack={()=>setView("projects")} action={<button className="icon-btn"><Users/></button>}/>
      <div className="project-summary"><div className={`folder-art ${activeProject?.color||"orchid"}`}><Folder/></div><div><strong>{activeProject?.members||1} {(activeProject?.members||1)===1?"član":"člana"}</strong><span>Privatni projekt</span></div><button onClick={()=>flash("Pozivni link je kopiran")}>Pozovi</button></div>
      <div className="tabs"><button className={projectTab==="tracks"?"active":""} onClick={()=>setProjectTab("tracks")}>Trake <b>{tracks.length}</b></button><button className={projectTab==="chat"?"active":""} onClick={()=>setProjectTab("chat")}>Chat <b>12</b></button></div>
      {projectTab==="tracks"?<TrackList title="Sve trake" tracks={tracks} onSelect={chooseTrack}/>:<section className="chat"><div className="messages">{messages.map(m=><article className={m.mine?"message mine":"message"} key={m.id}>{!m.mine&&<i>{m.initials}</i>}<div><small>{m.author} · {m.time}</small><p>{m.text}</p></div></article>)}</div><form className="composer" onSubmit={e=>{e.preventDefault();addMessage()}}><button type="button"><Plus/></button><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Napiši poruku…"/><button className="send"><Send/></button></form></section>}
    </>}
    {view==="search"&&<><PageHeader title="Odaberi traku" onBack={()=>setView("home")} action={<button className="icon-btn" onClick={()=>setNewTrack(true)}><Plus/></button>}/><label className="search-input"><Search/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Naslov, tag, BPM…"/>{query&&<button onClick={()=>setQuery("")}><X/></button>}</label><TrackList title={query?`${filtered.length} rezultata`:"Sve trake"} tracks={filtered} onSelect={chooseTrack}/></>}
    {view!=="home"&&view!=="track"&&<button className="fab" onClick={()=>setNewTrack(true)} aria-label="Dodaj traku"><Plus/></button>}
    {selected&&<div className="mini-player"><button className="mini-main" onClick={()=>setView("track")}><Cover track={selected} small/><span><strong>{selected.title}</strong><small>{timeLabel(progress)} / {timeLabel(duration)}</small></span></button><button className="play-toggle" onClick={togglePlayback} aria-label={playing?"Pauziraj":"Pokreni"}>{playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button><label className="player-progress" aria-label="Premotavanje"><input type="range" min="0" max={Math.max(duration,1)} step="0.1" value={Math.min(progress,Math.max(duration,1))} onChange={event=>seekTo(Number(event.target.value))}/></label></div>}
    <nav className="bottom-nav"><NavButton active={view==="home"||view==="track"} icon={<Home/>} label="Početna" onClick={()=>setView("home")}/><NavButton active={view==="projects"||view==="project"} icon={<Folder/>} label="Projekti" onClick={()=>setView("projects")}/><NavButton active={view==="search"} icon={<Search/>} label="Pretraži" onClick={()=>setView("search")}/></nav>
  </main>
  {newTrack&&<Modal title="Nova traka" onClose={()=>setNewTrack(false)}><form className="track-form" onSubmit={e=>{e.preventDefault();saveTrack(e.currentTarget)}}><label>YouTube link<input name="url" type="url" required placeholder="https://youtube.com/watch?v=…"/></label><label>Naziv<input name="title" required placeholder="Naziv beata"/></label><div className="form-row"><label>BPM <span>opcionalno</span><input name="bpm" type="number" min="20" max="300" placeholder="140"/></label><label>Key <span>opcionalno</span><input name="key" placeholder="F# minor"/></label></div><label>Tagovi<input name="tags" placeholder="trap, dark, demo"/></label><label>Početni tekst <span>opcionalno</span><textarea name="notes" rows={4} placeholder="Počni pisati tekst pjesme…"/></label><button className="primary">Spremi traku</button></form></Modal>}
  {profileOpen&&<Modal title="Profil" onClose={()=>setProfileOpen(false)}><div className="profile"><div className="big-avatar">B</div><h2>Bruno</h2><p>bruno@ziherzika.app</p><button><Settings/> Postavke <ChevronRight/></button><button onClick={()=>flash("Demo način rada")}><Users/> Demo račun <ChevronRight/></button><button onClick={()=>{sessionStorage.removeItem("ziherzika_token");sessionStorage.removeItem("ziherzika_project");setSignedIn(false);setProfileOpen(false)}}><LogOut/> Odjavi se <ChevronRight/></button></div></Modal>}
  {toast&&<div className="toast">{toast}</div>}
  </div>
}

function TrackList({title,tracks,onSelect}:{title:string;tracks:Track[];onSelect:(t:Track)=>void}){return <section className="tracks"><div className="section-head"><h2>{title}</h2><button>Prikaži sve</button></div>{tracks.map(t=><button className="track" key={t.id} onClick={()=>onSelect(t)}><Cover track={t}/><span><strong>{t.title}</strong><small>{t.bpm?`${t.bpm} BPM · ${t.musicalKey}`:"BPM i key nisu uneseni"}</small></span><time>{t.duration}</time><MoreHorizontal/></button>)}</section>}
function PageHeader({title,onBack,action}:{title:string;onBack:()=>void;action?:React.ReactNode}){return <header className="page-header"><button className="icon-btn" onClick={onBack}><ArrowLeft/></button><h1>{title}</h1>{action||<span/>}</header>}
function NavButton({active,icon,label,onClick}:{active:boolean;icon:React.ReactNode;label:string;onClick:()=>void}){return <button className={active?"active":""} onClick={onClick}>{icon}<span>{label}</span></button>}
function Modal({title,onClose,children,full=false}:{title:string;onClose:()=>void;children:React.ReactNode;full?:boolean}){return <div className="modal-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)onClose()}}><section className={`modal ${full?"full":""}`}><header><h2>{title}</h2><button onClick={onClose}><X/></button></header>{children}</section></div>}

function AuthScreen({onDone}:{onDone:(token:string)=>void}){
  const [mode,setMode]=useState<"login"|"register">("login"),[error,setError]=useState(""),[loading,setLoading]=useState(false);
  async function submit(form:HTMLFormElement){setLoading(true);setError("");const data=new FormData(form);try{const response=await fetch(`${API_URL}/api/auth/${mode}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:data.get("email"),password:data.get("password"),displayName:data.get("name")})});const body=await response.json() as {token?:string;error?:string};if(!response.ok||!body.token)throw new Error(body.error||"Prijava nije uspjela.");onDone(body.token)}catch(e){setError(e instanceof Error?e.message:"Pokušaj ponovno.")}finally{setLoading(false)}}
  return <main className="auth-screen"><div className="brand-mark"><Music2/></div><p className="eyebrow">ZIHERZIKA · TVOJ GLAZBENI WORKSPACE</p><h1>Sve trake.<br/>Jedna ekipa.</h1><p className="auth-copy">Spremi beatove, zapiši ideje i dovrši pjesme s ljudima s kojima stvaraš.</p><form onSubmit={e=>{e.preventDefault();void submit(e.currentTarget)}}>{mode==="register"&&<label>Ime<input name="name" required minLength={2} placeholder="Kako da te zovemo?"/></label>}<label>Email<input name="email" type="email" required placeholder="ti@email.com"/></label><label>Lozinka<input name="password" type="password" required minLength={8} placeholder="Najmanje 8 znakova"/></label>{error&&<p className="auth-error">{error}</p>}<button className="primary" disabled={loading}>{loading?"Samo malo…":mode==="login"?"Prijavi se":"Napravi račun"}</button></form><button className="auth-switch" onClick={()=>setMode(mode==="login"?"register":"login")}>{mode==="login"?"Nemaš račun? Registriraj se":"Već imaš račun? Prijavi se"}</button></main>
}

export default App;
