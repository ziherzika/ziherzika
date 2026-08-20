import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ChevronRight, Folder, Home, MoreHorizontal,
  LogOut, Music2, Pause, Play, Plus, Search, Send, Settings, Users, X,
} from "lucide-react";

type Track = { id:string; title:string; channel:string; youtubeId:string; bpm?:number; musicalKey?:string; notes:string; tags:string[]; duration:string; color:string; favorite?:boolean };
type ChatMessage = { id:string; author:string; initials:string; text:string; time:string; mine?:boolean; track?:Track };
type Project = { id:string; name:string; subtitle:string; members:number; unread:number; color:string };

const initialTracks: Track[] = [
  { id:"t1", title:"MIDNIGHT RUN", channel:"prod. southside", youtubeId:"5qap5aO4i9A", bpm:140, musicalKey:"F# minor", notes:"Refren nakon drugog dropa. Probati kraći intro.", tags:["dark","trap"], duration:"2:48", color:"violet", favorite:true },
  { id:"t2", title:"NEON HEART", channel:"LUX beats", youtubeId:"jfKfPfyJRdk", bpm:92, musicalKey:"A minor", notes:"Melodični hook, ostaviti više zraka u strofi.", tags:["melodic"], duration:"3:12", color:"rose" },
  { id:"t3", title:"NEMA NAZIVA 03", channel:"niko archive", youtubeId:"DWcJFNfaw9c", notes:"Možda za outro projekta.", tags:["idea"], duration:"2:31", color:"amber" },
];
const projects: Project[] = [
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

function Cover({track, small=false}:{track:Track; small?:boolean}) {
  return <div className={`cover ${track.color} ${small?"small":""}`}><Music2 size={small?15:19}/></div>;
}

function App() {
  const [signedIn,setSignedIn]=useState(()=>!import.meta.env.VITE_API_URL||Boolean(sessionStorage.getItem("ziherzika_token")));
  const [view,setView]=useState<"home"|"projects"|"project"|"search">("home");
  const [projectTab,setProjectTab]=useState<"tracks"|"chat">("tracks");
  const [tracks,setTracks]=useState(()=>initialTracks.map(track=>({...track,notes:localStorage.getItem(`ziherzika_lyrics_${track.id}`)||track.notes})));
  const [messages,setMessages]=useState(starterMessages);
  const [message,setMessage]=useState("");
  const [query,setQuery]=useState("");
  const [newTrack,setNewTrack]=useState(false);
  const [selected,setSelected]=useState<Track|null>(initialTracks[0]);
  const [playing,setPlaying]=useState(false);
  const [progress,setProgress]=useState(0);
  const [duration,setDuration]=useState(()=>secondsFromDuration(initialTracks[0].duration));
  const [profileOpen,setProfileOpen]=useState(false);
  const [toast,setToast]=useState("");
  const [activeProjectId,setActiveProjectId]=useState<string|null>(()=>sessionStorage.getItem("ziherzika_project"));
  const videoRef=useRef<HTMLIFrameElement|null>(null);
  const filtered=useMemo(()=>tracks.filter(t=>`${t.title} ${t.tags.join(" ")} ${t.bpm||""}`.toLowerCase().includes(query.toLowerCase())),[tracks,query]);

  function playerCommand(func:string,args:unknown[]=[]){videoRef.current?.contentWindow?.postMessage(JSON.stringify({event:"command",func,args}),"*")}
  function connectPlayer(){videoRef.current?.contentWindow?.postMessage(JSON.stringify({event:"listening",id:"ziherzika-player"}),"*");playerCommand("getDuration");playerCommand("getCurrentTime")}
  function chooseTrack(track:Track){setSelected(track);setView("home");setProgress(0);setDuration(secondsFromDuration(track.duration));setPlaying(false)}
  function togglePlayback(){if(playing)playerCommand("pauseVideo");else playerCommand("playVideo");setPlaying(value=>!value)}
  function seekTo(value:number){setProgress(value);playerCommand("seekTo",[value,true])}
  function updateLyrics(value:string){if(!selected)return;setSelected({...selected,notes:value});setTracks(items=>items.map(track=>track.id===selected.id?{...track,notes:value}:track));localStorage.setItem(`ziherzika_lyrics_${selected.id}`,value)}

  useEffect(()=>{
    function receivePlayerMessage(event:MessageEvent){
      if(event.origin!=="https://www.youtube.com")return;
      try{const data=typeof event.data==="string"?JSON.parse(event.data):event.data;const info=data?.info;if(typeof info?.currentTime==="number"&&info.currentTime>=0&&info.currentTime<86_400)setProgress(info.currentTime);if(typeof info?.duration==="number"&&info.duration>0&&info.duration<86_400)setDuration(info.duration);if(typeof info?.playerState==="number")setPlaying(info.playerState===1)}catch{/* ignore unrelated player messages */}
    }
    window.addEventListener("message",receivePlayerMessage);
    const timer=window.setInterval(()=>{playerCommand("getCurrentTime");playerCommand("getDuration");playerCommand("getPlayerState")},600);
    return()=>{window.removeEventListener("message",receivePlayerMessage);window.clearInterval(timer)};
  },[]);

  function flash(text:string){setToast(text);window.setTimeout(()=>setToast(""),2200)}
  function openProject(){setView("project");setProjectTab("tracks")}
  function addMessage(){if(!message.trim())return;setMessages(v=>[...v,{id:crypto.randomUUID(),author:"Ti",initials:"BK",text:message.trim(),time:new Date().toLocaleTimeString("hr-HR",{hour:"2-digit",minute:"2-digit"}),mine:true}]);setMessage("")}
  async function saveTrack(form:HTMLFormElement){
    const data=new FormData(form), id=youtubeId(String(data.get("url")));
    if(!id){flash("Unesi ispravan YouTube link");return}
    let title=String(data.get("title")||"").trim(),channel="YouTube";
    if(!title){try{const response=await fetch(`${API_URL}/api/youtube/metadata?url=${encodeURIComponent(String(data.get("url")))}`);if(response.ok){const meta=await response.json() as {title:string;channel:string};title=meta.title;channel=meta.channel}}catch{/* keep fallback */}}
    const track:Track={id:crypto.randomUUID(),title:(title||"Nova traka").toUpperCase(),channel,youtubeId:id,bpm:Number(data.get("bpm"))||undefined,musicalKey:String(data.get("key")||"")||undefined,notes:String(data.get("notes")||""),tags:String(data.get("tags")||"").split(",").map(x=>x.trim()).filter(Boolean),duration:"—",color:"lime"};
    const token=sessionStorage.getItem("ziherzika_token");
    if(token&&activeProjectId){try{const response=await fetch(`${API_URL}/api/projects/${activeProjectId}/tracks`,{method:"POST",headers:{"content-type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({youtubeUrl:data.get("url"),title:track.title,channel:track.channel,bpm:track.bpm,musicalKey:track.musicalKey,notes:track.notes,tags:track.tags})});if(!response.ok)throw new Error()}catch{flash("Spremljeno lokalno; server trenutno nije dostupan")}}
    setTracks(v=>[track,...v]);setSelected(track);setNewTrack(false);flash("Traka je spremljena")
  }

  if(!signedIn)return <AuthScreen onDone={async(token)=>{sessionStorage.setItem("ziherzika_token",token);try{const response=await fetch(`${API_URL}/api/projects`,{headers:{Authorization:`Bearer ${token}`}});const data=await response.json() as {projects?:{id:string}[]};if(data.projects?.[0]){sessionStorage.setItem("ziherzika_project",data.projects[0].id);setActiveProjectId(data.projects[0].id)}}catch{/* project can load later */}setSignedIn(true)}} onDemo={()=>setSignedIn(true)}/>;

  return <div className="stage"><main className="app-shell">
    {view==="home"&&selected&&<>
      <header className="notes-topbar"><button className="track-picker" onClick={()=>setView("search")}><span><p className="eyebrow">TEKST PJESME</p><strong>{selected.title}</strong></span><ChevronRight/></button><button className="icon-btn" onClick={()=>setNewTrack(true)} aria-label="Dodaj traku"><Plus/></button><button className="avatar" onClick={()=>setProfileOpen(true)}>B</button></header>
      <section className="notes-workspace">
        <div className="notes-meta"><div><p>{selected.channel}</p><div className="chips">{selected.bpm&&<span>{selected.bpm} BPM</span>}{selected.musicalKey&&<span>{selected.musicalKey}</span>}{selected.tags.map(tag=><span key={tag}>#{tag}</span>)}</div></div><div className="video-peek"><iframe id="ziherzika-player" ref={videoRef} onLoad={()=>window.setTimeout(connectPlayer,500)} src={`https://www.youtube.com/embed/${selected.youtubeId}?enablejsapi=1&playsinline=1&rel=0&origin=${encodeURIComponent(window.location.origin)}`} title={`${selected.title} video`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen/></div></div>
        <textarea className="lyrics-editor" value={selected.notes} onChange={event=>updateLyrics(event.target.value)} spellCheck placeholder="Počni pisati tekst pjesme…" aria-label="Tekst pjesme"/>
        <div className="autosave-state"><i/> Automatski spremljeno</div>
      </section>
    </>}
    {view==="projects"&&<>
      <PageHeader title="Projekti" onBack={()=>setView("home")} action={<button className="icon-btn" onClick={()=>flash("Novi projekt — uskoro") }><Plus/></button>}/>
      <p className="page-intro">Folderi u kojima trake i razgovor žive zajedno.</p>
      <div className="project-grid">{projects.map(p=><button className="project-tile" key={p.id} onClick={openProject}><div className={`folder-art ${p.color}`}><Folder/></div><h3>{p.name}</h3><p>{p.subtitle}</p><span>{p.unread?`${p.unread} novih poruka`:"Sve pročitano"}</span></button>)}</div>
    </>}
    {view==="project"&&<>
      <PageHeader title="Ljetni EP" onBack={()=>setView("home")} action={<button className="icon-btn"><Users/></button>}/>
      <div className="project-summary"><div className="folder-art orchid"><Folder/></div><div><strong>3 člana</strong><span>Privatni projekt</span></div><button onClick={()=>flash("Pozivni link je kopiran")}>Pozovi</button></div>
      <div className="tabs"><button className={projectTab==="tracks"?"active":""} onClick={()=>setProjectTab("tracks")}>Trake <b>{tracks.length}</b></button><button className={projectTab==="chat"?"active":""} onClick={()=>setProjectTab("chat")}>Chat <b>12</b></button></div>
      {projectTab==="tracks"?<TrackList title="Sve trake" tracks={tracks} onSelect={chooseTrack}/>:<section className="chat"><div className="messages">{messages.map(m=><article className={m.mine?"message mine":"message"} key={m.id}>{!m.mine&&<i>{m.initials}</i>}<div><small>{m.author} · {m.time}</small><p>{m.text}</p></div></article>)}</div><form className="composer" onSubmit={e=>{e.preventDefault();addMessage()}}><button type="button"><Plus/></button><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Napiši poruku…"/><button className="send"><Send/></button></form></section>}
    </>}
    {view==="search"&&<><PageHeader title="Odaberi traku" onBack={()=>setView("home")} action={<button className="icon-btn" onClick={()=>setNewTrack(true)}><Plus/></button>}/><label className="search-input"><Search/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Naslov, tag, BPM…"/>{query&&<button onClick={()=>setQuery("")}><X/></button>}</label><TrackList title={query?`${filtered.length} rezultata`:"Sve trake"} tracks={filtered} onSelect={chooseTrack}/></>}
    {view!=="home"&&<button className="fab" onClick={()=>setNewTrack(true)} aria-label="Dodaj traku"><Plus/></button>}
    {selected&&<div className="mini-player"><button className="mini-main" onClick={()=>setView("home")}><Cover track={selected} small/><span><strong>{selected.title}</strong><small>{timeLabel(progress)} / {timeLabel(duration)}</small></span></button><button className="play-toggle" onClick={togglePlayback} aria-label={playing?"Pauziraj":"Pokreni"}>{playing?<Pause fill="currentColor"/>:<Play fill="currentColor"/>}</button><label className="player-progress" aria-label="Premotavanje"><input type="range" min="0" max={Math.max(duration,1)} step="0.1" value={Math.min(progress,Math.max(duration,1))} onChange={event=>seekTo(Number(event.target.value))}/></label></div>}
    <nav className="bottom-nav"><NavButton active={view==="home"} icon={<Home/>} label="Početna" onClick={()=>setView("home")}/><NavButton active={view==="projects"||view==="project"} icon={<Folder/>} label="Projekti" onClick={()=>setView("projects")}/><NavButton active={view==="search"} icon={<Search/>} label="Pretraži" onClick={()=>setView("search")}/></nav>
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

function AuthScreen({onDone,onDemo}:{onDone:(token:string)=>void;onDemo:()=>void}){
  const [mode,setMode]=useState<"login"|"register">("login"),[error,setError]=useState(""),[loading,setLoading]=useState(false);
  async function submit(form:HTMLFormElement){setLoading(true);setError("");const data=new FormData(form);try{const response=await fetch(`${API_URL}/api/auth/${mode}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:data.get("email"),password:data.get("password"),displayName:data.get("name")})});const body=await response.json() as {token?:string;error?:string};if(!response.ok||!body.token)throw new Error(body.error||"Prijava nije uspjela.");onDone(body.token)}catch(e){setError(e instanceof Error?e.message:"Pokušaj ponovno.")}finally{setLoading(false)}}
  return <main className="auth-screen"><div className="brand-mark"><Music2/></div><p className="eyebrow">ZIHERZIKA · TVOJ GLAZBENI WORKSPACE</p><h1>Sve trake.<br/>Jedna ekipa.</h1><p className="auth-copy">Spremi beatove, zapiši ideje i dovrši pjesme s ljudima s kojima stvaraš.</p><form onSubmit={e=>{e.preventDefault();void submit(e.currentTarget)}}>{mode==="register"&&<label>Ime<input name="name" required minLength={2} placeholder="Kako da te zovemo?"/></label>}<label>Email<input name="email" type="email" required placeholder="ti@email.com"/></label><label>Lozinka<input name="password" type="password" required minLength={8} placeholder="Najmanje 8 znakova"/></label>{error&&<p className="auth-error">{error}</p>}<button className="primary" disabled={loading}>{loading?"Samo malo…":mode==="login"?"Prijavi se":"Napravi račun"}</button></form><button className="auth-switch" onClick={()=>setMode(mode==="login"?"register":"login")}>{mode==="login"?"Nemaš račun? Registriraj se":"Već imaš račun? Prijavi se"}</button><button className="demo-link" onClick={onDemo}>Istraži demo bez prijave →</button></main>
}

export default App;
