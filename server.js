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
  ['Peek','SCAN','peek'],['Peek','SCAN','peek'],['Peek','SCAN','peek'],
  ['Steal','GRAB','steal'],['Steal','GRAB','steal'],['Steal','GRAB','steal'],
  ['Skip','PASS','skip'],['Skip','PASS','skip'],['Skip','PASS','skip'],
  ['Double Turn','2X','double'],['Double Turn','2X','double'],
  ['Lucky Fork','LUCK','lucky'],['Lucky Fork','LUCK','lucky'],['Lucky Fork','LUCK','lucky'],
  ['Safe Bite','SAFE','safe'],['Safe Bite','SAFE','safe']
];

const cleanName=v=>String(v||'Player').trim().slice(0,20);
const cleanCode=v=>String(v||'').trim().toUpperCase().slice(0,8);
function makeCode(){
  let c;
  do c=Math.random().toString(36).slice(2,6).toUpperCase(); while(parties.has(c)||rooms.has(c));
  return c;
}
function deckFor(count){
  const base=cards.map(([name,label,type])=>({id:crypto.randomUUID(),name,label,type}));
  for(let i=base.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[base[i],base[j]]=[base[j],base[i]];}
  return base.slice(0,Math.max(0,count)).map(c=>({...c}));
}
function publicParty(p){
  return {code:p.code,name:p.name,hostId:p.hostId,members:p.members.map(m=>({id:m.id,name:m.name,ready:m.ready})),max:6};
}
function publicState(room,viewerId=null){
  return {
    code:room.code,started:room.started,turn:room.turn,round:room.round,winner:room.winner,
    partyCode:room.partyCode,
    players:room.players.map(p=>({id:p.id,name:p.name,bot:!!p.bot,handCount:p.hand.length,hand:p.id===viewerId?p.hand.map(c=>({id:c.id,name:c.name,label:c.label,type:c.type})):[]})),
    log:room.log.slice(-30),deckCount:room.deck.length,
    top:room.deck.length?{name:'Mystery Fork',label:'?',type:'mystery'}:null,
    botThinking:!!room.botThinking
  };
}
function addLog(room,text){room.log.push({id:crypto.randomUUID(),text,at:Date.now()});}
function nextTurn(room,steps=1){if(!room.players.length)return;for(let i=0;i<steps;i++)room.turn=(room.turn+1)%room.players.length;room.round++;}
function refill(room){
  if(room.discard.length){room.deck=room.discard.splice(0).map(c=>({...c,id:crypto.randomUUID()}));for(let i=room.deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[room.deck[i],room.deck[j]]=[room.deck[j],room.deck[i]];}}
}
function draw(room,p){if(!room.deck.length)refill(room);if(room.deck.length)p.hand.push(room.deck.pop());}
function startGame(room){
  room.started=true;room.round=1;room.turn=0;room.winner=null;room.discard=[];room.botThinking=false;
  const playerCount=room.players.length;
  const safePool=cards.filter(([, ,type])=>type!=='bomb'&&type!=='defuse');
  const openingSafe=[];
  for(let i=0;i<playerCount*7;i++){
    const [name,label,type]=safePool[Math.floor(Math.random()*safePool.length)];
    openingSafe.push({id:crypto.randomUUID(),name,label,type});
  }
  const openingDefuses=Array.from({length:playerCount},()=>({id:crypto.randomUUID(),name:'Defuse',label:'SAVE',type:'defuse'}));
  room.players.forEach(p=>p.hand=[]);
  for(let i=0;i<playerCount;i++){
    room.players[i].hand.push(openingDefuses[i]);
    room.players[i].hand.push(...openingSafe.slice(i*7,i*7+7));
  }
  const deck=[];
  const extraSafeCount=Math.max(20,playerCount*6);
  for(let i=0;i<extraSafeCount;i++){
    const [name,label,type]=safePool[Math.floor(Math.random()*safePool.length)];
    deck.push({id:crypto.randomUUID(),name,label,type});
  }
  for(let i=0;i<Math.max(1,playerCount-1);i++) deck.push({id:crypto.randomUUID(),name:'Fork Bomb',label:'BOOM',type:'bomb'});
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  room.deck=deck;
  addLog(room,'Game started. Each player starts with 1 Defuse and 7 random cards.');
}

app.post('/api/parties',(req,res)=>{
  const name=cleanName(req.body?.name||'Fork Party');
  const hostName=cleanName(req.body?.hostName||'Host');
  const code=makeCode(),hostId=crypto.randomUUID();
  const party={code,name,hostId,members:[{id:hostId,name:hostName,ready:true}],max:6,createdAt:Date.now(),roomCode:null};
  parties.set(code,party);res.status(201).json({party:publicParty(party),memberId:hostId});
});
app.post('/api/parties/:code/join',(req,res)=>{
  const code=cleanCode(req.params.code),party=parties.get(code);
  if(!party)return res.status(404).json({error:'Party not found.'});
  if(party.roomCode)return res.status(409).json({error:'That party has already started.'});
  if(party.members.length>=party.max)return res.status(409).json({error:'Party is full.'});
  const id=crypto.randomUUID(),name=cleanName(req.body?.name||'Player');
  party.members.push({id,name,ready:true});
  res.json({party:publicParty(party),memberId:id});
});
app.get('/api/parties/:code',(req,res)=>{
  const party=parties.get(cleanCode(req.params.code));if(!party)return res.status(404).json({error:'Party not found.'});
  res.json({party:publicParty(party)});
});
app.post('/api/parties/:code/launch',(req,res)=>{
  const party=parties.get(cleanCode(req.params.code));if(!party)return res.status(404).json({error:'Party not found.'});
  if(party.members.length<2)return res.status(400).json({error:'A party needs at least 2 players.'});
  const memberId=String(req.body?.memberId||'');
  if(!party.members.some(m=>m.id===memberId))return res.status(403).json({error:'You are not in this party.'});
  if(party.roomCode){return res.json({code:party.roomCode});}
  let code=makeCode(),host=party.hostId;
  const room={code,partyCode:party.code,host,started:false,turn:0,round:0,winner:null,players:party.members.map(m=>({id:m.id,name:m.name,hand:[]})),deck:[],discard:[],log:[]};
  rooms.set(code,room);startGame(room);party.roomCode=code;res.json({code,started:true,state:publicState(room,memberId)});
});

app.post('/api/bot-games',(req,res)=>{
  const code=makeCode(),id=crypto.randomUUID();
  const botId='bot-'+crypto.randomUUID();
  const room={code,partyCode:null,host:id,started:false,turn:0,round:0,winner:null,players:[
    {id,name:cleanName(req.body?.name||'Player'),hand:[],bot:false},
    {id:botId,name:'Quantum Bot',hand:[],bot:true}
  ],deck:[],discard:[],log:[]};
  rooms.set(code,room);startGame(room);addLog(room,'Quantum Bot is connected.');
  res.status(201).json({code,id,state:publicState(room,id)});
});

function reinsertBomb(room,bomb){
  const at=Math.floor(Math.random()*(room.deck.length+1));
  room.deck.splice(at,0,{...bomb,id:crypto.randomUUID()});
}
function eliminatePlayer(room,playerIndex,playerName){
  room.players.splice(playerIndex,1);
  if(room.players.length===1){
    room.winner=room.players[0].name;
    room.started=false;
    addLog(room,room.winner+' wins the fork!');
  }else if(room.players.length===0){
    room.started=false;
  }else if(room.turn>=room.players.length){
    room.turn=0;
  }
}
function drawAndResolve(room,p,source){
  if(!room.deck.length)refill(room);
  if(!room.deck.length)return {card:null};
  const card=room.deck.pop();
  p.hand.push(card);
  if(card.type!=='bomb')return {card,eliminated:false};
  const defuseIndex=p.hand.findIndex(x=>x.type==='defuse');
  if(defuseIndex>=0){
    p.hand.splice(defuseIndex,1);
    p.hand.pop();
    reinsertBomb(room,card);
    addLog(room,p.name+' found a Fork Bomb and used a Defuse.');
    return {card,bomb:true,defused:true,eliminated:false};
  }
  p.hand.pop();
  addLog(room,p.name+' hit a Fork Bomb and is out.');
  const playerIndex=room.players.findIndex(x=>x.id===p.id);
  if(playerIndex>=0)eliminatePlayer(room,playerIndex,p.name);
  return {card,bomb:true,defused:false,eliminated:true};
}
function runBotTurn(room){
  const bot=room.players[room.turn];
  if(!bot?.bot||!room.started||room.botThinking)return false;
  room.botThinking=true;
  try{
    const target=room.players.find(p=>!p.bot);
    const playable=bot.hand.filter(c=>['skip','double','deflect','peek','steal','lucky','safe'].includes(c.type));
    if(playable.length && Math.random()<0.65){
      const c=playable[Math.floor(Math.random()*playable.length)];
      bot.hand=bot.hand.filter(x=>x.id!==c.id);
      room.discard.push({...c,id:crypto.randomUUID()});
      if(c.type==='skip'){
        addLog(room,'Quantum Bot played Skip.');
        nextTurn(room,1);
      }else if(c.type==='double'){
        addLog(room,'Quantum Bot played Double Turn.');
        nextTurn(room,2);
      }else if(c.type==='deflect'){
        addLog(room,'Quantum Bot played Deflect.');
        nextTurn(room,2);
      }else if(c.type==='peek'){
        addLog(room,'Quantum Bot checked the deck.');
        nextTurn(room,1);
      }else if(c.type==='steal'){
        if(target?.hand.length){
          const i=Math.floor(Math.random()*target.hand.length);
          bot.hand.push(target.hand.splice(i,1)[0]);
          addLog(room,'Quantum Bot stole a card.');
        }else addLog(room,'Quantum Bot tried to steal, but your hand was empty.');
        nextTurn(room,1);
      }else if(c.type==='lucky'){
        const result=drawAndResolve(room,bot,'bot');
        if(!result.eliminated)nextTurn(room,1);
      }else{
        addLog(room,'Quantum Bot played Safe Bite.');
        nextTurn(room,1);
      }
    }else{
      const result=drawAndResolve(room,bot,'bot');
      if(!result.card){
        addLog(room,'Quantum Bot could not draw.');
        nextTurn(room,1);
      }else if(result.eliminated){
        // Turn index already points to the next player after elimination.
      }else{
        addLog(room,'Quantum Bot drew a card.');
        nextTurn(room,1);
      }
    }
  }finally{
    room.botThinking=false;
  }
  return true;
}

app.post('/api/rooms/:code/bot-turn',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));
  if(!room||!room.started)return res.status(400).json({error:'Game is not active.'});
  if(!room.players[room.turn]?.bot)return res.status(400).json({error:'It is not the bot turn.'});
  runBotTurn(room);
  res.json(publicState(room));
});

app.post('/api/rooms',(req,res)=>{
  const code=makeCode(),id=crypto.randomUUID();
  rooms.set(code,{code,partyCode:null,host:id,started:false,turn:0,round:0,winner:null,players:[],deck:[],discard:[],log:[]});
  res.json({code,id});
});
app.post('/api/rooms/:code/join',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));if(!room)return res.status(404).json({error:'Room not found.'});
  if(room.started)return res.status(409).json({error:'That game already started.'});
  if(room.players.length>=6)return res.status(409).json({error:'Room is full.'});
  const name=cleanName(req.body?.name||'Player'),id=crypto.randomUUID();room.players.push({id,name,hand:[]});addLog(room,name+' joined the table.');
  res.json({id,state:publicState(room,id)});
});
app.get('/api/rooms/:code',(req,res)=>{const room=rooms.get(cleanCode(req.params.code));if(!room)return res.status(404).json({error:'Room not found.'});res.json(publicState(room,String(req.query?.playerId||'')));});
app.post('/api/rooms/:code/start',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));if(!room)return res.status(404).json({error:'Room not found.'});
  if(room.players.length<2)return res.status(400).json({error:'You need at least 2 players.'});if(room.started)return res.json(publicState(room));
  startGame(room);res.json(publicState(room,String(req.body?.playerId||'')));
});
app.post('/api/rooms/:code/draw',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));
  if(!room||!room.started)return res.status(400).json({error:'Game is not active.'});
  const p=room.players.find(x=>x.id===req.body?.playerId);
  if(!p)return res.status(404).json({error:'Player not found.'});
  if(room.players[room.turn]?.id!==p.id)return res.status(400).json({error:'Wait for your turn.'});
  const result=drawAndResolve(room,p,'player');
  if(!result.card)return res.status(400).json({error:'No cards left.'});
  if(!result.eliminated)nextTurn(room,1);
  res.json(publicState(room));
});

app.post('/api/rooms/:code/play',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));if(!room||!room.started)return res.status(400).json({error:'Game is not active.'});
  const p=room.players.find(x=>x.id===req.body?.playerId);if(!p||room.players[room.turn]?.id!==p.id)return res.status(400).json({error:'Not your turn.'});
  const idx=p.hand.findIndex(c=>c.id===req.body?.cardId);if(idx<0)return res.status(404).json({error:'Card not found.'});
  const c=p.hand.splice(idx,1)[0];if(c.type==='defuse'||c.type==='bomb')return res.status(400).json({error:'That card is reactive or drawn automatically.'});
  room.discard.push(c);
  if(c.type==='skip'){
    addLog(room,p.name+' played Skip.');
    nextTurn(room,1);
  }else if(c.type==='double'){
    addLog(room,p.name+' played Double Turn.');
    nextTurn(room,2);
  }else if(c.type==='peek'){
    addLog(room,p.name+' scanned the mystery fork.');
    nextTurn(room,1);
  }else if(c.type==='deflect'){
    addLog(room,p.name+' deflected the danger.');
    nextTurn(room,2);
  }else if(c.type==='steal'){
    const target=room.players[(room.turn+1)%room.players.length];
    if(target?.hand.length){
      const i=Math.floor(Math.random()*target.hand.length);
      p.hand.push(target.hand.splice(i,1)[0]);
      addLog(room,p.name+' grabbed a card from '+target.name+'.');
    }else{
      addLog(room,p.name+' tried to grab a card, but found nothing.');
    }
    nextTurn(room,1);
  }else if(c.type==='lucky'){
    const result=drawAndResolve(room,p,'player');
    if(!result.card){
      addLog(room,p.name+' could not take a Lucky Fork draw.');
      nextTurn(room,1);
    }else if(!result.eliminated){
      addLog(room,p.name+' took a Lucky Fork draw.');
      nextTurn(room,1);
    }
  }else if(c.type==='safe'){
    addLog(room,p.name+' played Safe Bite.');
    nextTurn(room,1);
  }
  res.json(publicState(room,p.id));
});
app.use((_req,res)=>res.sendFile(process.cwd()+'/public/index.html'));
app.listen(port,()=>console.log('Exploding Fork listening on '+port));
