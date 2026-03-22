import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

/* global PIXI */
// PixiJS는 index.html에서 CDN으로 로드됨 (window.PIXI)

/* ══════════════ I18N ══════════════ */
const LANGS = {
  en: { code:'en', flag:'🇺🇸', label:'English', nickname:'Nickname', nickname_ph:'Enter your name', team:'Choose Team', red:'Red', blue:'Blue', green:'Green', start:'Play →', settings:'Settings', language:'Language', save:'Save', reload:'RELOAD', reconnecting:'🔄 Reconnecting', ping:'ping', move_hint:'Move', shoot_hint:'Hold 🖱 to Shoot', joystick_move:'MOVE', joystick_shoot:'SHOOT', chat_ph:'Press Enter to chat', chat_send:'Send', join_msg:n=>`🎮 ${n} joined`, leave_msg:n=>`👋 ${n} left`, elim_msg:(a,b)=>`💥 ${a} → ${b}`, team_names:{red:'Red',blue:'Blue',green:'Green'}, leaderboard_title:'🏆 Ranking', tiles_unit:n=>`${n} tiles` },
  ko: { code:'ko', flag:'🇰🇷', label:'한국어', nickname:'닉네임', nickname_ph:'이름을 입력하세요', team:'팀 선택', red:'레드', blue:'블루', green:'그린', start:'게임 시작 →', settings:'설정', language:'언어', save:'저장', reload:'장전 중', reconnecting:'🔄 재연결 중', ping:'ping', move_hint:'이동', shoot_hint:'🖱 꾹 누르면 발사', joystick_move:'이동', joystick_shoot:'발사', chat_ph:'Enter로 채팅', chat_send:'전송', join_msg:n=>`🎮 ${n} 입장`, leave_msg:n=>`👋 ${n} 퇴장`, elim_msg:(a,b)=>`💥 ${a} → ${b}`, team_names:{red:'레드팀',blue:'블루팀',green:'그린팀'}, leaderboard_title:'🏆 순위', tiles_unit:n=>`${n}칸` },
  ja: { code:'ja', flag:'🇯🇵', label:'日本語', nickname:'ニックネーム', nickname_ph:'名前を入力', team:'チーム選択', red:'レッド', blue:'ブルー', green:'グリーン', start:'プレイ →', settings:'設定', language:'言語', save:'保存', reload:'リロード', reconnecting:'🔄 再接続中', ping:'ping', move_hint:'移動', shoot_hint:'🖱 長押しで射撃', joystick_move:'移動', joystick_shoot:'射撃', chat_ph:'Enterでチャット', chat_send:'送信', join_msg:n=>`🎮 ${n} 参加`, leave_msg:n=>`👋 ${n} 退出`, elim_msg:(a,b)=>`💥 ${a} → ${b}`, team_names:{red:'レッド',blue:'ブルー',green:'グリーン'}, leaderboard_title:'🏆 ランキング', tiles_unit:n=>`${n}マス` },
  zh: { code:'zh', flag:'🇨🇳', label:'中文', nickname:'昵称', nickname_ph:'输入你的名字', team:'选择队伍', red:'红队', blue:'蓝队', green:'绿队', start:'开始游戏 →', settings:'设置', language:'语言', save:'保存', reload:'装弹中', reconnecting:'🔄 重新连接', ping:'延迟', move_hint:'移动', shoot_hint:'🖱 长按射击', joystick_move:'移动', joystick_shoot:'射击', chat_ph:'按Enter聊天', chat_send:'发送', join_msg:n=>`🎮 ${n} 加入`, leave_msg:n=>`👋 ${n} 离开`, elim_msg:(a,b)=>`💥 ${a} → ${b}`, team_names:{red:'红队',blue:'蓝队',green:'绿队'}, leaderboard_title:'🏆 排行榜', tiles_unit:n=>`${n}格` },
};

/* ══════════════ CONSTANTS ══════════════ */
const SERVER_URL = window.location.origin;
const TILE_SIZE=40, TILE_RADIUS=8, GRID_W=40, GRID_H=30;
const MOVE_SPEED=3, SHOOT_INTERVAL=1000, BULLET_SPEED=12, PLAYER_RADIUS=14, BULLET_RADIUS=7;
const BULLET_LIFETIME=1000, BULLET_FADE_START=750, REBUILD_THRESHOLD=80;
const TEAM_COLORS={red:0xFF5C5C,blue:0x5C9EFF,green:0x5CDB95};
const TEAM_CSS   ={red:'#FF5C5C',blue:'#5C9EFF',green:'#5CDB95'};
function lerp(a,b,t){return a+(b-a)*t;}
function isMobile(){return('ontouchstart'in window||navigator.maxTouchPoints>0)&&!/Windows|Macintosh|Linux(?!.*Android)/i.test(navigator.userAgent);}

/* ══════════════ SETTINGS MODAL ══════════════ */
function SettingsModal({lang,onSave,onClose}){
  const t=LANGS[lang]; const[draft,setDraft]=useState(lang);
  return(
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title">⚙️ {t.settings}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div>
          <div className="lobby-label">{t.language}</div>
          <div className="lang-grid">
            {Object.values(LANGS).map(l=>(
              <button key={l.code} className={`lang-btn ${draft===l.code?'active':''}`} onClick={()=>setDraft(l.code)}>
                <span style={{fontSize:'1.1rem'}}>{l.flag}</span>{l.label}
              </button>
            ))}
          </div>
        </div>
        <button className="modal-save" onClick={()=>onSave(draft)}>{LANGS[draft].save}</button>
      </div>
    </div>
  );
}

/* ══════════════ LOBBY ══════════════ */
function Lobby({onJoin,lang,setLang}){
  const t=LANGS[lang];
  const[name,setName]=useState('');
  const[team,setTeam]=useState('blue');
  const[showSettings,setShowSettings]=useState(false);
  const teamDefs=[{id:'red',label:t.red,color:TEAM_CSS.red},{id:'blue',label:t.blue,color:TEAM_CSS.blue},{id:'green',label:t.green,color:TEAM_CSS.green}];
  const go=()=>onJoin(name.trim()||'Player',team);
  const Logo=()=>[...'colorize'].map((ch,i)=><span key={i} style={{color:[TEAM_CSS.red,TEAM_CSS.blue,TEAM_CSS.green][i%3]}}>{ch}</span>);
  const Teams=()=>teamDefs.map(tm=>(
    <button key={tm.id} className={`team-btn ${team===tm.id?`active-${tm.id}`:''}`} onClick={()=>setTeam(tm.id)}>
      <div className="team-dot" style={{background:tm.color}}/>{tm.label}
    </button>
  ));
  return(
    <div className="lobby">
      <button className="lobby-settings-btn" onClick={()=>setShowSettings(true)}>⚙️</button>
      <div className="lobby-inner">
        {/* 데스크탑 */}
        <div className="lobby-logo"><div className="logo-circle"/><div className="logo-text"><Logo/><span style={{color:'#999',fontSize:'0.62em'}}>.</span><span style={{color:'#999',fontSize:'0.62em',fontWeight:700}}>io</span></div></div>
        <div className="lobby-card">
          <div><div className="lobby-label">{t.nickname}</div><input className="lobby-input" placeholder={t.nickname_ph} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()} maxLength={16}/></div>
          <div><div className="lobby-label">{t.team}</div><div className="team-grid"><Teams/></div></div>
          <button className={`lobby-btn ${team}`} onClick={go}>{t.start}</button>
        </div>
        {/* 모바일 왼쪽 */}
        <div className="lobby-col-logo"><div className="mob-logo-circle"/><div className="mob-logo-word"><Logo/></div><div className="mob-logo-io">.io</div></div>
        {/* 모바일 중앙 */}
        <div className="lobby-col-nick">
          <div className="lobby-label">{t.nickname}</div>
          <input className="lobby-input" placeholder={t.nickname_ph} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()} maxLength={16}/>
          <button className={`lobby-btn ${team}`} onClick={go}>{t.start}</button>
        </div>
        {/* 모바일 오른쪽 */}
        <div className="lobby-col-team"><div className="lobby-label">{t.team}</div><div className="team-grid"><Teams/></div></div>
      </div>
      {showSettings&&<SettingsModal lang={lang} onSave={l=>{setLang(l);setShowSettings(false);}} onClose={()=>setShowSettings(false)}/>}
    </div>
  );
}

/* ══════════════ JOYSTICK HOOK ══════════════ */
function useJoystick(elRef){
  const vec=useRef({x:0,y:0,active:false});
  useEffect(()=>{
    const el=elRef.current; if(!el) return;
    const base=el.querySelector('.joystick-base');
    const stick=el.querySelector('.joystick-stick');
    const R=33; let tid=null;
    const center=()=>{const r=base.getBoundingClientRect();return{cx:r.left+r.width/2,cy:r.top+r.height/2};};
    const move=(rx,ry)=>{const d=Math.hypot(rx,ry);const k=d>R?R/d:1;const sx=rx*k,sy=ry*k;stick.style.transform=`translate(calc(-50% + ${sx}px),calc(-50% + ${sy}px))`;vec.current={x:sx/R,y:sy/R,active:d>6};};
    const reset=()=>{stick.style.transform='translate(-50%,-50%)';vec.current={x:0,y:0,active:false};tid=null;};
    const onStart=e=>{if(tid!==null)return;const t=e.changedTouches[0];tid=t.identifier;const{cx,cy}=center();move(t.clientX-cx,t.clientY-cy);e.preventDefault();};
    const onMove=e=>{if(tid===null)return;const t=[...e.changedTouches].find(t=>t.identifier===tid);if(!t)return;const{cx,cy}=center();move(t.clientX-cx,t.clientY-cy);e.preventDefault();};
    const onEnd=e=>{if([...e.changedTouches].some(t=>t.identifier===tid))reset();};
    el.addEventListener('touchstart',onStart,{passive:false});
    el.addEventListener('touchmove', onMove, {passive:false});
    el.addEventListener('touchend',  onEnd,  {passive:false});
    el.addEventListener('touchcancel',onEnd, {passive:false});
    return()=>{el.removeEventListener('touchstart',onStart);el.removeEventListener('touchmove',onMove);el.removeEventListener('touchend',onEnd);el.removeEventListener('touchcancel',onEnd);};
  },[]);
  return vec;
}

/* ══════════════ CHAT BOX ══════════════ */
function ChatBox({lang,msgs,input,setInput,onSend}){
  const t=LANGS[lang];
  const ref=useRef(null);
  useEffect(()=>{if(ref.current)ref.current.scrollTop=ref.current.scrollHeight;},[msgs]);
  return(
    <div className="chat-wrap">
      <div className="chat-messages" ref={ref}>
        {msgs.map(m=><div key={m.id} className="chat-msg"><span className="chat-name" style={{color:m.color}}>{m.name}</span>{m.text}</div>)}
      </div>
      <div className="chat-input-row">
        <input className="chat-input" placeholder={t.chat_ph} value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'){e.stopPropagation();onSend();}}} maxLength={80}/>
        <button className="chat-send" onClick={onSend}>{t.chat_send}</button>
      </div>
    </div>
  );
}

/* ══════════════ GAME ══════════════ */
function Game({playerName,playerTeam,lang,setLang,socketRef,chatMsgs,setChatMsgs,chatInput,setChatInput}){
  const t=LANGS[lang]; const mobile=isMobile();
  const containerRef=useRef(null);
  const leftJoyRef=useRef(null); const rightJoyRef=useRef(null);
  const moveVec=useJoystick(leftJoyRef); const shootVec=useJoystick(rightJoyRef);

  const state=useRef({players:{},bullets:{},tiles:[],myId:null,keys:{},mousePos:{x:0,y:0},mouseDown:false,lastShot:0,camX:0,camY:0});
  const tileGfxRef=useRef(null);
  const playerGfxMap=useRef({}); // id → {c, sprite, txt, color, isMe}
  const bulletGfxMap=useRef({}); // id → Sprite
  const texCache=useRef({});
  const dirtyCount=useRef(0); const rebuildFlag=useRef(false);
  const langRef=useRef(lang);
  useEffect(()=>{langRef.current=lang;},[lang]);

  const[scores,setScores]=useState({red:0,blue:0,green:0});
  const[playerCount,setPlayerCount]=useState(0);
  const[ping,setPing]=useState(0);
  const[killFeed,setKillFeed]=useState([]);
  const[showSettings,setShowSettings]=useState(false);
  const[leaderboard,setLeaderboard]=useState([]);

  // 리로드바 DOM 직접 조작 (React state 없이 → 60fps 완전 부드럽게)
  const reloadFillRef  = useRef(null); // .reload-bar-fill 엘리먼트
  const reloadLabelRef = useRef(null); // .reload-bar-label 엘리먼트

  // 채팅 말풍선: { [playerId]: { container, text, timer } }
  const chatBubbles = useRef({});
  const killTimers=useRef([]);

  function addFeed(msg){
    const id=Date.now()+Math.random();
    setKillFeed(f=>[...f.slice(-4),{id,msg}]);
    const timer=setTimeout(()=>setKillFeed(f=>f.filter(k=>k.id!==id)),3500);
    killTimers.current.push(timer);
  }
  function calcScores(tiles){const s={red:0,blue:0,green:0};tiles.forEach(row=>row.forEach(tm=>{if(tm)s[tm]++;}));setScores(s);}

  /* ── PIXI helpers ── */
  function buildTiles(layer,tiles){
    layer.removeChildren();
    const gfx=new PIXI.Graphics();
    for(let y=0;y<GRID_H;y++) for(let x=0;x<GRID_W;x++){const team=tiles[y]?.[x];gfx.beginFill(team?TEAM_COLORS[team]:0xE8E4DC,team?1:0.6);gfx.drawRoundedRect(x*TILE_SIZE+3,y*TILE_SIZE+3,TILE_SIZE-6,TILE_SIZE-6,TILE_RADIUS);gfx.endFill();}
    layer.addChild(gfx); tileGfxRef.current=gfx; dirtyCount.current=0; rebuildFlag.current=false;
  }
  function patchTile(tx,ty,team){
    const gfx=tileGfxRef.current; if(!gfx)return;
    gfx.beginFill(team?TEAM_COLORS[team]:0xE8E4DC,team?1:0.6);
    gfx.drawRoundedRect(tx*TILE_SIZE+3,ty*TILE_SIZE+3,TILE_SIZE-6,TILE_SIZE-6,TILE_RADIUS);
    gfx.endFill();
    if(++dirtyCount.current>=REBUILD_THRESHOLD)rebuildFlag.current=true;
  }
  function getPlayerTex(app,color,isMe){
    const key=`p_${color}_${isMe}`; if(texCache.current[key])return texCache.current[key];
    const g=new PIXI.Graphics();
    g.beginFill(0,0.09);g.drawCircle(2,4,PLAYER_RADIUS);g.endFill();
    g.beginFill(color);g.drawCircle(0,0,PLAYER_RADIUS);g.endFill();
    g.beginFill(0xFFFFFF,0.24);g.drawCircle(-3,-3,PLAYER_RADIUS*0.4);g.endFill();
    if(isMe){g.lineStyle(2.5,0xFFFFFF,0.8);g.drawCircle(0,0,PLAYER_RADIUS+3);g.lineStyle(0);}
    const tex=app.renderer.generateTexture(g,{resolution:2}); g.destroy(); texCache.current[key]=tex; return tex;
  }
  function getBulletTex(app,color){
    const key=`b_${color}`; if(texCache.current[key])return texCache.current[key];
    const g=new PIXI.Graphics();
    g.beginFill(color,0.25);g.drawCircle(-BULLET_SPEED*1.4,0,BULLET_RADIUS*0.65);g.endFill();
    g.beginFill(color);g.drawCircle(0,0,BULLET_RADIUS);g.endFill();
    g.beginFill(0xFFFFFF,0.5);g.drawCircle(-2,-2,BULLET_RADIUS*0.38);g.endFill();
    const tex=app.renderer.generateTexture(g,{resolution:2}); g.destroy(); texCache.current[key]=tex; return tex;
  }

  // 플레이어 렌더: alive 목록에 없는 것 제거, 있는 것 업데이트
  // 채팅 말풍선 표시 함수 (PIXI)
  function showChatBubble(playerLayer, playerId, text, teamColor) {
    const entry = playerGfxMap.current[playerId];
    if (!entry) return;

    // 기존 말풍선 제거
    removeChatBubble(playerId);

    // 말풍선 컨테이너 생성
    const bubble = new PIXI.Container();

    // 텍스트 (최대 20자 줄임)
    const display = text.length > 20 ? text.slice(0, 19) + '…' : text;
    const txt = new PIXI.Text(display, {
      fontFamily: 'Nunito', fontSize: 12, fontWeight: '700',
      fill: 0x2D2D2D, align: 'center',
    });
    txt.anchor.set(0.5, 0.5);

    // 배경 박스
    const pad = 8;
    const bg = new PIXI.Graphics();
    bg.beginFill(0xFFFFFF, 0.92);
    bg.lineStyle(1.5, teamColor ?? 0x5C9EFF, 0.8);
    bg.drawRoundedRect(
      -txt.width/2 - pad, -txt.height/2 - pad/2,
      txt.width + pad*2, txt.height + pad,
      8
    );
    bg.endFill();

    // 꼬리 삼각형
    bg.beginFill(0xFFFFFF, 0.92);
    const bw = 6;
    bg.moveTo(-bw, txt.height/2 + pad/2);
    bg.lineTo( bw, txt.height/2 + pad/2);
    bg.lineTo(0,   txt.height/2 + pad/2 + 7);
    bg.closePath();
    bg.endFill();

    bubble.addChild(bg, txt);
    // 플레이어 이름 위에 배치
    bubble.y = -(PLAYER_RADIUS + 36);
    entry.c.addChild(bubble);

    // 3초 후 제거
    const timer = setTimeout(() => removeChatBubble(playerId), 3000);
    chatBubbles.current[playerId] = { bubble, timer };
  }

  function removeChatBubble(playerId) {
    const b = chatBubbles.current[playerId];
    if (!b) return;
    clearTimeout(b.timer);
    const entry = playerGfxMap.current[playerId];
    if (entry) entry.c.removeChild(b.bubble);
    b.bubble.destroy({ children: true });
    delete chatBubbles.current[playerId];
  }

  function renderPlayers(app,layer,players,myId,now){
    const alive=new Set(Object.keys(players));
    Object.keys(playerGfxMap.current).forEach(id=>{
      if(!alive.has(id)){const e=playerGfxMap.current[id];if(e.c.parent)e.c.parent.removeChild(e.c);e.c.destroy({children:true});delete playerGfxMap.current[id];}
    });
    Object.entries(players).forEach(([id,p])=>{
      const color=TEAM_COLORS[p.team]??0xAAAAAA; const isMe=id===myId;
      if(!playerGfxMap.current[id]){
        const sp=new PIXI.Sprite(getPlayerTex(app,color,isMe)); sp.anchor.set(0.5);
        const txt=new PIXI.Text(p.name,{fontFamily:'Nunito',fontSize:11,fontWeight:'800',fill:0xFFFFFF,stroke:0x000000,strokeThickness:2,align:'center'});
        txt.anchor.set(0.5,1); txt.y=-(PLAYER_RADIUS+4);
        const c=new PIXI.Container(); c.addChild(sp,txt); layer.addChild(c);
        playerGfxMap.current[id]={c,sprite:sp,txt,color,isMe};
      }
      const e=playerGfxMap.current[id];
      if(e.color!==color||e.isMe!==isMe){e.sprite.texture=getPlayerTex(app,color,isMe);e.color=color;e.isMe=isMe;}
      e.txt.text=p.name; e.c.x=p.x; e.c.y=p.y;
      // 무적 깜빡임: 남은 시간 기준 sin파로 alpha 조절
      const invLeft=p.invincibleUntil?p.invincibleUntil-now:0;
      if(invLeft>0){e.c.alpha=0.45+0.45*Math.abs(Math.sin(now/120));}
      else{e.c.alpha=1;}
    });
  }

  // 총알 렌더
  function renderBullets(app,layer,bullets){
    const alive=new Set(Object.keys(bullets)); const now=Date.now();
    Object.keys(bulletGfxMap.current).forEach(id=>{
      if(!alive.has(id)){const sp=bulletGfxMap.current[id];if(sp.parent)sp.parent.removeChild(sp);sp.destroy();delete bulletGfxMap.current[id];}
    });
    Object.entries(bullets).forEach(([id,b])=>{
      const age=now-b.spawnTime;
      const ratio=age<BULLET_FADE_START?1:Math.max(0,1-(age-BULLET_FADE_START)/(BULLET_LIFETIME-BULLET_FADE_START));
      if(ratio<=0)return;
      const color=TEAM_COLORS[b.team]??0xAAAAAA;
      if(!bulletGfxMap.current[id]){const sp=new PIXI.Sprite(getBulletTex(app,color));sp.anchor.set(0.5);layer.addChild(sp);bulletGfxMap.current[id]=sp;}
      const sp=bulletGfxMap.current[id]; sp.alpha=ratio; sp.x=b.x; sp.y=b.y; sp.rotation=Math.atan2(b.dy,b.dx);
    });
  }

  /* ── MAIN EFFECT ── */
  useEffect(()=>{
    const s=state.current;
    s.tiles=Array.from({length:GRID_H},()=>Array(GRID_W).fill(null));

    const app=new PIXI.Application({resizeTo:containerRef.current,backgroundColor:0xF7F5F0,antialias:true,autoDensity:true});
    containerRef.current.appendChild(app.view);
    const tileLayer=new PIXI.Container(), playerLayer=new PIXI.Container(), bulletLayer=new PIXI.Container();
    app.stage.addChild(tileLayer,playerLayer,bulletLayer);
    buildTiles(tileLayer,s.tiles);

    const socket=io(SERVER_URL,{
      transports:['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current=socket;

    socket.on('connect',()=>{
      socket.emit('join',{name:playerName,team:playerTeam});
    });

    socket.on('disconnect',(reason)=>{
      s.myId=null;
      s.bullets={};
    });

    socket.on('connect_error',(err)=>{
      console.warn('연결 오류:', err.message);
    });

    // init — 고스트 방지: GFX 전체 교체
    socket.on('init',({id,tiles,players,invincibleMs})=>{
      s.myId=id;
      if(tiles)s.tiles=tiles;
      // 기존 GFX 전부 제거
      Object.keys(playerGfxMap.current).forEach(pid=>{
        const e=playerGfxMap.current[pid]; if(e.c.parent)e.c.parent.removeChild(e.c); e.c.destroy({children:true}); delete playerGfxMap.current[pid];
      });
      // 총알 GFX도 전부 정리
      Object.keys(bulletGfxMap.current).forEach(bid=>{
        const sp=bulletGfxMap.current[bid]; if(sp.parent)sp.parent.removeChild(sp); sp.destroy(); delete bulletGfxMap.current[bid];
      });
      s.players={}; s.bullets={};
      if(players)Object.entries(players).forEach(([pid,p])=>{s.players[pid]={...p,tx:p.x,ty:p.y};});
      if(s.players[id]&&invincibleMs){s.players[id].invincibleUntil=Date.now()+invincibleMs;}
      buildTiles(tileLayer,s.tiles); calcScores(s.tiles);
      setPlayerCount(Object.keys(s.players).length);
    });

    // player_join — 고스트 방지: 중복 GFX 제거 후 재등록
    socket.on('player_join',p=>{
      if(playerGfxMap.current[p.id]){
        const e=playerGfxMap.current[p.id]; if(e.c.parent)e.c.parent.removeChild(e.c); e.c.destroy({children:true}); delete playerGfxMap.current[p.id];
      }
      s.players[p.id]={...p,tx:p.x,ty:p.y};
      setPlayerCount(Object.keys(s.players).length);
      addFeed(LANGS[langRef.current].join_msg(p.name));
    });

    // player_leave — GFX 명시적 제거
    socket.on('player_leave',({id})=>{
      const name=s.players[id]?.name;
      if(playerGfxMap.current[id]){
        const e=playerGfxMap.current[id]; if(e.c.parent)e.c.parent.removeChild(e.c); e.c.destroy({children:true}); delete playerGfxMap.current[id];
      }
      delete s.players[id];
      setPlayerCount(Object.keys(s.players).length);
      if(name)addFeed(LANGS[langRef.current].leave_msg(name));
    });

    socket.on('player_move',({id,x,y,invincibleUntil})=>{if(s.players[id]){s.players[id].tx=x;s.players[id].ty=y;if(invincibleUntil!==undefined)s.players[id].invincibleUntil=invincibleUntil;}});
    // [FIX] ox/oy = 스폰 원점 저장 → 시간 기반 위치 계산용
    socket.on('bullet_spawn',b=>{s.bullets[b.id]={...b,ox:b.x,oy:b.y,spawnTime:Date.now()};});
    socket.on('bullet_remove',({id})=>{delete s.bullets[id];});
    socket.on('tile_paint',({x,y,team})=>{if(s.tiles[y]){s.tiles[y][x]=team;patchTile(x,y,team);calcScores(s.tiles);}});
    socket.on('tiles_batch',batch=>{batch.forEach(({x,y,team})=>{if(s.tiles[y]){s.tiles[y][x]=team;patchTile(x,y,team);}});calcScores(s.tiles);});
    socket.on('player_eliminated',({killerId,killedId})=>{const kr=s.players[killerId],kd=s.players[killedId];if(kr&&kd)addFeed(LANGS[langRef.current].elim_msg(kr.name,kd.name));});
    socket.on('respawn',({x,y,invincibleMs})=>{const me=s.players[s.myId];if(me){me.x=x;me.y=y;me.tx=x;me.ty=y;if(invincibleMs)me.invincibleUntil=Date.now()+invincibleMs;}});
    // 서버 강제 위치 보정 (텔레포트 감지 시)
    socket.on('force_position',({x,y})=>{const me=s.players[s.myId];if(me){me.x=x;me.y=y;me.tx=x;me.ty=y;}});
    // 개인 순위표
    socket.on('leaderboard',({leaderboard,teamTiles})=>{
      setLeaderboard(leaderboard);
      if(teamTiles) setScores({red:teamTiles.red??0,blue:teamTiles.blue??0,green:teamTiles.green??0});
    });
    socket.on('chat',({id,name,team,text})=>{
      const color=TEAM_CSS[team]??'#999';
      setChatMsgs(msgs=>[...msgs.slice(-49),{id:Date.now()+Math.random(),name,color,text}]);
      // 해당 플레이어 찾아서 말풍선 표시
      // [FIX] id 기반 정확한 매칭 (동명이인 버그 수정)
      const sender=id&&s.players[id]?s.players[id]:Object.values(s.players).find(p=>p.name===name&&p.team===team);
      if(sender){
        const teamHex=TEAM_COLORS[team]??0x5C9EFF;
        showChatBubble(playerLayer,sender.id,text,teamHex);
      }
    });

    let pingT=0;
    const pingIv=setInterval(()=>{pingT=Date.now();socket.emit('ping_c');},2000);
    socket.on('pong_c',()=>setPing(Date.now()-pingT));

    const onKD=e=>{
      // 채팅 입력창 포커스 중엔 게임 키 이벤트 무시
      if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
      s.keys[e.code]=true;
      if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
    };
    const onKU=e=>{
      if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
      s.keys[e.code]=false;
    };
    window.addEventListener('keydown',onKD); window.addEventListener('keyup',onKU);

    const cv=app.view;
    // [FIX] mousePos를 논리픽셀(CSS픽셀) 기준으로 저장
const onMM=e=>{const r=cv.getBoundingClientRect();s.mousePos={x:(e.clientX-r.left)*app.screen.width/r.width,y:(e.clientY-r.top)*app.screen.height/r.height};};
    // [FIX] mousedown 시점에 즉시 발사 시도 (ticker 타이밍 miss 방지)
    const onMD=()=>{
      s.mouseDown=true;
      // 마우스를 빠르게 클릭할 때 ticker가 놓치는 경우 대비 → 즉시 발사 시도
      const me=s.players[s.myId]; if(!me) return;
      const now=Date.now();
      const elapsed=s.lastShot>0?now-s.lastShot:SHOOT_INTERVAL;
      if(elapsed<SHOOT_INTERVAL) return; // 쿨다운 중이면 무시
      const mwx=s.mousePos.x+s.camX, mwy=s.mousePos.y+s.camY;
      const len=Math.hypot(mwx-me.x,mwy-me.y)||1;
      const sdx=((mwx-me.x)/len)*BULLET_SPEED;
      const sdy=((mwy-me.y)/len)*BULLET_SPEED;
      s.lastShot=now;
      socket.emit('move',{x:me.x,y:me.y});
      socket.emit('shoot',{dx:sdx,dy:sdy});
    };
    const onMU=()=>{s.mouseDown=false;};
    cv.addEventListener('mousemove',onMM); cv.addEventListener('mousedown',onMD);
    window.addEventListener('mouseup',onMU);

    app.ticker.add(()=>{
      const now=Date.now(); const me=s.players[s.myId];
      // 소켓 연결 끊긴 동안엔 서버 emit 전부 중단
      const connected=socket.connected&&s.myId;
      if(me){
        let dx=0,dy=0;
        if(!mobile){if(s.keys['KeyW']||s.keys['ArrowUp'])dy-=MOVE_SPEED;if(s.keys['KeyS']||s.keys['ArrowDown'])dy+=MOVE_SPEED;if(s.keys['KeyA']||s.keys['ArrowLeft'])dx-=MOVE_SPEED;if(s.keys['KeyD']||s.keys['ArrowRight'])dx+=MOVE_SPEED;}
        else{const mv=moveVec.current;if(mv.active){dx=mv.x*MOVE_SPEED;dy=mv.y*MOVE_SPEED;}}
        if(dx&&dy){dx*=0.707;dy*=0.707;}
        me.x=Math.max(PLAYER_RADIUS,Math.min(GRID_W*TILE_SIZE-PLAYER_RADIUS,me.x+dx));
        me.y=Math.max(PLAYER_RADIUS,Math.min(GRID_H*TILE_SIZE-PLAYER_RADIUS,me.y+dy));
        me.tx=me.x; me.ty=me.y;
        if(connected&&(dx||dy)){
          socket.emit('move',{x:me.x,y:me.y});
          const tx=Math.floor(me.x/TILE_SIZE),ty=Math.floor(me.y/TILE_SIZE);
          if(s.tiles[ty]?.[tx]!==me.team)socket.emit('paint_tile',{x:tx,y:ty});
        }

        // 장전 진행률 — DOM 직접 조작 (React state 없이 60fps 완전 부드럽게)
        const elapsed=s.lastShot>0?now-s.lastShot:SHOOT_INTERVAL;
        const pct=Math.min(1,elapsed/SHOOT_INTERVAL);
        const ready=pct>=1;
        const invincible=me.invincibleUntil&&now<me.invincibleUntil;
        if(reloadFillRef.current){
          const color=tcRef.current;
          // 연결 끊김 시 회색으로 표시
          if(!connected){
            reloadFillRef.current.style.width='100%';
            reloadFillRef.current.style.background='#CCCCCC';
          } else {
            reloadFillRef.current.style.width=invincible?'100%':`${pct*100}%`;
            reloadFillRef.current.style.background=invincible?'#AAAAAA':ready?color:`${color}88`;
          }
        }
        if(reloadLabelRef.current){
          const invLeft=me.invincibleUntil?Math.ceil((me.invincibleUntil-now)/1000):0;
          reloadLabelRef.current.textContent=!connected?LANGS[langRef.current].reconnecting:invincible?`🛡️ ${invLeft}s`:ready?'🎨':LANGS[langRef.current].reload;
        }

        // 발사 (연결됨 + 장전 완료 + 무적 해제 시에만)
        let shoot=false,sdx=0,sdy=0;
        if(!mobile&&s.mouseDown){const mwx=s.mousePos.x+s.camX,mwy=s.mousePos.y+s.camY;const len=Math.hypot(mwx-me.x,mwy-me.y)||1;sdx=((mwx-me.x)/len)*BULLET_SPEED;sdy=((mwy-me.y)/len)*BULLET_SPEED;shoot=true;}
        else if(mobile){const sv=shootVec.current;if(sv.active){const mag=Math.hypot(sv.x,sv.y);if(mag>0.1){const len=mag||1;sdx=(sv.x/len)*BULLET_SPEED;sdy=(sv.y/len)*BULLET_SPEED;shoot=true;}}}
        if(connected&&shoot&&ready&&!invincible){s.lastShot=now;socket.emit('move',{x:me.x,y:me.y});socket.emit('shoot',{dx:sdx,dy:sdy});}

        s.camX=lerp(s.camX,me.x-app.screen.width/2,0.1);
        s.camY=lerp(s.camY,me.y-app.screen.height/2,0.1);
      }

      s.camX=Math.max(0,Math.min(GRID_W*TILE_SIZE-app.screen.width,s.camX));
      s.camY=Math.max(0,Math.min(GRID_H*TILE_SIZE-app.screen.height,s.camY));
      tileLayer.x=playerLayer.x=bulletLayer.x=-s.camX;
      tileLayer.y=playerLayer.y=bulletLayer.y=-s.camY;

      Object.entries(s.players).forEach(([id,p])=>{if(id!==s.myId){p.x=lerp(p.x??p.tx,p.tx,0.18);p.y=lerp(p.y??p.ty,p.ty,0.18);}});
      // [FIX] 총알 위치를 spawnTime 기준 경과 시간으로 직접 계산
      // 서버도 동일하게 30fps tick마다 dx/dy 누적 → 클라는 시간 기반으로 맞춤
      // 서버 tick: 1000/30 ≈ 33.3ms마다 dx 한 번 → 초당 30번 이동
      // 총알 위치 = spawn위치 + dx * (경과ms / (1000/30))
      const SERVER_TICK = 1000 / 30;
      Object.entries(s.bullets).forEach(([id,b])=>{
        const age=b.spawnTime?Date.now()-b.spawnTime:0;
        const ticks=age/SERVER_TICK;
        b.x=b.ox+b.dx*ticks;
        b.y=b.oy+b.dy*ticks;
        if(age>=BULLET_LIFETIME||b.x<-TILE_SIZE||b.x>(GRID_W+1)*TILE_SIZE||b.y<-TILE_SIZE||b.y>(GRID_H+1)*TILE_SIZE)delete s.bullets[id];
      });
      if(rebuildFlag.current)buildTiles(tileLayer,s.tiles);
      renderPlayers(app,playerLayer,s.players,s.myId,now);
      renderBullets(app,bulletLayer,s.bullets);
    });

    cv.addEventListener('webglcontextlost',e=>{e.preventDefault();},false);
    cv.addEventListener('webglcontextrestored',()=>{Object.values(texCache.current).forEach(t=>{try{t.destroy(true);}catch(_){}});texCache.current={};buildTiles(tileLayer,s.tiles);},false);

    return()=>{
      clearInterval(pingIv);
      killTimers.current.forEach(clearTimeout); killTimers.current=[];
      // 말풍선 전부 정리
      Object.keys(chatBubbles.current).forEach(id=>removeChatBubble(id));
      socket.disconnect(); socketRef.current=null;
      window.removeEventListener('keydown',onKD); window.removeEventListener('keyup',onKU); window.removeEventListener('mouseup',onMU);
      cv.removeEventListener('mousemove',onMM); cv.removeEventListener('mousedown',onMD);
      Object.values(texCache.current).forEach(t=>{try{t.destroy(true);}catch(_){}});
      texCache.current={};
      app.destroy(true);
    };
  },[]);

  // 팀 색상 ref (게임루프 클로저에서 접근용)
  const tcRef = useRef(TEAM_CSS[playerTeam] ?? '#999');

  const total=GRID_W*GRID_H;
  const rp=(scores.red/total*100).toFixed(1);
  const bp=(scores.blue/total*100).toFixed(1);
  const gp=(scores.green/total*100).toFixed(1);
  const tc=tcRef.current;

  return(
    <div className="game-wrapper">
      <div className="hud">
        <div className="hud-logo"><div className="hud-logo-circle"/><span style={{color:'#555',fontWeight:900}}>colorize</span><span style={{color:'#999',fontSize:'0.8em'}}>.io</span></div>
        <div className="score-bar"><div className="score-seg" style={{width:`${rp}%`,background:TEAM_CSS.red}}/><div className="score-seg" style={{width:`${bp}%`,background:TEAM_CSS.blue}}/><div className="score-seg" style={{width:`${gp}%`,background:TEAM_CSS.green}}/></div>
        <div className="hud-scores">{['red','blue','green'].map(tm=><div className="hud-score" key={tm}><div className="hud-dot" style={{background:TEAM_CSS[tm]}}/>{scores[tm]}</div>)}</div>
        <div className="hud-right">
          <div className="hud-player"><span>{playerName}</span> · {t.team_names[playerTeam]}</div>
          <div className="player-count">👥 {playerCount}</div>
          <button className="hud-settings-btn" onClick={()=>setShowSettings(true)}>⚙️</button>
        </div>
      </div>

      <div id="pixi-container" ref={containerRef}>
        <div className="kill-feed">{killFeed.map(k=><div key={k.id} className="kill-item">{k.msg}</div>)}</div>

        {/* 개인 순위표 */}
        {leaderboard.length>0&&(
          <div className="leaderboard">
            <div className="leaderboard-title">{t.leaderboard_title}</div>
            {leaderboard.slice(0,8).map((p,i)=>{
              const isMe=socketRef.current&&p.id===socketRef.current.id;
              return(
                <div key={p.id} className="leaderboard-row" style={{position:'relative'}}>
                  {i===0&&(
                    <svg className="leaderboard-crown" viewBox="0 0 24 14" xmlns="http://www.w3.org/2000/svg" style={{position:'absolute',top:'-13px',left:'50%',transform:'translateX(-50%)',width:'18px',height:'11px',filter:'drop-shadow(0 1px 2px rgba(0,0,0,0.18))'}}>
                      <polygon points="2,13 6,4 12,9 18,4 22,13" fill="#FFD700" stroke="#FFA500" strokeWidth="1" strokeLinejoin="round"/>
                      <circle cx="2"  cy="13" r="1.5" fill="#FFD700" stroke="#FFA500" strokeWidth="0.8"/>
                      <circle cx="12" cy="8.5" r="1.5" fill="#FFD700" stroke="#FFA500" strokeWidth="0.8"/>
                      <circle cx="22" cy="13" r="1.5" fill="#FFD700" stroke="#FFA500" strokeWidth="0.8"/>
                    </svg>
                  )}
                  <div className="leaderboard-rank">{['🥇','🥈','🥉'][i]??i+1}</div>
                  <div className="leaderboard-dot" style={{background:TEAM_CSS[p.team]??'#999'}}/>
                  <div className={`leaderboard-name${isMe?' is-me':''}`}>{p.name}</div>
                  <div className="leaderboard-score">{t.tiles_unit(p.tiles)}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* 장전 바 — DOM ref로 직접 조작 */}
        <div className="reload-bar-wrap">
          <div className="reload-bar-label" ref={reloadLabelRef}>🎨</div>
          <div className="reload-bar-track">
            <div className="reload-bar-fill" ref={reloadFillRef} style={{width:'100%',background:tc}}/>
          </div>
        </div>

        <div className="overlay-hud"><div className="ping-badge">{t.ping} {ping}ms</div></div>

        {!mobile&&<div className="controls-hint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {t.move_hint}&nbsp;·&nbsp;{t.shoot_hint}</div>}

        {!mobile&&(
          <ChatBox lang={lang} msgs={chatMsgs} input={chatInput} setInput={setChatInput}
            onSend={()=>{const text=chatInput.trim();if(!text||!socketRef.current)return;socketRef.current.emit('chat',{text});setChatInput('');}}/>
        )}

        {mobile&&(
          <>
            <div className="joystick-area left" ref={leftJoyRef}><div className="joystick-base"><div className="joystick-stick"/></div><div className="joystick-label">{t.joystick_move}</div></div>
            <div className="joystick-area right" ref={rightJoyRef}><div className="joystick-base"><div className="joystick-stick"/></div><div className="joystick-label">{t.joystick_shoot}</div></div>
          </>
        )}
      </div>

      {showSettings&&<SettingsModal lang={lang} onSave={l=>{setLang(l);setShowSettings(false);}} onClose={()=>setShowSettings(false)}/>}
    </div>
  );
}

/* ══════════════ APP ROOT ══════════════ */
function AppRoot(){
  const[lang,setLangState]=useState(()=>localStorage.getItem('cz_lang')||'en');
  const[phase,setPhase]=useState('lobby');
  const[pName,setPName]=useState('');
  const[pTeam,setPTeam]=useState('blue');
  const socketRef=useRef(null);
  const[chatMsgs,setChatMsgs]=useState([]);
  const[chatInput,setChatInput]=useState('');

  function setLang(l){localStorage.setItem('cz_lang',l);setLangState(l);}
  function handleJoin(name,team){setPName(name);setPTeam(team);setPhase('game');}

  return phase==='lobby'
    ?<Lobby onJoin={handleJoin} lang={lang} setLang={setLang}/>
    :<Game playerName={pName} playerTeam={pTeam} lang={lang} setLang={setLang}
        socketRef={socketRef} chatMsgs={chatMsgs} setChatMsgs={setChatMsgs}
        chatInput={chatInput} setChatInput={setChatInput}/>;
}

export default AppRoot;
