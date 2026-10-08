import express from 'express';
import crypto from 'node:crypto';

const app=express();
const port=process.env.PORT||3000;
app.use(express.json({limit:'2mb'}));
app.use(express.static('public'));

const parties=new Map();
const rooms=new Map();

const cards=[
  ['Fork Bomb','BOOM','bomb'],['Fork Bomb','BOOM','bomb'],['Fork Bomb','BOOM','bomb'],
  ['Defuse','SAVE','defuse'],['Defuse','SAVE','defuse'],['Defuse','SAVE','defuse'],['Defuse','SAVE','defuse'],
  ['Deflect','TURN','deflect'],['Deflect','TURN','deflect'],['Deflect','TURN','deflect'],
  ['Steal','GRAB','steal'],['Steal','GRAB','steal'],['Steal','GRAB','steal'],
  ['Skip','PASS','skip'],['Skip','PASS','skip'],['Skip','PASS','skip'],
  ['Double Turn','2X','double'],['Double Turn','2X','double'],
  ['Lucky Fork','LUCK','lucky'],['Lucky Fork','LUCK','lucky'],['Lucky Fork','LUCK','lucky'],
  ['Safe Bite','SAFE','safe'],['Safe Bite','SAFE','safe']
];

const cleanName=v=>String(v??'Player').trim().slice(0,20)||'Player';
const cleanCode=v=>String(v??'').trim().toUpperCase().slice(0,8);
const newToken=()=>crypto.randomBytes(24).toString('hex');
const newId=()=>crypto.randomUUID();

function makeCode(){
  let c;
  do c=Math.random().toString(36).slice(2,6).toUpperCase();
  while(parties.has(c)||rooms.has(c));
  return c;
}
function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}
  return arr;
}
function cardFromTuple([name,label,type]){return {id:newId(),name,label,type};}
function safeCardPool(){
  return cards.filter(([, ,type])=>type!=='bomb'&&type!=='defuse');
}
function publicParty(p){
  return {
    code:p.code,name:p.name,hostId:p.hostId,max:p.max,roomCode:p.roomCode,
    members:p.members.map(m=>({id:m.id,name:m.name,ready:m.ready,isLeader:m.id===p.hostId}))
  };
}
function publicState(room,viewerId=null,viewerToken=null){
  const viewer=room.players.find(p=>p.id===viewerId&&p.token===viewerToken)||room.eliminated?.[viewerId];
  const viewerActive=!!room.players.find(p=>p.id===viewerId&&p.token===viewerToken);
  const viewerHand=viewerActive&&viewer
    ? viewer.hand.map(c=>({id:c.id,name:c.name,label:c.label,type:c.type}))
    : [];
  return {
    code:room.code,started:room.started,turn:room.turn,round:room.round,winner:room.winner,
    partyCode:room.partyCode,botThinking:!!room.botThinking,
    viewerId:viewer?.id||null,viewerEliminated:!!room.eliminated?.[viewerId],
    viewerHand,
    viewerPrivateLog:viewerActive&&viewer?.privateLog?viewer.privateLog.slice(-10):[],
    players:room.players.map(p=>({
      id:p.id,name:p.name,bot:!!p.bot,isLeader:p.id===room.host,
      handCount:p.hand.length,
      hand:(p.id===viewerId&&p.token===viewerToken)?p.hand.map(c=>({id:c.id,name:c.name,label:c.label,type:c.type})):[]
    })),
    log:room.log.slice(-30),deckCount:room.deck.length
  };
}
function addLog(room,text){room.log.push({id:newId(),text,at:Date.now()});room.updatedAt=Date.now();}
function touch(room){room.updatedAt=Date.now();}
function advanceTurn(room,steps=1){
  if(!room.players.length)return;
  room.turn=(room.turn+steps+room.players.length*10)%room.players.length;
  room.round++;
  room.updatedAt=Date.now();
}
function draw(room,p){
  if(!room.deck.length)refill(room);
  if(!room.deck.length)return null;
  const c=room.deck.pop();
  p.hand.push(c);
  return c;
}
function refill(room){
  if(!room.discard.length)return;
  room.deck=shuffle(room.discard.splice(0).map(c=>({...c,id:newId()})));
}
function reinsertBomb(room,bomb){
  const copy={...bomb,id:newId()};
  const at=Math.floor(Math.random()*(room.deck.length+1));
  room.deck.splice(at,0,copy);
}
function eliminatePlayer(room,index){
  const p=room.players[index];
  if(!p)return;
  room.eliminated=room.eliminated||{};
  room.eliminated[p.id]={id:p.id,token:p.token,name:p.name,bot:!!p.bot,hand:[],privateLog:[...(p.privateLog||[])]};
  room.players.splice(index,1);
  if(room.players.length===1){
    room.winner=room.players[0].name;
    room.started=false;
    room.botThinking=false;
    addLog(room,room.winner+' wins the fork!');
  }else if(room.players.length===0){
    room.started=false;
    room.botThinking=false;
  }else if(room.turn>index){
    room.turn--;
  }else if(room.turn>=room.players.length){
    room.turn=0;
  }
}
function drawAndResolve(room,p){
  const card=draw(room,p);
  if(!card)return {card:null,eliminated:false,defused:false};
  if(card.type!=='bomb')return {card,eliminated:false,defused:false};
  const defuseIndex=p.hand.findIndex(c=>c.type==='defuse');
  if(defuseIndex>=0){
    p.hand.splice(defuseIndex,1);
    p.hand.pop();
    reinsertBomb(room,card);
    addLog(room,p.name+' found a Fork Bomb and used a Defuse.');
    return {card,eliminated:false,defused:true};
  }
  p.hand.pop();
  addLog(room,p.name+' hit a Fork Bomb and is out.');
  const index=room.players.findIndex(x=>x.id===p.id);
  if(index>=0)eliminatePlayer(room,index);
  return {card,eliminated:true,defused:false};
}
function safeDraw(room,p){
  if(!room.deck.length)refill(room);
  const index=room.deck.findIndex(c=>c.type!=='bomb');
  if(index<0)return null;
  const card=room.deck.splice(index,1)[0];
  p.hand.push(card);
  return card;
}
function createPlayer(name,bot=false){
  return {id:newId(),token:newToken(),name:cleanName(name),bot,hand:[],privateLog:[]};
}
function authorizePlayer(room,req,playerIdField='playerId'){
  const playerId=String(req.body?.[playerIdField]||req.query?.playerId||'');
  const token=String(req.headers['x-player-token']||'');
  const player=room.players.find(p=>p.id===playerId);
  if(!player||!token||player.token!==token)return null;
  return player;
}
function authorizeViewer(room,req,playerIdField='playerId'){
  const playerId=String(req.body?.[playerIdField]||req.query?.playerId||'');
  const token=String(req.headers['x-player-token']||'');
  if(!playerId||!token)return null;
  const player=room.players.find(p=>p.id===playerId&&p.token===token);
  if(player)return {player,active:true};
  const eliminated=room.eliminated?.[playerId];
  if(eliminated&&eliminated.token===token)return {player:eliminated,active:false};
  return null;
}
function startGame(room){
  room.started=true;room.round=1;room.turn=0;room.winner=null;room.discard=[];room.eliminated={};room.botThinking=false;room.updatedAt=Date.now();
  const playerCount=room.players.length;
  const pool=safeCardPool();
  const openingSafe=Array.from({length:playerCount*7},()=>cardFromTuple(pool[Math.floor(Math.random()*pool.length)]));
  for(let i=0;i<playerCount;i++){
    room.players[i].hand=[cardFromTuple(['Defuse','SAVE','defuse']),...openingSafe.slice(i*7,i*7+7)];
    room.players[i].lastPeek=null;
    room.players[i].privateLog=[];
  }
  const deck=Array.from({length:Math.max(20,playerCount*6)},()=>cardFromTuple(pool[Math.floor(Math.random()*pool.length)]));
  for(let i=0;i<Math.max(1,playerCount-1);i++)deck.push(cardFromTuple(['Fork Bomb','BOOM','bomb']));
  room.deck=shuffle(deck);
  addLog(room,'Game started. Each player starts with 1 Defuse and 7 random cards.');
}

app.post('/api/parties',(req,res)=>{
  const code=makeCode(),host=createPlayer(req.body?.hostName||'Host');
  const party={code,name:cleanName(req.body?.name||'Fork Party'),hostId:host.id,max:6,members:[{id:host.id,token:host.token,name:host.name,ready:true}],roomCode:null,createdAt:Date.now(),updatedAt:Date.now()};
  parties.set(code,party);
  res.status(201).json({party:publicParty(party),memberId:host.id,token:host.token});
});
app.post('/api/parties/:code/join',(req,res)=>{
  const party=parties.get(cleanCode(req.params.code));
  if(!party)return res.status(404).json({error:'Party not found.'});
  if(party.roomCode)return res.status(409).json({error:'That party has already started.'});
  if(party.members.length>=party.max)return res.status(409).json({error:'Party is full.'});
  const member=createPlayer(req.body?.name||'Player');
  party.members.push({id:member.id,token:member.token,name:member.name,ready:true});
  touch(party);
  res.json({party:publicParty(party),memberId:member.id,token:member.token});
});
app.get('/api/parties/:code',(req,res)=>{
  const party=parties.get(cleanCode(req.params.code));
  if(!party)return res.status(404).json({error:'Party not found.'});
  res.json({party:publicParty(party)});
});
app.post('/api/parties/:code/launch',(req,res)=>{
  const party=parties.get(cleanCode(req.params.code));
  if(!party)return res.status(404).json({error:'Party not found.'});
  const memberId=String(req.body?.memberId||''),token=String(req.headers['x-player-token']||'');
  const member=party.members.find(m=>m.id===memberId);
  if(!member||member.token!==token)return res.status(403).json({error:'You are not in this party.'});
  if(member.id!==party.hostId)return res.status(403).json({error:'Only the party leader can launch.'});
  if(party.members.length<2)return res.status(400).json({error:'A party needs at least 2 players.'});
  if(party.roomCode){
    const room=rooms.get(party.roomCode);
    if(room&&room.started)return res.json({code:room.code,started:true,state:publicState(room,member.id,member.token)});
    party.roomCode=null;
  }
  const roomCode=makeCode();
  const room={code:roomCode,partyCode:party.code,host:party.hostId,started:false,turn:0,round:0,winner:null,players:party.members.map(m=>({id:m.id,token:m.token,name:m.name,bot:false,hand:[],privateLog:[]})),deck:[],discard:[],eliminated:{},log:[],updatedAt:Date.now(),botThinking:false};
  rooms.set(roomCode,room);
  startGame(room);
  party.roomCode=roomCode;
  touch(party);
  res.json({code:roomCode,started:true,state:publicState(room,member.id,member.token)});
});

app.post('/api/bot-games',(req,res)=>{
  const human=createPlayer(req.body?.name||'Player');
  const bot=createPlayer('Quantum Bot',true);
  const room={code:makeCode(),partyCode:null,host:human.id,started:false,turn:0,round:0,winner:null,players:[human,bot],deck:[],discard:[],eliminated:{},log:[],updatedAt:Date.now(),botThinking:false};
  rooms.set(room.code,room);
  startGame(room);
  addLog(room,'Quantum Bot is connected.');
  res.status(201).json({code:room.code,id:human.id,token:human.token,state:publicState(room,human.id,human.token)});
});

function runBotTurn(room){
  const bot=room.players[room.turn];
  if(!bot?.bot||!room.started||room.botThinking)return false;
  room.botThinking=true;
  touch(room);
  try{
    const target=room.players.find(p=>!p.bot);
    const playable=bot.hand.filter(c=>['skip','double','deflect','steal','lucky','safe'].includes(c.type));
    if(playable.length&&Math.random()<0.65){
      const c=playable[Math.floor(Math.random()*playable.length)];
      bot.hand=bot.hand.filter(x=>x.id!==c.id);
      room.discard.push({...c,id:newId()});
      if(c.type==='skip'){addLog(room,'Quantum Bot played Skip.');advanceTurn(room,1);}
      else if(c.type==='double'){addLog(room,'Quantum Bot played Double Turn.');room.round++;room.updatedAt=Date.now();}
      else if(c.type==='deflect'){addLog(room,'Quantum Bot played Deflect.');advanceTurn(room,2);}
      else if(c.type==='peek'){
        const top=room.deck.at(-1);
        bot.lastPeek=top?{name:top.name,label:top.label,type:top.type}:null;
        bot.privateLog=bot.privateLog||[];
        bot.privateLog.push(top?'PEEK // '+top.name+' ['+top.label+']':'PEEK // EMPTY DECK');
        addLog(room,'Quantum Bot checked the deck.');
        advanceTurn(room,1);
      }else if(c.type==='steal'){
        if(target?.hand.length){
          const i=Math.floor(Math.random()*target.hand.length);
          bot.hand.push(target.hand.splice(i,1)[0]);
          addLog(room,'Quantum Bot stole a card.');
        }else addLog(room,'Quantum Bot found nothing to steal.');
        advanceTurn(room,1);
      }else if(c.type==='lucky'){
        const result=drawAndResolve(room,bot);
        if(!result.eliminated)advanceTurn(room,1);
      }else{
        const safe=safeDraw(room,bot);
        addLog(room,safe?'Quantum Bot used Safe Bite for a guaranteed safe draw.':'Quantum Bot used Safe Bite, but no safe card was available.');
        advanceTurn(room,1);
      }
    }else{
      const result=drawAndResolve(room,bot);
      if(!result.card){addLog(room,'Quantum Bot could not draw.');advanceTurn(room,1);}
      else if(!result.eliminated){addLog(room,'Quantum Bot drew a card.');advanceTurn(room,1);}
    }
  }finally{
    room.botThinking=false;
    touch(room);
  }
  return true;
}

app.post('/api/rooms/:code/bot-turn',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));
  if(!room||!room.started)return res.status(400).json({error:'Game is not active.'});
  const viewer=authorizePlayer(room,req);
  if(!viewer)return res.status(403).json({error:'Player authorization failed.'});
  if(!room.players[room.turn]?.bot)return res.status(400).json({error:'It is not the bot turn.'});
  runBotTurn(room);
  res.json(publicState(room,viewer.id,viewer.token));
});

app.post('/api/rooms',(req,res)=>{
  const player=createPlayer(req.body?.name||'Host');
  const code=makeCode();
  const room={code,partyCode:null,host:player.id,started:false,turn:0,round:0,winner:null,players:[player],deck:[],discard:[],eliminated:{},log:[],updatedAt:Date.now(),botThinking:false};
  rooms.set(code,room);
  res.status(201).json({code,id:player.id,token:player.token,state:publicState(room,player.id,player.token)});
});
app.post('/api/rooms/:code/join',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));
  if(!room)return res.status(404).json({error:'Room not found.'});
  if(room.started)return res.status(409).json({error:'That game already started.'});
  if(room.players.length>=6)return res.status(409).json({error:'Room is full.'});
  const player=createPlayer(req.body?.name||'Player');
  room.players.push(player);addLog(room,player.name+' joined the table.');
  res.json({id:player.id,token:player.token,state:publicState(room,player.id,player.token)});
});
app.get('/api/rooms/:code',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));
  if(!room)return res.status(404).json({error:'Room not found.'});
  const viewer=authorizeViewer(room,req);
  if(room.started&&!viewer)return res.status(401).json({error:'Session expired. Rejoin the game.'});
  res.json(publicState(room,viewer?.player?.id,viewer?.player?.token));
});
app.post('/api/rooms/:code/start',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));
  if(!room)return res.status(404).json({error:'Room not found.'});
  const player=authorizePlayer(room,req);
  if(!player)return res.status(403).json({error:'Player authorization failed.'});
  if(player.id!==room.host)return res.status(403).json({error:'Only the room host can start.'});
  if(room.players.length<2)return res.status(400).json({error:'You need at least 2 players.'});
  if(room.started)return res.json(publicState(room,player.id,player.token));
  startGame(room);
  res.json(publicState(room,player.id,player.token));
});
app.post('/api/rooms/:code/draw',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));
  if(!room||!room.started)return res.status(400).json({error:'Game is not active.'});
  const player=authorizePlayer(room,req);
  if(!player)return res.status(403).json({error:'Player authorization failed.'});
  if(room.players[room.turn]?.id!==player.id)return res.status(400).json({error:'Wait for your turn.'});
  const result=drawAndResolve(room,player);
  if(!result.card)return res.status(400).json({error:'No cards left.'});
  if(!result.eliminated)advanceTurn(room,1);
  res.json(publicState(room,player.id,player.token));
});
app.post('/api/rooms/:code/play',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));
  if(!room||!room.started)return res.status(400).json({error:'Game is not active.'});
  const player=authorizePlayer(room,req);
  if(!player||room.players[room.turn]?.id!==player.id)return res.status(403).json({error:'Player authorization failed.'});
  const idx=player.hand.findIndex(c=>c.id===req.body?.cardId);
  if(idx<0)return res.status(404).json({error:'Card not found.'});
  const c=player.hand.splice(idx,1)[0];
  if(c.type==='defuse'||c.type==='bomb')return res.status(400).json({error:'That card is reactive or drawn automatically.'});
  room.discard.push({...c,id:newId()});
  if(c.type==='skip'){
    addLog(room,player.name+' played Skip.');advanceTurn(room,1);
  }else if(c.type==='double'){
    addLog(room,player.name+' played Double Turn.');room.round++;touch(room); }else if(c.type==='deflect'){
    addLog(room,player.name+' deflected the danger.');advanceTurn(room,2);
  }else if(c.type==='steal'){
    const target=room.players[(room.turn+1)%room.players.length];
    if(target?.hand.length){
      const i=Math.floor(Math.random()*target.hand.length);
      player.hand.push(target.hand.splice(i,1)[0]);
      addLog(room,player.name+' grabbed a card from '+target.name+'.');
    }else addLog(room,player.name+' tried to grab a card, but found nothing.');
    advanceTurn(room,1);
  }else if(c.type==='lucky'){
    const result=drawAndResolve(room,player);
    if(!result.eliminated)advanceTurn(room,1);
  }else if(c.type==='safe'){
    const safe=safeDraw(room,player);
    addLog(room,safe?player.name+' used Safe Bite for a guaranteed safe draw.':player.name+' used Safe Bite, but no safe card was available.');
    advanceTurn(room,1);
  }
  res.json(publicState(room,player.id,player.token));
});

setInterval(()=>{
  const now=Date.now(),ttl=1000*60*60*6;
  for(const [code,room] of rooms)if(now-room.updatedAt>ttl)rooms.delete(code);
  for(const [code,party] of parties){
    if(party.roomCode&&!rooms.has(party.roomCode))party.roomCode=null;
    if(now-party.updatedAt>ttl&&!party.roomCode)parties.delete(code);
  }
},60*1000);

app.use((_req,res)=>res.sendFile(process.cwd()+'/public/index.html'));
app.listen(port,()=>console.log('Exploding Fork listening on '+port));
