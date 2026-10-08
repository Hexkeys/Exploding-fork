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
  ['Shield','BLOCK','shield'],['Shield','BLOCK','shield'],['Shield','BLOCK','shield'],['Shield','BLOCK','shield'],
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
  return {code:p.code,name:p.name,hostId:p.hostId,members:p.members.map(m=>({id:m.id,name:m.name,ready:m.ready})),max:12};
}
function publicState(room){
  return {
    code:room.code,started:room.started,turn:room.turn,round:room.round,winner:room.winner,
    partyCode:room.partyCode,
    players:room.players.map(p=>({id:p.id,name:p.name,bot:!!p.bot,hand:p.hand.map(c=>({id:c.id,name:c.name,label:c.label,type:c.type}))})),
    log:room.log.slice(-30),deckCount:room.deck.length,
    top:room.deck.length?{name:'Mystery Fork',label:'?',type:'mystery'}:null
  };
}
function addLog(room,text){room.log.push({id:crypto.randomUUID(),text,at:Date.now()});}
function nextTurn(room,steps=1){if(!room.players.length)return;for(let i=0;i<steps;i++)room.turn=(room.turn+1)%room.players.length;room.round++;}
function refill(room){
  if(room.discard.length){room.deck=room.discard.splice(0).map(c=>({...c,id:crypto.randomUUID()}));for(let i=room.deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[room.deck[i],room.deck[j]]=[room.deck[j],room.deck[i]];}}
}
function draw(room,p){if(!room.deck.length)refill(room);if(room.deck.length)p.hand.push(room.deck.pop());}
function startGame(room){
  room.started=true;room.round=1;room.turn=0;room.winner=null;room.deck=deckFor(Math.max(20,room.players.length*8));room.discard=[];
  room.players.forEach(p=>p.hand=[]);room.players.forEach(p=>{for(let i=0;i<5;i++)draw(room,p);});
  room.deck.push(...Array.from({length:Math.max(1,room.players.length-1)},()=>({id:crypto.randomUUID(),name:'Fork Bomb',label:'BOOM',type:'bomb'})));
  for(let i=room.deck.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[room.deck[i],room.deck[j]]=[room.deck[j],room.deck[i]];}
  addLog(room,'Game started. Keep your fork steady.');
}

app.post('/api/parties',(req,res)=>{
  const name=cleanName(req.body?.name||'Fork Party');
  const hostName=cleanName(req.body?.hostName||'Host');
  const code=makeCode(),hostId=crypto.randomUUID();
  const party={code,name,hostId,members:[{id:hostId,name:hostName,ready:true}],createdAt:Date.now(),roomCode:null};
  parties.set(code,party);res.status(201).json({party:publicParty(party),memberId:hostId});
});
app.post('/api/parties/:code/join',(req,res)=>{
  const code=cleanCode(req.params.code),party=parties.get(code);
  if(!party)return res.status(404).json({error:'Party not found.'});
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
  rooms.set(code,{code,partyCode:party.code,host,started:false,turn:0,round:0,winner:null,players:party.members.map(m=>({id:m.id,name:m.name,hand:[]})),deck:[],discard:[],log:[]});
  party.roomCode=code;res.json({code,started:false});
});

app.post('/api/bot-games',(req,res)=>{
  const code=makeCode(),id=crypto.randomUUID();
  const botId='bot-'+crypto.randomUUID();
  const room={code,partyCode:null,host:id,started:false,turn:0,round:0,winner:null,players:[
    {id,name:cleanName(req.body?.name||'Player'),hand:[],bot:false},
    {id:botId,name:'Quantum Bot',hand:[],bot:true}
  ],deck:[],discard:[],log:[]};
  rooms.set(code,room);startGame(room);addLog(room,'Quantum Bot is connected.');
  res.status(201).json({code,id,state:publicState(room)});
});

function runBotTurn(room){
  const bot=room.players[room.turn];
  if(!bot?.bot||!room.started)return false;
  const actionCards=bot.hand.filter(c=>['skip','double','deflect','peek','steal','lucky','safe'].includes(c.type));
  if(actionCards.length && Math.random()<0.7){
    const c=actionCards[Math.floor(Math.random()*actionCards.length)];
    bot.hand=bot.hand.filter(x=>x.id!==c.id);room.discard.push(c);
    if(c.type==='skip'){addLog(room,'Quantum Bot played Skip.');nextTurn(room,1)}
    else if(c.type==='double'){addLog(room,'Quantum Bot played Double Turn.');nextTurn(room,2)}
    else if(c.type==='peek'){addLog(room,'Quantum Bot scanned the deck.');nextTurn(room,1)}
    else if(c.type==='deflect'){addLog(room,'Quantum Bot deflected the danger.');nextTurn(room,2)}
    else if(c.type==='steal'){const target=room.players.find(p=>!p.bot);if(target?.hand.length){const i=Math.floor(Math.random()*target.hand.length);bot.hand.push(target.hand.splice(i,1)[0]);addLog(room,'Quantum Bot stole a card.');}nextTurn(room,1)}
    else if(c.type==='lucky'){draw(room,bot);addLog(room,'Quantum Bot took a Lucky Fork draw.');nextTurn(room,1)}
    else {addLog(room,'Quantum Bot played Safe Bite.');nextTurn(room,1)}
  }else{
    draw(room,bot);const c=bot.hand[bot.hand.length-1];
    if(!c)return true;
    if(c.type==='bomb'){
      const shield=bot.hand.findIndex(x=>x.type==='shield');
      if(shield>=0){bot.hand.splice(shield,1);bot.hand.pop();room.discard.push(c);const at=Math.floor(Math.random()*(room.deck.length+1));room.deck.splice(at,0,{...c,id:crypto.randomUUID()});addLog(room,'Quantum Bot blocked a Fork Bomb.');nextTurn(room,1)}
      else{bot.hand.pop();room.discard.push(c);addLog(room,'Quantum Bot hit the Fork Bomb.');room.players.splice(room.turn,1);if(room.players.length===1){room.winner=room.players[0].name;room.started=false;addLog(room,room.winner+' wins the fork!');}else if(room.turn>=room.players.length)room.turn=0;}
    }else{room.discard.push(c);addLog(room,'Quantum Bot drew a card.');nextTurn(room,1)}
  }
  return true;
}
app.post('/api/rooms/:code/bot-turn',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));if(!room||!room.started)return res.status(400).json({error:'Game is not active.'});
  if(!room.players[room.turn]?.bot)return res.status(400).json({error:'It is not the bot turn.'});
  runBotTurn(room);res.json(publicState(room));
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
  res.json({id,state:publicState(room)});
});
app.get('/api/rooms/:code',(req,res)=>{const room=rooms.get(cleanCode(req.params.code));if(!room)return res.status(404).json({error:'Room not found.'});res.json(publicState(room));});
app.post('/api/rooms/:code/start',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));if(!room)return res.status(404).json({error:'Room not found.'});
  if(room.players.length<2)return res.status(400).json({error:'You need at least 2 players.'});if(room.started)return res.json(publicState(room));
  startGame(room);res.json(publicState(room));
});
app.post('/api/rooms/:code/draw',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));if(!room||!room.started)return res.status(400).json({error:'Game is not active.'});
  const p=room.players.find(x=>x.id===req.body?.playerId);if(!p)return res.status(404).json({error:'Player not found.'});
  if(room.players[room.turn]?.id!==p.id)return res.status(400).json({error:'Wait for your turn.'});
  draw(room,p);const c=p.hand[p.hand.length-1];if(!c)return res.status(400).json({error:'No cards left.'});
  if(c.type==='bomb'){
    const shield=p.hand.findIndex(x=>x.type==='shield');
    if(shield>=0){p.hand.splice(shield,1);p.hand.pop();room.discard.push(c);addLog(room,p.name+' found a Fork Bomb and used a Shield.');const at=Math.floor(Math.random()*(room.deck.length+1));room.deck.splice(at,0,{...c,id:crypto.randomUUID()});}
    else{p.hand.pop();room.discard.push(c);addLog(room,p.name+' hit the Fork Bomb and is out.');room.players.splice(room.turn,1);if(room.players.length===1){room.winner=room.players[0].name;room.started=false;addLog(room,room.winner+' wins the fork!');}else if(room.turn>=room.players.length)room.turn=0;res.json(publicState(room));return;}
  }else{addLog(room,p.name+' drew '+c.name+'.');room.discard.push(c);}
  nextTurn(room,1);res.json(publicState(room));
});
app.post('/api/rooms/:code/play',(req,res)=>{
  const room=rooms.get(cleanCode(req.params.code));if(!room||!room.started)return res.status(400).json({error:'Game is not active.'});
  const p=room.players.find(x=>x.id===req.body?.playerId);if(!p||room.players[room.turn]?.id!==p.id)return res.status(400).json({error:'Not your turn.'});
  const idx=p.hand.findIndex(c=>c.id===req.body?.cardId);if(idx<0)return res.status(404).json({error:'Card not found.'});
  const c=p.hand.splice(idx,1)[0];if(c.type==='shield'||c.type==='bomb')return res.status(400).json({error:'That card is reactive or drawn automatically.'});
  room.discard.push(c);
  if(c.type==='skip'){addLog(room,p.name+' played Skip.');nextTurn(room,1)}
  else if(c.type==='double'){addLog(room,p.name+' played Double Turn.');nextTurn(room,2)}
  else if(c.type==='peek'){addLog(room,p.name+' scanned the mystery fork.')}
  else if(c.type==='deflect'){addLog(room,p.name+' deflected the danger.');nextTurn(room,2)}
  else if(c.type==='steal'){const target=room.players[(room.turn+1)%room.players.length];if(target?.hand.length){const i=Math.floor(Math.random()*target.hand.length);p.hand.push(target.hand.splice(i,1)[0]);addLog(room,p.name+' grabbed a card from '+target.name+'.')}else addLog(room,p.name+' tried to grab a card, but found nothing.')}
  else if(c.type==='lucky'){draw(room,p);addLog(room,p.name+' took a Lucky Fork draw.');nextTurn(room,1)}
  else if(c.type==='safe')addLog(room,p.name+' played Safe Bite.');
  res.json(publicState(room));
});
app.use((_req,res)=>res.sendFile(process.cwd()+'/public/index.html'));
app.listen(port,()=>console.log('Exploding Fork listening on '+port));
