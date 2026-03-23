import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

/* global PIXI */
// PixiJS는 index.html에서 CDN으로 로드됨 (window.PIXI)

/* ══════════════ I18N ══════════════ */
const LANGS = {
  en: { code:'en', flag:'🇺🇸', label:'English', nickname:'Nickname', nickname_ph:'Enter your name', team:'Choose Team', red:'Red', blue:'Blue', green:'Green', start:'Play →', settings:'Settings', language:'Language', save:'Save', reload:'RELOAD', reconnecting:'🔄 Reconnecting', ping:'ping', move_hint:'Move', shoot_hint:'Hold 🖱 to Shoot', joystick_move:'MOVE', joystick_shoot:'SHOOT', chat_ph:'Press Enter to chat', chat_send:'Send', join_msg:n=>`🎮 ${n} joined`, leave_msg:n=>`👋 ${n} left`, elim_msg:(a,b)=>`💥 ${a} → ${b}`, team_names:{red:'Red',blue:'Blue',green:'Green'}, leaderboard_title:'🏆 Ranking', tiles_unit:n=>`${n} tiles`, players_unit:n=>`${n}P`, next_round:'Next round in' },
  ko: { code:'ko', flag:'🇰🇷', label:'한국어', nickname:'닉네임', nickname_ph:'이름을 입력하세요', team:'팀 선택', red:'레드', blue:'블루', green:'그린', start:'게임 시작 →', settings:'설정', language:'언어', save:'저장', reload:'장전 중', reconnecting:'🔄 재연결 중', ping:'ping', move_hint:'이동', shoot_hint:'🖱 꾹 누르면 발사', joystick_move:'이동', joystick_shoot:'발사', chat_ph:'Enter로 채팅', chat_send:'전송', join_msg:n=>`🎮 ${n} 입장`, leave_msg:n=>`👋 ${n} 퇴장`, elim_msg:(a,b)=>`💥 ${a} → ${b}`, team_names:{red:'레드팀',blue:'블루팀',green:'그린팀'}, leaderboard_title:'🏆 순위', tiles_unit:n=>`${n}칸`, players_unit:n=>`${n}명`, next_round:'다음 라운드까지' },
  ja: { code:'ja', flag:'🇯🇵', label:'日本語', nickname:'ニックネーム', nickname_ph:'名前を入力', team:'チーム選択', red:'レッド', blue:'ブルー', green:'グリーン', start:'プレイ →', settings:'設定', language:'言語', save:'保存', reload:'リロード', reconnecting:'🔄 再接続中', ping:'ping', move_hint:'移動', shoot_hint:'🖱 長押しで射撃', joystick_move:'移動', joystick_shoot:'射撃', chat_ph:'Enterでチャット', chat_send:'送信', join_msg:n=>`🎮 ${n} 参加`, leave_msg:n=>`👋 ${n} 退出`, elim_msg:(a,b)=>`💥 ${a} → ${b}`, team_names:{red:'レッド',blue:'ブルー',green:'グリーン'}, leaderboard_title:'🏆 ランキング', tiles_unit:n=>`${n}マス`, players_unit:n=>`${n}人`, next_round:'次のラウンドまで' },
  zh: { code:'zh', flag:'🇨🇳', label:'中文', nickname:'昵称', nickname_ph:'输入你的名字', team:'选择队伍', red:'红队', blue:'蓝队', green:'绿队', start:'开始游戏 →', settings:'设置', language:'语言', save:'保存', reload:'装弹中', reconnecting:'🔄 重新连接', ping:'延迟', move_hint:'移动', shoot_hint:'🖱 长按射击', joystick_move:'移动', joystick_shoot:'射击', chat_ph:'按Enter聊天', chat_send:'发送', join_msg:n=>`🎮 ${n} 加入`, leave_msg:n=>`👋 ${n} 离开`, elim_msg:(a,b)=>`💥 ${a} → ${b}`, team_names:{red:'红队',blue:'蓝队',green:'绿队'}, leaderboard_title:'🏆 排行榜', tiles_unit:n=>`${n}格`, players_unit:n=>`${n}人`, next_round:'下一轮' },
};

/* ══════════════ CONSTANTS ══════════════ */
const SERVER_URL = window.location.origin;
const TILE_SIZE=40, TILE_RADIUS=8, GRID_W=80, GRID_H=60;
const MINIMAP_W=200, MINIMAP_H=150;
const MOVE_SPEED=3, SHOOT_INTERVAL=1000, BULLET_SPEED=12, PLAYER_RADIUS=14, BULLET_RADIUS=7;
const BULLET_LIFETIME=1000, BULLET_FADE_START=750;
const TEAM_COLORS={red:0xFF5C5C,blue:0x5C9EFF,green:0x5CDB95};
const TEAM_CSS   ={red:'#FF5C5C',blue:'#5C9EFF',green:'#5CDB95'};
const SERVER_TICK = 1000 / 30;
function lerp(a,b,t){return a+(b-a)*t;}

/* ══════════════ XP 계산 유틸 (모듈 레벨 순수 함수) ══════════════ */
function xpForLevel(lv) { return Math.floor(100 * Math.pow(1.1, lv - 1)); }
function xpAccumulatedToLevel(lv) {
  let acc = 0;
  for (let i = 1; i < lv; i++) acc += xpForLevel(i);
  return acc;
}
// XP 바 계산 캐시 — 레벨이 바뀔 때만 재계산
const _xpBarCache = { lv: 0, needed: 0, accumulated: 0 };
function getXpBarCache(lv) {
  if (_xpBarCache.lv !== lv) {
    _xpBarCache.lv = lv;
    _xpBarCache.needed = xpForLevel(lv);
    _xpBarCache.accumulated = xpAccumulatedToLevel(lv);
  }
  return _xpBarCache;
}

/* ══════════════ UPGRADE SYSTEM ══════════════ */
const UPGRADES = [
  { id:'speed',      icon:'⚡',  label:{en:'Move Speed',      ko:'이동 속도',  ja:'移動速度', zh:'移动速度'}, desc:{en:'Move faster across the map',        ko:'더 빠르게 이동합니다',        ja:'マップ上で速く動く',       zh:'在地图上移动更快'},  maxLv:5, effect:lv=>({moveSpeed:      MOVE_SPEED      *(1+lv*0.12)}) },
  { id:'firerate',   icon:'🔥',  label:{en:'Fire Rate',        ko:'연사 속도',  ja:'連射速度', zh:'射速'},     desc:{en:'Reduce shooting cooldown',           ko:'발사 쿨다운을 줄입니다',      ja:'発射クールダウン短縮',    zh:'缩短射击冷却'},       maxLv:5, effect:lv=>({shootInterval:   SHOOT_INTERVAL  *(1-lv*0.12)}) },
  { id:'bulletspeed',icon:'💨',  label:{en:'Bullet Speed',     ko:'총알 속도',  ja:'弾速',     zh:'弹速'},     desc:{en:'Bullets travel faster',              ko:'총알이 더 빠르게 날아갑니다',ja:'弾がより速く飛ぶ',       zh:'子弹飞行速度更快'},   maxLv:5, effect:lv=>({bulletSpeed:     BULLET_SPEED    *(1+lv*0.15)}) },
  { id:'range',      icon:'🎯',  label:{en:'Range',            ko:'사거리',     ja:'射程',     zh:'射程'},     desc:{en:'Bullets travel further',             ko:'총알이 더 멀리 날아갑니다',  ja:'弾がより遠くまで飛ぶ',   zh:'子弹射程更远'},       maxLv:5, effect:lv=>({bulletLifetime:  BULLET_LIFETIME *(1+lv*0.20)}) },
  { id:'shield',     icon:'🛡️', label:{en:'Respawn Shield',   ko:'리스폰 보호',ja:'復活シールド',zh:'重生护盾'}, desc:{en:'Longer invincibility on respawn', ko:'리스폰 후 무적 시간이 늘어납니다',ja:'復活後の無敵時間延長',zh:'复活后无敌时间更长'}, maxLv:5, effect:lv=>({invincibleMs: 3000+lv*1000}) },
];

function calcStatPoints(level) { return Math.max(0, level - 1); }
function isMobile(){return('ontouchstart'in window||navigator.maxTouchPoints>0)&&!/Windows|Macintosh|Linux(?!.*Android)/i.test(navigator.userAgent);}

/* ══════════════ LOGO ══════════════ */
function Logo(){
  return [... 'daubs'].map((ch,i)=>(
    <span key={i} style={{color:[TEAM_CSS.red,TEAM_CSS.blue,TEAM_CSS.green][i%3]}}>{ch}</span>
  ));
}

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
function Lobby({onJoin,lang,setLang,teamCounts}){
  const t=LANGS[lang];
  const[name,setName]=useState('');
  const[team,setTeam]=useState('blue');
  const[showSettings,setShowSettings]=useState(false);
  const teamDefs=[{id:'red',label:t.red,color:TEAM_CSS.red},{id:'blue',label:t.blue,color:TEAM_CSS.blue},{id:'green',label:t.green,color:TEAM_CSS.green}];
  const go=()=>onJoin(name.trim()||'Player',team);
  const Teams=()=>teamDefs.map(tm=>(
    <button key={tm.id} className={`team-btn ${team===tm.id?`active-${tm.id}`:''}`} onClick={()=>setTeam(tm.id)}>
      <div className="team-dot" style={{background:tm.color}}/>
      <span>{tm.label}</span>
      <span className="team-count">{t.players_unit(teamCounts[tm.id]??0)}</span>
    </button>
  ));
  return(
    <div className="lobby">
      <button className="lobby-settings-btn" onClick={()=>setShowSettings(true)}>⚙️</button>
      <div className="lobby-inner">
        <div className="lobby-logo"><div className="logo-circle"/><div className="logo-text"><Logo/><span style={{color:'#999',fontSize:'0.62em'}}>.</span><span style={{color:'#999',fontSize:'0.62em',fontWeight:700}}>io</span></div></div>
        <div className="lobby-card">
          <div><div className="lobby-label">{t.nickname}</div><input className="lobby-input" placeholder={t.nickname_ph} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()} maxLength={16}/></div>
          <div><div className="lobby-label">{t.team}</div><div className="team-grid"><Teams/></div></div>
          <button className={`lobby-btn ${team}`} onClick={go}>{t.start}</button>
        </div>
        <div className="lobby-col-logo"><div className="mob-logo-circle"/><div className="mob-logo-word"><Logo/></div><div className="mob-logo-io">.io</div></div>
        <div className="lobby-col-nick">
          <div className="lobby-label">{t.nickname}</div>
          <input className="lobby-input" placeholder={t.nickname_ph} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()} maxLength={16}/>
          <button className={`lobby-btn ${team}`} onClick={go}>{t.start}</button>
        </div>
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

/* ══════════════ UPGRADE PANEL ══════════════ */
function UpgradePanel({lang,level,upgrades,onUpgrade,onClose}){
  const totalPoints=calcStatPoints(level);
  const spent=Object.values(upgrades).reduce((a,b)=>a+b,0);
  const available=totalPoints-spent;
  return(
    <div className="upgrade-panel">
      <div className="upgrade-header">
        <div className="upgrade-title">⬆️ {lang==='ko'?'강화':lang==='ja'?'強化':lang==='zh'?'升级':'Skills'}</div>
        {available>0&&<div className="upgrade-points-badge">{available}</div>}
        <button className="upgrade-close" onClick={onClose}>✕</button>
      </div>
      <div className="upgrade-list">
        {UPGRADES.map(up=>{
          const curLv=upgrades[up.id]||0;
          const maxed=curLv>=up.maxLv;
          const canUp=available>0&&!maxed;
          return(
            <div key={up.id} className={`upgrade-row${maxed?' maxed':''}`}>
              <div className="upgrade-icon">{up.icon}</div>
              <div className="upgrade-info">
                <div className="upgrade-name">{up.label[lang]||up.label.en}</div>
                <div className="upgrade-stars">
                  {Array.from({length:up.maxLv}).map((_,i)=>(
                    <div key={i} className={`upgrade-star${i<curLv?' filled':''}`}/>
                  ))}
                </div>
              </div>
              <button className={`upgrade-btn${canUp?' active':''}`} onClick={()=>canUp&&onUpgrade(up.id)} disabled={!canUp}>{maxed?'MAX':'＋'}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════ MINIMAP ══════════════ */
function MiniMap({tilesRef,playersRef,myTeam,myIdRef,expanded,onToggle}){
  const canvasRef=useRef(null);
  const w=expanded?400:MINIMAP_W, h=expanded?300:MINIMAP_H;
  const scaleX=w/GRID_W, scaleY=h/GRID_H;
  useEffect(()=>{
    let raf;
    function draw(){
      const cv=canvasRef.current; if(!cv) return;
      const ctx=cv.getContext('2d');
      const tiles=tilesRef.current;
      const players=playersRef.current;
      ctx.clearRect(0,0,w,h);
      if(tiles&&tiles.length){
        for(let y=0;y<GRID_H;y++) for(let x=0;x<GRID_W;x++){
          const tm=tiles[y]?.[x];
          ctx.fillStyle=tm?TEAM_CSS[tm]:'#E8E4DC';
          ctx.fillRect(x*scaleX,y*scaleY,scaleX,scaleY);
        }
      }
      if(players){
        Object.values(players).forEach(p=>{
          if(p.team!==myTeam) return;
          const isMe=p.id===myIdRef.current;
          const px=p.x/TILE_SIZE*scaleX, py=p.y/TILE_SIZE*scaleY;
          ctx.beginPath();
          ctx.arc(px,py,isMe?3.5:2.5,0,Math.PI*2);
          ctx.fillStyle=isMe?'#fff':TEAM_CSS[myTeam];
          ctx.fill();
          if(isMe){ctx.strokeStyle=TEAM_CSS[myTeam];ctx.lineWidth=1.5;ctx.stroke();}
        });
      }
      raf=requestAnimationFrame(draw);
    }
    draw();
    return()=>cancelAnimationFrame(raf);
  },[tilesRef,playersRef,myTeam,myIdRef,expanded]);
  return(
    <div className={`minimap-wrap${expanded?' expanded':''}`} onClick={onToggle} title="클릭하여 확대/축소">
      <canvas ref={canvasRef} width={w} height={h} className="minimap-canvas"/>
      <div className="minimap-icon">{expanded?'✕':'⊕'}</div>
    </div>
  );
}

/* ══════════════ GAME ══════════════ */
function Game({playerName,playerTeam,lang,setLang,socketRef,chatMsgs,setChatMsgs,chatInput,setChatInput}){
  const t=LANGS[lang]; const mobile=isMobile();
  const containerRef=useRef(null);
  const leftJoyRef=useRef(null); const rightJoyRef=useRef(null);
  const moveVec=useJoystick(leftJoyRef); const shootVec=useJoystick(rightJoyRef);

  const state=useRef({players:{},bullets:{},tiles:[],myId:null,keys:{},mousePos:{x:0,y:0},mouseDown:false,lastShot:0,camX:0,camY:0,justShot:false});

  // ── [FIX-①②] 타일 렌더링: Graphics 누적 방식 전면 폐기 ──
  // tileSpritesRef: PIXI.Sprite[GRID_H][GRID_W] — 한 번 생성 후 texture만 교체
  const tileSpritesRef  = useRef(null);
  // tileTexCacheRef: {null:'null', red, blue, green} → RenderTexture (앱 생애 동안 4개만 존재)
  const tileTexCacheRef = useRef({});

  const playerGfxMap=useRef({});
  const bulletGfxMap=useRef({});
  const texCache=useRef({});

  const langRef=useRef(lang);
  useEffect(()=>{langRef.current=lang;},[lang]);

  const[scores,setScores]=useState({red:0,blue:0,green:0});
  const[playerCount,setPlayerCount]=useState(0);
  const[ping,setPing]=useState(0);
  const[killFeed,setKillFeed]=useState([]);
  const[showSettings,setShowSettings]=useState(false);
  const[leaderboard,setLeaderboard]=useState([]);
  const[minimapExpanded,setMinimapExpanded]=useState(false);

  const[roundPhase,setRoundPhase]=useState('playing');
  const[roundEnd,setRoundEnd]=useState(null);
  const roundEndsAtRef=useRef(Date.now()+600000);

  // ── [FIX-⑥] XP ──
  const[level,setLevel]=useState(1);
  const[xp,setXp]=useState(0);
  const levelRef=useRef(1);
  const xpRef=useRef(0);
  const[levelUpAnim,setLevelUpAnim]=useState(null);

  const[upgrades,setUpgrades]=useState({speed:0,firerate:0,bulletspeed:0,range:0,shield:0});
  const[showUpgradePanel,setShowUpgradePanel]=useState(false);
  const[showMobileUpgrade,setShowMobileUpgrade]=useState(false);
  const upgradesRef=useRef({speed:0,firerate:0,bulletspeed:0,range:0,shield:0});

  function getStats(ups){
    const u=ups||upgradesRef.current;
    return {
      moveSpeed:      MOVE_SPEED      *(1+(u.speed||0)      *0.12),
      shootInterval:  SHOOT_INTERVAL  *(1-(u.firerate||0)   *0.12),
      bulletSpeed:    BULLET_SPEED    *(1+(u.bulletspeed||0)*0.15),
      bulletLifetime: BULLET_LIFETIME *(1+(u.range||0)      *0.20),
      invincibleMs:   3000            +(u.shield||0)         *1000,
    };
  }

  const timerRef=useRef(null);
  const minimapTilesRef=useRef([]);
  const minimapPlayersRef=useRef({});
  const myIdRef=useRef(null);
  const reloadFillRef=useRef(null);
  const reloadLabelRef=useRef(null);
  const xpFillRef=useRef(null);
  const xpTextRef=useRef(null);
  const topPlayerIdRef=useRef(null);
  const tcRef=useRef(TEAM_CSS[playerTeam]??'#999');
  const chatBubbles=useRef({});
  const killTimers=useRef([]);

  function addFeed(msg){
    const id=Date.now()+Math.random();
    setKillFeed(f=>[...f.slice(-4),{id,msg}]);
    const timer=setTimeout(()=>setKillFeed(f=>f.filter(k=>k.id!==id)),3500);
    killTimers.current.push(timer);
  }
  function calcScores(tiles){
    const s={red:0,blue:0,green:0};
    tiles.forEach(row=>row.forEach(tm=>{if(tm)s[tm]++;}));
    setScores(s);
  }

  /* ── [FIX-⑥] XP 바 DOM 업데이트: 이벤트 수신 시에만 호출 ── */
  function updateXpBar(curXp, curLv){
    if(!xpFillRef.current&&!xpTextRef.current) return;
    const cache=getXpBarCache(curLv);
    const xpInLevel=Math.max(0,curXp-cache.accumulated);
    const pct=cache.needed>0?Math.min(100,xpInLevel/cache.needed*100):100;
    if(xpFillRef.current) xpFillRef.current.style.width=`${pct.toFixed(1)}%`;
    if(xpTextRef.current) xpTextRef.current.textContent=`${xpInLevel}/${cache.needed}`;
  }

  /* ── [FIX-①②] 타일 텍스처: 4종만 생성 ── */
  function buildTileTextures(app){
    const teams=[null,'red','blue','green'];
    teams.forEach(team=>{
      const key=team??'null';
      if(tileTexCacheRef.current[key]) return;
      const g=new PIXI.Graphics();
      g.beginFill(team?TEAM_COLORS[team]:0xE8E4DC,1);
      g.drawRoundedRect(3,3,TILE_SIZE-6,TILE_SIZE-6,TILE_RADIUS);
      g.endFill();
      const tex=app.renderer.generateTexture(g,{resolution:1});
      g.destroy();
      tileTexCacheRef.current[key]=tex;
    });
  }

  /* ── [FIX-①②] 타일 Sprite 배열 초기화 ── */
  function initTileSprites(app,layer,tiles){
    buildTileTextures(app);
    layer.removeChildren();
    const grid=[];
    for(let y=0;y<GRID_H;y++){
      const row=[];
      for(let x=0;x<GRID_W;x++){
        const team=tiles[y]?.[x];
        const sp=new PIXI.Sprite(tileTexCacheRef.current[team??'null']);
        sp.x=x*TILE_SIZE; sp.y=y*TILE_SIZE;
        layer.addChild(sp);
        row.push(sp);
      }
      grid.push(row);
    }
    tileSpritesRef.current=grid;
  }

  /* ── [FIX-①②] 단일 타일 갱신: texture 교체만 ── */
  function updateTileSprite(tx,ty,team){
    const grid=tileSpritesRef.current;
    if(!grid||!grid[ty]||!grid[ty][tx]) return;
    const tex=tileTexCacheRef.current[team??'null'];
    if(tex) grid[ty][tx].texture=tex;
  }

  /* ── 텍스처 캐시 헬퍼 ── */
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
  function getCrownTex(app){
    const key='crown'; if(texCache.current[key])return texCache.current[key];
    const g=new PIXI.Graphics();
    g.beginFill(0xFFD700);
    g.moveTo(-9,6);g.lineTo(-9,-2);g.lineTo(-5,2);g.lineTo(0,-5);g.lineTo(5,2);g.lineTo(9,-2);g.lineTo(9,6);g.closePath();g.endFill();
    g.lineStyle(1,0xFFA500,1);
    g.moveTo(-9,6);g.lineTo(-9,-2);g.lineTo(-5,2);g.lineTo(0,-5);g.lineTo(5,2);g.lineTo(9,-2);g.lineTo(9,6);g.closePath();g.lineStyle(0);
    g.beginFill(0xFFA500);g.drawCircle(-9,-2,1.8);g.endFill();
    g.beginFill(0xFFA500);g.drawCircle(0,-5,1.8);g.endFill();
    g.beginFill(0xFFA500);g.drawCircle(9,-2,1.8);g.endFill();
    const tex=app.renderer.generateTexture(g,{resolution:2}); g.destroy();
    texCache.current[key]=tex; return tex;
  }

  /* ── 채팅 말풍선 ── */
  function showChatBubble(playerLayer,playerId,text,teamColor){
    const entry=playerGfxMap.current[playerId]; if(!entry) return;
    removeChatBubble(playerId);
    const bubble=new PIXI.Container();
    const display=text.length>20?text.slice(0,19)+'…':text;
    const txt=new PIXI.Text(display,{fontFamily:'Nunito',fontSize:12,fontWeight:'700',fill:0x2D2D2D,align:'center'});
    txt.anchor.set(0.5,0.5);
    const pad=8;
    const bg=new PIXI.Graphics();
    bg.beginFill(0xFFFFFF,0.92);bg.lineStyle(1.5,teamColor??0x5C9EFF,0.8);
    bg.drawRoundedRect(-txt.width/2-pad,-txt.height/2-pad/2,txt.width+pad*2,txt.height+pad,8);bg.endFill();
    bg.beginFill(0xFFFFFF,0.92);
    const bw=6;
    bg.moveTo(-bw,txt.height/2+pad/2);bg.lineTo(bw,txt.height/2+pad/2);bg.lineTo(0,txt.height/2+pad/2+7);bg.closePath();bg.endFill();
    bubble.addChild(bg,txt);
    bubble.y=-(PLAYER_RADIUS+36);
    entry.c.addChild(bubble);
    const timer=setTimeout(()=>removeChatBubble(playerId),3000);
    chatBubbles.current[playerId]={bubble,timer};
  }
  function removeChatBubble(playerId){
    const b=chatBubbles.current[playerId]; if(!b) return;
    clearTimeout(b.timer);
    const entry=playerGfxMap.current[playerId];
    if(entry&&b.bubble.parent) entry.c.removeChild(b.bubble);
    b.bubble.destroy({children:true});
    delete chatBubbles.current[playerId];
  }

  /* ── [FIX-③] 플레이어 렌더: GFX 재사용, 내용만 갱신 ── */
  function renderPlayers(app,layer,players,myId,now){
    const alive=new Set(Object.keys(players));
    const topId=topPlayerIdRef.current;
    Object.keys(playerGfxMap.current).forEach(id=>{
      if(!alive.has(id)){
        const e=playerGfxMap.current[id];
        if(e.c.parent) e.c.parent.removeChild(e.c);
        e.c.destroy({children:true});
        delete playerGfxMap.current[id];
      }
    });
    Object.entries(players).forEach(([id,p])=>{
      const color=TEAM_COLORS[p.team]??0xAAAAAA;
      const isMe=id===myId;
      if(!playerGfxMap.current[id]){
        const sp=new PIXI.Sprite(getPlayerTex(app,color,isMe)); sp.anchor.set(0.5);
        const txt=new PIXI.Text(p.name,{fontFamily:'Nunito',fontSize:11,fontWeight:'800',fill:0xFFFFFF,stroke:0x000000,strokeThickness:2,align:'center'});
        txt.anchor.set(0.5,1); txt.y=-(PLAYER_RADIUS+4);
        const lvTxt=new PIXI.Text('Lv.1',{fontFamily:'Nunito',fontSize:9,fontWeight:'700',fill:0xFFFFFF,stroke:0x000000,strokeThickness:1.5,align:'center'});
        lvTxt.anchor.set(0.5,0); lvTxt.y=PLAYER_RADIUS+3;
        const crown=new PIXI.Sprite(getCrownTex(app)); crown.anchor.set(0.5,1);
        crown.y=-(PLAYER_RADIUS+18); crown.visible=false;
        const c=new PIXI.Container(); c.addChild(sp,txt,lvTxt,crown); layer.addChild(c);
        playerGfxMap.current[id]={c,sprite:sp,txt,lvTxt,crown,color,isMe,cachedName:'',cachedLv:''};
      }
      const e=playerGfxMap.current[id];
      if(e.color!==color||e.isMe!==isMe){e.sprite.texture=getPlayerTex(app,color,isMe);e.color=color;e.isMe=isMe;}
      // [FIX-③] 내용 변경 시에만 text 갱신 (매 프레임 불필요한 재설정 방지)
      if(e.cachedName!==p.name){e.txt.text=p.name;e.cachedName=p.name;}
      const lvStr=`Lv.${p.level||1}`;
      if(e.cachedLv!==lvStr){e.lvTxt.text=lvStr;e.cachedLv=lvStr;}
      e.crown.visible=(id===topId);
      e.c.x=p.x; e.c.y=p.y;
      const invLeft=p.invincibleUntil?p.invincibleUntil-now:0;
      e.c.alpha=invLeft>0?0.45+0.45*Math.abs(Math.sin(now/120)):1;
    });
  }

  /* ── 총알 렌더 ── */
  function renderBullets(app,layer,bullets){
    const alive=new Set(Object.keys(bullets)); const now=Date.now();
    Object.keys(bulletGfxMap.current).forEach(id=>{
      if(!alive.has(id)){const sp=bulletGfxMap.current[id];if(sp.parent)sp.parent.removeChild(sp);sp.destroy();delete bulletGfxMap.current[id];}
    });
    Object.entries(bullets).forEach(([id,b])=>{
      const age=now-b.spawnTime;
      const ratio=age<BULLET_FADE_START?1:Math.max(0,1-(age-BULLET_FADE_START)/(BULLET_LIFETIME-BULLET_FADE_START));
      if(ratio<=0) return;
      const color=TEAM_COLORS[b.team]??0xAAAAAA;
      if(!bulletGfxMap.current[id]){const sp=new PIXI.Sprite(getBulletTex(app,color));sp.anchor.set(0.5);layer.addChild(sp);bulletGfxMap.current[id]=sp;}
      const sp=bulletGfxMap.current[id]; sp.alpha=ratio; sp.x=b.x; sp.y=b.y; sp.rotation=Math.atan2(b.dy,b.dx);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     MAIN EFFECT
  ══════════════════════════════════════════════════════════════ */
  useEffect(()=>{
    const s=state.current;
    s.tiles=Array.from({length:GRID_H},()=>Array(GRID_W).fill(null));

    // [FIX-④] PIXI 앱 — 30fps 고정 (서버 틱과 동기화)
    const app=new PIXI.Application({
      resizeTo:containerRef.current,
      backgroundColor:0xF7F5F0,
      antialias:true,
      autoDensity:true,
    });
    app.ticker.maxFPS=30;
    containerRef.current.appendChild(app.view);

    const tileLayer=new PIXI.Container();
    const playerLayer=new PIXI.Container();
    const bulletLayer=new PIXI.Container();
    app.stage.addChild(tileLayer,playerLayer,bulletLayer);

    // [FIX-①②] 초기 타일 Sprite 배열 구성
    initTileSprites(app,tileLayer,s.tiles);

    // 소켓
    const socket=io(SERVER_URL,{transports:['websocket'],reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:1000,reconnectionDelayMax:5000});
    socketRef.current=socket;

    socket.on('connect',()=>{socket.emit('join',{name:playerName,team:playerTeam});});
    socket.on('disconnect',()=>{s.myId=null;s.bullets={};});
    socket.on('connect_error',err=>console.warn('연결 오류:',err.message));

    socket.on('init',({id,tiles:rawTiles,tilesPacked,players,invincibleMs,round,xp:initXp,level:initLevel})=>{
      s.myId=id; myIdRef.current=id;
      if(tilesPacked){
        const t=Array.from({length:GRID_H},()=>Array(GRID_W).fill(null));
        tilesPacked.forEach(({x,y,team})=>{if(t[y])t[y][x]=team;});
        s.tiles=t;
      } else if(rawTiles){ s.tiles=rawTiles; }
      minimapTilesRef.current=s.tiles;
      if(round){roundEndsAtRef.current=round.endsAt;setRoundPhase(round.phase);}
      if(initXp!=null){
        setXp(initXp);setLevel(initLevel??1);
        xpRef.current=initXp;levelRef.current=initLevel??1;
        updateXpBar(initXp,initLevel??1);
      }
      const emptyUps={speed:0,firerate:0,bulletspeed:0,range:0,shield:0};
      setUpgrades(emptyUps);upgradesRef.current=emptyUps;setShowUpgradePanel(false);
      Object.keys(playerGfxMap.current).forEach(pid=>{
        const e=playerGfxMap.current[pid];
        if(e.c.parent)e.c.parent.removeChild(e.c);e.c.destroy({children:true});delete playerGfxMap.current[pid];
      });
      Object.keys(bulletGfxMap.current).forEach(bid=>{
        const sp=bulletGfxMap.current[bid];if(sp.parent)sp.parent.removeChild(sp);sp.destroy();delete bulletGfxMap.current[bid];
      });
      s.players={};s.bullets={};
      if(players)Object.entries(players).forEach(([pid,p])=>{s.players[pid]={...p,tx:p.x,ty:p.y};});
      if(s.players[id]&&invincibleMs)s.players[id].invincibleUntil=Date.now()+invincibleMs;
      minimapPlayersRef.current=s.players;
      initTileSprites(app,tileLayer,s.tiles);
      calcScores(s.tiles);
      setPlayerCount(Object.keys(s.players).length);
    });

    socket.on('player_join',p=>{
      if(playerGfxMap.current[p.id]){
        const e=playerGfxMap.current[p.id];if(e.c.parent)e.c.parent.removeChild(e.c);e.c.destroy({children:true});delete playerGfxMap.current[p.id];
      }
      s.players[p.id]={...p,tx:p.x,ty:p.y};
      minimapPlayersRef.current=s.players;
      setPlayerCount(Object.keys(s.players).length);
      addFeed(LANGS[langRef.current].join_msg(p.name));
    });

    socket.on('player_leave',({id})=>{
      if(playerGfxMap.current[id]){
        const e=playerGfxMap.current[id];if(e.c.parent)e.c.parent.removeChild(e.c);e.c.destroy({children:true});delete playerGfxMap.current[id];
      }
      removeChatBubble(id);
      const leavingName=s.players[id]?.name;
      delete s.players[id];
      minimapPlayersRef.current=s.players;
      setPlayerCount(Object.keys(s.players).length);
      if(leavingName) addFeed(LANGS[langRef.current].leave_msg(leavingName));
    });

    socket.on('player_move',({id,x,y,invincibleUntil})=>{
      if(s.players[id]){
        s.players[id].tx=x;s.players[id].ty=y;
        if(invincibleUntil!==undefined)s.players[id].invincibleUntil=invincibleUntil;
        minimapPlayersRef.current=s.players;
      }
    });

    socket.on('bullet_spawn',b=>{s.bullets[b.id]={...b,ox:b.x,oy:b.y,spawnTime:Date.now()};});
    socket.on('bullet_remove',({id})=>{delete s.bullets[id];});

    // [FIX-①②] tile 수신: Sprite.texture 교체만
    socket.on('tile_paint',({x,y,team})=>{
      if(s.tiles[y]){s.tiles[y][x]=team;minimapTilesRef.current=s.tiles;updateTileSprite(x,y,team);calcScores(s.tiles);}
    });
    socket.on('tiles_batch',batch=>{
      batch.forEach(({x,y,team})=>{if(s.tiles[y]){s.tiles[y][x]=team;updateTileSprite(x,y,team);}});
      minimapTilesRef.current=s.tiles;calcScores(s.tiles);
    });

    socket.on('player_eliminated',({killerId,killedId})=>{
      const kr=s.players[killerId],kd=s.players[killedId];
      if(kr&&kd)addFeed(LANGS[langRef.current].elim_msg(kr.name,kd.name));
    });
    socket.on('respawn',({x,y,invincibleMs})=>{
      const me=s.players[s.myId];
      if(me){me.x=x;me.y=y;me.tx=x;me.ty=y;if(invincibleMs)me.invincibleUntil=Date.now()+invincibleMs;}
    });
    socket.on('force_position',({x,y})=>{
      const me=s.players[s.myId];if(me){me.x=x;me.y=y;me.tx=x;me.ty=y;}
    });

    socket.on('leaderboard',({leaderboard,teamTiles,round:rd})=>{
      setLeaderboard(leaderboard);
      topPlayerIdRef.current=leaderboard[0]?.id??null;
      leaderboard.forEach(p=>{if(state.current.players[p.id])state.current.players[p.id].level=p.level;});
      if(teamTiles)setScores({red:teamTiles.red??0,blue:teamTiles.blue??0,green:teamTiles.green??0});
      if(rd){if(rd.timeLeft!=null)roundEndsAtRef.current=Date.now()+rd.timeLeft;setRoundPhase(rd.phase);}
    });

    socket.on('round_end',({winner,teamTiles,results,breakMs})=>{
      setRoundPhase('break');
      setRoundEnd({winner,teamTiles,results,breakEndsAt:Date.now()+(breakMs??15000)});
    });

    socket.on('round_start',({endsAt})=>{
      setRoundPhase('playing');setRoundEnd(null);roundEndsAtRef.current=endsAt;
      setXp(0);setLevel(1);xpRef.current=0;levelRef.current=1;updateXpBar(0,1);
      const emptyUps={speed:0,firerate:0,bulletspeed:0,range:0,shield:0};
      setUpgrades(emptyUps);upgradesRef.current=emptyUps;setShowUpgradePanel(false);
    });

    socket.on('round_reset',({tiles:newTiles,tilesPacked})=>{
      if(tilesPacked!=null){
        const t=Array.from({length:GRID_H},()=>Array(GRID_W).fill(null));
        tilesPacked.forEach(({x,y,team})=>{if(t[y])t[y][x]=team;});
        s.tiles=t;
      } else if(newTiles){s.tiles=newTiles;}
      else{s.tiles=Array.from({length:GRID_H},()=>Array(GRID_W).fill(null));}
      minimapTilesRef.current=s.tiles;
      Object.keys(bulletGfxMap.current).forEach(bid=>{
        const sp=bulletGfxMap.current[bid];if(sp.parent)sp.parent.removeChild(sp);sp.destroy();delete bulletGfxMap.current[bid];
      });
      s.bullets={};
      initTileSprites(app,tileLayer,s.tiles);
      calcScores(s.tiles);
    });

    // [FIX-⑥] XP 업데이트: 이벤트 driven (매 프레임 루프 제거)
    socket.on('xp_update',({xp:newXp,level:newLv,leveled})=>{
      xpRef.current=newXp;levelRef.current=newLv;
      setLevel(newLv);setXp(newXp);
      updateXpBar(newXp,newLv);
      if(leveled){
        setLevelUpAnim(newLv);
        setTimeout(()=>setLevelUpAnim(null),2500);
        setUpgrades(prev=>{
          const totalSpent=Object.values(prev).reduce((a,b)=>a+b,0);
          if(calcStatPoints(newLv)>totalSpent){
            if(isMobile())setShowMobileUpgrade(true);else setShowUpgradePanel(true);
          }
          return prev;
        });
      }
    });

    socket.on('chat',({id,name,team,text})=>{
      const color=TEAM_CSS[team]??'#999';
      setChatMsgs(msgs=>[...msgs.slice(-49),{id:Date.now()+Math.random(),name,color,text}]);
      const senderId=id&&s.players[id]?id:null;
      const fallbackId=!senderId?Object.values(s.players).find(p=>p.name===name&&p.team===team)?.id:null;
      const targetId=senderId||fallbackId;
      if(targetId) showChatBubble(playerLayer,targetId,text,TEAM_COLORS[team]??0x5C9EFF);
    });

    // [FIX-⑤] interval — cleanup에서 반드시 제거
    let pingT=0;
    const pingIv=setInterval(()=>{pingT=Date.now();socket.emit('ping_c');},2000);
    socket.on('pong_c',()=>setPing(Date.now()-pingT));

    const timerIv=setInterval(()=>{
      if(!timerRef.current) return;
      const left=Math.max(0,roundEndsAtRef.current-Date.now());
      const m=Math.floor(left/60000);
      const s2=Math.floor((left%60000)/1000);
      timerRef.current.textContent=`${m}:${String(s2).padStart(2,'0')}`;
      timerRef.current.style.color=left<60000?'#FF5C5C':'inherit';
    },1000);

    // 키보드
    const onKD=e=>{
      if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
      s.keys[e.code]=true;
      if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
    };
    const onKU=e=>{if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;s.keys[e.code]=false;};
    window.addEventListener('keydown',onKD);window.addEventListener('keyup',onKU);

    const onWheel=e=>{if(e.ctrlKey)e.preventDefault();};
    window.addEventListener('wheel',onWheel,{passive:false});

    const cv=app.view;
    const onMM=e=>{const r=cv.getBoundingClientRect();s.mousePos={x:(e.clientX-r.left)*app.screen.width/r.width,y:(e.clientY-r.top)*app.screen.height/r.height};};
    const onMD=()=>{
      s.mouseDown=true;
      const me=s.players[s.myId]; if(!me) return;
      const now=Date.now();
      const _st=getStats(upgradesRef.current);
      const elapsed=s.lastShot>0?now-s.lastShot:_st.shootInterval;
      if(elapsed<_st.shootInterval) return;
      const invincible=me.invincibleUntil&&now<me.invincibleUntil;
      if(invincible) return;
      const connected=socket.connected&&s.myId;
      if(!connected) return;
      const mwx=s.mousePos.x+s.camX, mwy=s.mousePos.y+s.camY;
      const len=Math.hypot(mwx-me.x,mwy-me.y)||1;
      s.lastShot=now; s.justShot=true;
      socket.emit('move',{x:me.x,y:me.y});
      socket.emit('shoot',{dx:((mwx-me.x)/len)*_st.bulletSpeed,dy:((mwy-me.y)/len)*_st.bulletSpeed,speedMult:_st.bulletSpeed/12});
    };
    const onMU=()=>{s.mouseDown=false;};
    cv.addEventListener('mousemove',onMM);cv.addEventListener('mousedown',onMD);window.addEventListener('mouseup',onMU);

    /* ── PIXI Ticker (30fps 고정) ── */
    app.ticker.add(()=>{
      const now=Date.now();
      const me=s.players[s.myId];
      const connected=socket.connected&&s.myId;

      if(me){
        const st=getStats(upgradesRef.current);
        let dx=0,dy=0;
        if(!mobile){
          if(s.keys['KeyW']||s.keys['ArrowUp'])   dy-=st.moveSpeed;
          if(s.keys['KeyS']||s.keys['ArrowDown'])  dy+=st.moveSpeed;
          if(s.keys['KeyA']||s.keys['ArrowLeft'])  dx-=st.moveSpeed;
          if(s.keys['KeyD']||s.keys['ArrowRight']) dx+=st.moveSpeed;
        } else {
          const mv=moveVec.current;if(mv.active){dx=mv.x*st.moveSpeed;dy=mv.y*st.moveSpeed;}
        }
        if(dx&&dy){dx*=0.707;dy*=0.707;}
        me.x=Math.max(PLAYER_RADIUS,Math.min(GRID_W*TILE_SIZE-PLAYER_RADIUS,me.x+dx));
        me.y=Math.max(PLAYER_RADIUS,Math.min(GRID_H*TILE_SIZE-PLAYER_RADIUS,me.y+dy));
        me.tx=me.x;me.ty=me.y;
        if(connected&&(dx||dy)) socket.emit('move',{x:me.x,y:me.y});

        // 장전 바 DOM 조작
        const elapsed=s.lastShot>0?now-s.lastShot:st.shootInterval;
        const pct=Math.min(1,elapsed/st.shootInterval);
        const ready=pct>=1;
        const invincible=me.invincibleUntil&&now<me.invincibleUntil;
        if(reloadFillRef.current){
          const color=tcRef.current;
          if(!connected){reloadFillRef.current.style.width='100%';reloadFillRef.current.style.background='#CCCCCC';}
          else{reloadFillRef.current.style.width=invincible?'100%':`${pct*100}%`;reloadFillRef.current.style.background=invincible?'#AAAAAA':ready?color:`${color}88`;}
        }
        if(reloadLabelRef.current){
          const invLeft=me.invincibleUntil?Math.ceil((me.invincibleUntil-now)/1000):0;
          reloadLabelRef.current.textContent=!connected?LANGS[langRef.current].reconnecting:invincible?`🛡️ ${invLeft}s`:ready?'🎨':LANGS[langRef.current].reload;
        }

        // 발사
        if(s.justShot){s.justShot=false;}
        else{
          let shoot=false,sdx=0,sdy=0;
          if(!mobile&&s.mouseDown){
            const mwx=s.mousePos.x+s.camX,mwy=s.mousePos.y+s.camY;
            const len=Math.hypot(mwx-me.x,mwy-me.y)||1;
            sdx=((mwx-me.x)/len)*st.bulletSpeed;sdy=((mwy-me.y)/len)*st.bulletSpeed;shoot=true;
          } else if(mobile){
            const sv=shootVec.current;
            if(sv.active){const mag=Math.hypot(sv.x,sv.y);if(mag>0.1){const len=mag||1;sdx=(sv.x/len)*st.bulletSpeed;sdy=(sv.y/len)*st.bulletSpeed;shoot=true;}}
          }
          if(connected&&shoot&&ready&&!invincible){
            s.lastShot=now;
            socket.emit('move',{x:me.x,y:me.y});
            socket.emit('shoot',{dx:sdx,dy:sdy,speedMult:st.bulletSpeed/12});
          }
        }

        s.camX=lerp(s.camX,me.x-app.screen.width/2,0.1);
        s.camY=lerp(s.camY,me.y-app.screen.height/2,0.1);
      }

      s.camX=Math.max(0,Math.min(GRID_W*TILE_SIZE-app.screen.width,s.camX));
      s.camY=Math.max(0,Math.min(GRID_H*TILE_SIZE-app.screen.height,s.camY));
      tileLayer.x=playerLayer.x=bulletLayer.x=-s.camX;
      tileLayer.y=playerLayer.y=bulletLayer.y=-s.camY;

      Object.entries(s.players).forEach(([id,p])=>{
        if(id!==s.myId){p.x=lerp(p.x??p.tx,p.tx,0.18);p.y=lerp(p.y??p.ty,p.ty,0.18);}
      });

      // 총알 위치: 시간 기반 (30fps 서버 틱)
      Object.entries(s.bullets).forEach(([id,b])=>{
        const age=b.spawnTime?Date.now()-b.spawnTime:0;
        const ticks=age/SERVER_TICK;
        b.x=b.ox+b.dx*ticks; b.y=b.oy+b.dy*ticks;
        const _bLife=getStats(upgradesRef.current).bulletLifetime;
        if(age>=_bLife||b.x<-TILE_SIZE||b.x>(GRID_W+1)*TILE_SIZE||b.y<-TILE_SIZE||b.y>(GRID_H+1)*TILE_SIZE) delete s.bullets[id];
      });

      renderPlayers(app,playerLayer,s.players,s.myId,now);
      renderBullets(app,bulletLayer,s.bullets);
    });

    /* ── [FIX-④] WebGL 컨텍스트 손실/복구 강화 ── */
    const onContextLost=(e)=>{
      e.preventDefault();
      console.warn('WebGL 컨텍스트 손실 — 복구 대기');
    };
    const onContextRestored=()=>{
      console.warn('WebGL 컨텍스트 복구 — 텍스처 재구성');
      // 1. 플레이어/총알 텍스처 캐시 파기
      Object.values(texCache.current).forEach(t=>{try{t.destroy(true);}catch(_){}});
      texCache.current={};
      // 2. 타일 텍스처 캐시 파기
      Object.values(tileTexCacheRef.current).forEach(t=>{try{t.destroy(true);}catch(_){}});
      tileTexCacheRef.current={};
      // 3. playerGfxMap 파기 (renderPlayers가 다음 프레임에 재생성)
      Object.keys(playerGfxMap.current).forEach(pid=>{
        const e=playerGfxMap.current[pid];
        try{if(e.c.parent)e.c.parent.removeChild(e.c);e.c.destroy({children:true});}catch(_){}
        delete playerGfxMap.current[pid];
      });
      // 4. bulletGfxMap 파기
      Object.keys(bulletGfxMap.current).forEach(bid=>{
        const sp=bulletGfxMap.current[bid];
        try{if(sp.parent)sp.parent.removeChild(sp);sp.destroy();}catch(_){}
        delete bulletGfxMap.current[bid];
      });
      // 5. 타일 Sprite 배열 재구성
      tileSpritesRef.current=null;
      initTileSprites(app,tileLayer,s.tiles);
    };
    cv.addEventListener('webglcontextlost',onContextLost,false);
    cv.addEventListener('webglcontextrestored',onContextRestored,false);

    /* ── [FIX-⑤] Cleanup: 모든 자원 반드시 해제 ── */
    return()=>{
      clearInterval(pingIv);
      clearInterval(timerIv);
      killTimers.current.forEach(clearTimeout);killTimers.current=[];
      Object.keys(chatBubbles.current).forEach(id=>removeChatBubble(id));
      socket.disconnect();socketRef.current=null;
      window.removeEventListener('keydown',onKD);window.removeEventListener('keyup',onKU);
      window.removeEventListener('mouseup',onMU);window.removeEventListener('wheel',onWheel);
      cv.removeEventListener('mousemove',onMM);cv.removeEventListener('mousedown',onMD);
      cv.removeEventListener('webglcontextlost',onContextLost);
      cv.removeEventListener('webglcontextrestored',onContextRestored);
      Object.values(texCache.current).forEach(t=>{try{t.destroy(true);}catch(_){}});texCache.current={};
      Object.values(tileTexCacheRef.current).forEach(t=>{try{t.destroy(true);}catch(_){}});tileTexCacheRef.current={};
      tileSpritesRef.current=null;
      app.destroy(true,{children:true,texture:true,baseTexture:true});
    };
  },[]);

  const total=GRID_W*GRID_H;
  const rp=(scores.red/total*100).toFixed(1);
  const bp=(scores.blue/total*100).toFixed(1);
  const gp=(scores.green/total*100).toFixed(1);
  const tc=tcRef.current;

  return(
    <div className="game-wrapper">
      <div className="hud">
        <div className="hud-logo"><div className="hud-logo-circle"/><div className="logo-text" style={{fontSize:'clamp(0.75rem,2vw,1rem)'}}><Logo/></div><span style={{color:'#999',fontSize:'0.75em',fontWeight:700}}>.io</span></div>
        <div className="hud-timer-wrap"><div className="hud-timer" ref={timerRef}>10:00</div></div>
        <div className="score-bar"><div className="score-seg" style={{width:`${rp}%`,background:TEAM_CSS.red}}/><div className="score-seg" style={{width:`${bp}%`,background:TEAM_CSS.blue}}/><div className="score-seg" style={{width:`${gp}%`,background:TEAM_CSS.green}}/></div>
        <div className="hud-scores">{['red','blue','green'].map(tm=><div className="hud-score" key={tm}><div className="hud-dot" style={{background:TEAM_CSS[tm]}}/>{scores[tm]}</div>)}</div>
        <div className="hud-right">
          <div className="hud-level-wrap">
            <div className="hud-level-row">
              <div className="hud-level">Lv.{level}</div>
              <div className="hud-xp-text" ref={xpTextRef}>0/100</div>
              {(()=>{const pts=calcStatPoints(level)-Object.values(upgrades).reduce((a,b)=>a+b,0);return pts>0?<button className="hud-upgrade-btn" onClick={()=>mobile?setShowMobileUpgrade(true):setShowUpgradePanel(true)}>{pts}</button>:null;})()}
            </div>
            <div className="hud-xp-track"><div className="hud-xp-fill" ref={xpFillRef} style={{width:'0%',background:TEAM_CSS[playerTeam]}}/></div>
          </div>
          <div className="hud-player"><span>{playerName}</span> · {t.team_names[playerTeam]}</div>
          <div className="player-count">👥 {playerCount}</div>
          <button className="hud-settings-btn" onClick={()=>setShowSettings(true)}>⚙️</button>
        </div>
      </div>

      <div id="pixi-container" ref={containerRef}>
        <div className="kill-feed">{killFeed.map(k=><div key={k.id} className="kill-item">{k.msg}</div>)}</div>
        <MiniMap tilesRef={minimapTilesRef} playersRef={minimapPlayersRef} myTeam={playerTeam} myIdRef={myIdRef} expanded={minimapExpanded} onToggle={()=>setMinimapExpanded(v=>!v)}/>
        {!minimapExpanded&&<UpgradePanel lang={lang} level={level} upgrades={upgrades} onUpgrade={id=>{setUpgrades(prev=>{const next={...prev,[id]:(prev[id]||0)+1};upgradesRef.current=next;return next;});}} onClose={()=>{}}/>}
        {leaderboard.length>0&&(
          <div className="leaderboard">
            <div className="leaderboard-title">{t.leaderboard_title}</div>
            {leaderboard.slice(0,8).map((p,i)=>{
              const isMe=socketRef.current&&p.id===socketRef.current.id;
              return(
                <div key={p.id} className="leaderboard-row">
                  <div className="leaderboard-rank">{['🥇','🥈','🥉'][i]??i+1}</div>
                  <div className="leaderboard-dot" style={{background:TEAM_CSS[p.team]??'#999'}}/>
                  <div className={`leaderboard-name${isMe?' is-me':''}`}>{p.name}</div>
                  <div className="leaderboard-score">{t.tiles_unit(p.tiles)}</div>
                </div>
              );
            })}
          </div>
        )}
        <div className="reload-bar-wrap">
          <div className="reload-bar-label" ref={reloadLabelRef}>🎨</div>
          <div className="reload-bar-track"><div className="reload-bar-fill" ref={reloadFillRef} style={{width:'100%',background:tc}}/></div>
        </div>
        <div className="overlay-hud"><div className="ping-badge">{t.ping} {ping}ms</div></div>
        {!mobile&&(<ChatBox lang={lang} msgs={chatMsgs} input={chatInput} setInput={setChatInput} onSend={()=>{const text=chatInput.trim();if(!text||!socketRef.current)return;socketRef.current.emit('chat',{text});setChatInput('');}}/>)}
        {mobile&&(
          <>
            <div className="joystick-area left" ref={leftJoyRef}><div className="joystick-base"><div className="joystick-stick"/></div><div className="joystick-label">{t.joystick_move}</div></div>
            <div className="joystick-area right" ref={rightJoyRef}><div className="joystick-base"><div className="joystick-stick"/></div><div className="joystick-label">{t.joystick_shoot}</div></div>
          </>
        )}
        {mobile&&showMobileUpgrade&&(
          <div className="mob-upgrade-overlay" onClick={e=>e.target===e.currentTarget&&setShowMobileUpgrade(false)}>
            <div className="mob-upgrade-sheet">
              <div className="mob-upgrade-handle"/>
              <div className="mob-upgrade-header">
                <span className="mob-upgrade-title">⬆️ {lang==='ko'?'능력치 강화':lang==='ja'?'強化':lang==='zh'?'升级':'Upgrade'}</span>
                {(()=>{const pts=calcStatPoints(level)-Object.values(upgrades).reduce((a,b)=>a+b,0);return pts>0&&<span className="mob-upgrade-pts">{pts} {lang==='ko'?'포인트':lang==='ja'?'pt':lang==='zh'?'点':'pts'}</span>;})()}
                <button className="mob-upgrade-close" onClick={()=>setShowMobileUpgrade(false)}>✕</button>
              </div>
              <div className="mob-upgrade-list">
                {UPGRADES.map(up=>{
                  const curLv=upgrades[up.id]||0;const maxed=curLv>=up.maxLv;
                  const avail=calcStatPoints(level)-Object.values(upgrades).reduce((a,b)=>a+b,0);
                  const canUp=avail>0&&!maxed;
                  return(
                    <div key={up.id} className={`mob-upgrade-row${maxed?' maxed':''}`}>
                      <div className="mob-upgrade-icon">{up.icon}</div>
                      <div className="mob-upgrade-info">
                        <div className="mob-upgrade-name">{up.label[lang]||up.label.en}</div>
                        <div className="mob-upgrade-desc">{up.desc[lang]||up.desc.en}</div>
                        <div className="mob-upgrade-stars">{Array.from({length:up.maxLv}).map((_,i)=><div key={i} className={`mob-upgrade-star${i<curLv?' filled':''}`}/>)}</div>
                      </div>
                      <button className={`mob-upgrade-btn${canUp?' active':''}`} onClick={()=>{if(!canUp)return;setUpgrades(prev=>{const next={...prev,[up.id]:(prev[up.id]||0)+1};upgradesRef.current=next;return next;});}} disabled={!canUp}>{maxed?'MAX':'＋'}</button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {roundEnd&&(
          <div className="round-overlay">
            <div className="round-result-card">
              <div className="round-result-badge" style={{background:TEAM_CSS[roundEnd.winner]??'#999'}}>{t.team_names[roundEnd.winner]} WIN!</div>
              <div className="round-result-scores">
                {['red','blue','green'].map(tm=>(
                  <div key={tm} className={`round-score-row${tm===roundEnd.winner?' winner':''}`}>
                    <div className="round-score-dot" style={{background:TEAM_CSS[tm]}}/>
                    <span>{t.team_names[tm]}</span>
                    <span className="round-score-val">{roundEnd.teamTiles[tm]??0}</span>
                  </div>
                ))}
              </div>
              <div className="round-result-list">
                {roundEnd.results.slice(0,5).map((p,i)=>(
                  <div key={p.id} className="round-result-row">
                    <span className="round-result-rank">{i+1}</span>
                    <div className="round-score-dot" style={{background:TEAM_CSS[p.team]??'#999',width:8,height:8,borderRadius:'50%',flexShrink:0}}/>
                    <span className="round-result-name">{p.name}</span>
                    <span className="round-result-lv">Lv.{p.level}</span>
                    <span className="round-result-tile">{t.tiles_unit(p.tiles)}</span>
                  </div>
                ))}
              </div>
              <div className="round-break-msg">
                {roundPhase==='break'?`${t.next_round} ${Math.max(0,Math.ceil((roundEnd.breakEndsAt-Date.now())/1000))}s...`:'Starting...'}
              </div>
            </div>
          </div>
        )}
        {levelUpAnim&&(<div className="levelup-anim"><div className="levelup-text">LEVEL UP!</div><div className="levelup-num">Lv.{levelUpAnim}</div></div>)}
      </div>
      {showSettings&&<SettingsModal lang={lang} onSave={l=>{setLang(l);setShowSettings(false);}} onClose={()=>setShowSettings(false)}/>}
    </div>
  );
}

/* ══════════════ APP ROOT ══════════════ */
function AppRoot(){
  const[lang,setLangState]=useState(()=>localStorage.getItem('db_lang')||'en');
  const[phase,setPhase]=useState('lobby');
  const[pName,setPName]=useState('');
  const[pTeam,setPTeam]=useState('blue');
  const socketRef=useRef(null);
  const[chatMsgs,setChatMsgs]=useState([]);
  const[chatInput,setChatInput]=useState('');
  const[teamCounts,setTeamCounts]=useState({red:0,blue:0,green:0});

  useEffect(()=>{
    const s=io(SERVER_URL,{transports:['websocket'],reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:1000,reconnectionDelayMax:5000});
    socketRef.current=s;
    s.on('team_counts',counts=>setTeamCounts(counts));
    s.on('leaderboard',({teamCounts:tc})=>{if(tc)setTeamCounts(tc);});
    return()=>{s.disconnect();socketRef.current=null;};
  },[]);

  function setLang(l){localStorage.setItem('db_lang',l);setLangState(l);}
  function handleJoin(name,team){
    if(socketRef.current){socketRef.current.disconnect();socketRef.current=null;}
    setPName(name);setPTeam(team);setPhase('game');
  }

  return phase==='lobby'
    ?<Lobby onJoin={handleJoin} lang={lang} setLang={setLang} teamCounts={teamCounts}/>
    :<Game playerName={pName} playerTeam={pTeam} lang={lang} setLang={setLang}
        socketRef={socketRef} chatMsgs={chatMsgs} setChatMsgs={setChatMsgs}
        chatInput={chatInput} setChatInput={setChatInput}/>;
}

export default AppRoot;
